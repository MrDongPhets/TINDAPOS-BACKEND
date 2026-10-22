// src/services/eis/eisInvoice.ts
// Tindapo sale → BIR EIS e-invoice JSON in the official CRM/POS format (see eisSpec.ts), UNSIGNED.
// Used to TEST an EIS integration; signing (JWS) + encryption + transmission belong to the EIS system under test.
// Tindapo is NOT EIS-certified — never transmit these to BIR production.
//
// CRM/POS e-invoices have no item list: one document per sale with VATable / exempt / zero-rated totals.
// Spec formulas:  TotSalesAmt = VATable + Exempt + Zero-rated sales (all excluding VAT)
//                 TotNetSalesAftDisct = TotSalesAmt + OtherTaxRev - (SC + PWD + Regular + Special discounts)
// Tindapo prices are VAT-inclusive (for VAT-registered sellers):
//  - VATable sales = gross / 1.12; VAT = VATable gross after discount - its VAT-exclusive amount, so
//    NetAmtPay always equals what the customer paid (12% of net, ±₱0.01 rounding)
//  - Senior citizen / PWD (RA 9994 / RA 7277): whole sale VAT-exempt, 20% off the VAT-exclusive price
import {
  CORRECTION_CD, DOC_TYPE, EIS_SPEC_VERSION, EIS_UNIQUE_ID_LENGTH, SELLER_TYPE, VAT_RATE,
} from './eisSpec';

export type TindapoVatType = 'vatable' | 'vat_exempt' | 'zero_rated';
export type TindapoDiscountType = 'senior_citizen' | 'pwd' | 'percentage' | 'fixed' | null;

export interface EisSaleItem {
  name: string;
  quantity: number;
  unit_price: number;          // as sold in Tindapo (VAT-inclusive for VAT sellers)
  discount_amount?: number;    // line discount (pesos, same basis as unit_price)
  vat_type?: TindapoVatType;
}

export interface EisSale {
  receipt_no: string;          // Tindapo OR number → CompInvoiceId
  issued_at: Date;
  items: EisSaleItem[];
  discount_type?: TindapoDiscountType;
  discount_value?: number;     // % for 'percentage', pesos for 'fixed'
  remarks?: string;
}

export interface EisParty {
  tin: string;                 // 9 digits, no dashes
  branchCd: string;            // 5 digits ('00000' head office; branch '101' → '00101')
  regNm: string;
  businessNm?: string;
  regAddr?: string;
  email?: string;
}

export interface EisSeller extends EisParty {
  type: (typeof SELLER_TYPE)[keyof typeof SELLER_TYPE];
  ptuNum: string;              // Permit To Use no. — mandatory for CRM/POS
  min: string;                 // Machine Identification Number — mandatory
  msn: string;                 // Machine Serial Number — mandatory
}

export interface EisAdjustment {
  code: (typeof CORRECTION_CD)[keyof typeof CORRECTION_CD];
  prevUniqueId: string;
  remarks?: string;
}

export interface EisIdContext {
  certId: string;              // EIS Certification number: 8 chars (2-digit source code + 6)
  nextControl: () => string;   // 8 chars, digits / uppercase letters
}

export interface EisInvoice {
  CompInvoiceId: string;
  IssueDtm: string;
  EisUniqueId: string;
  DocType: string;
  CorrYN: 'Y' | 'N';
  CorrectionCd: string;
  PrevUniqueId: string;
  Rmk1: string;
  SellerInfo: { Tin: string; BranchCd: string; Type: string; RegNm: string; BusinessNm: string; Email: string; RegAddr: string };
  BuyerInfo: { Tin: string; BranchCd: string; Type: string; RegNm: string; BusinessNm: string; Email: string; RegAddr: string };
  VATSales: number;
  OtherTaxRev: number;
  ExemptSales: number;
  ZeroSales: number;
  TotSalesAmt: number;
  Discount: { ScAmt: number; PwdAmt: number; RegAmt: number; SpeAmt: number; Rmk2: string };
  TotNetSalesAftDisct: number;
  VATAmt: number;
  WithholdIncome: number;
  WithholdBusVAT: number;
  WithholdBusPT: number;
  OtherNonTaxCharge: number;
  NetAmtPay: number;
  PtuNum: string;
  Min: string;
  Msn: string;
}

export interface EisBuildResult {
  invoice: EisInvoice;
  amountPaid: number;          // what the customer paid in Tindapo
  roundingDiff: number;        // NetAmtPay - amountPaid (0 unless something is off)
  specVersion: string;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// Issue date in Philippine time (UTC+8, no DST) — the server runs on UTC, and a 7 AM Manila sale is still "yesterday" in UTC
const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
export const yyyymmdd = (d: Date) => {
  const ph = new Date(d.getTime() + PH_OFFSET_MS);
  return `${ph.getUTCFullYear()}${String(ph.getUTCMonth() + 1).padStart(2, '0')}${String(ph.getUTCDate()).padStart(2, '0')}`;
};

// EisUniqueId = issue date (8) + EIS Cert number (8) + control value (8 digits/uppercase) — API guide §8.2.1.1
export function makeEisUniqueId(issuedAt: Date, ids: EisIdContext): string {
  if (!/^[0-9A-Z]{8}$/.test(ids.certId)) throw new Error(`EIS Cert number must be 8 digits/uppercase letters (got "${ids.certId}")`);
  const control = ids.nextControl();
  if (!/^[0-9A-Z]{8}$/.test(control)) throw new Error(`Control value must be 8 digits/uppercase letters (got "${control}")`);
  const id = `${yyyymmdd(issuedAt)}${ids.certId}${control}`;
  if (id.length !== EIS_UNIQUE_ID_LENGTH) throw new Error(`EisUniqueId must be ${EIS_UNIQUE_ID_LENGTH} chars`);
  return id;
}

// Same sale → same EisUniqueId on every request. Control value = 2-char store code + 6-digit OR counter, so stores
// that share an OR counter value on the same day still get different ids.
export function idsForSale(certId: string, orNumber: string, storeKey = ''): EisIdContext {
  let hash = 0;
  for (const ch of storeKey) hash = (hash * 31 + ch.charCodeAt(0)) % 1296; // 36² two-char codes
  const storeCode = hash.toString(36).toUpperCase().padStart(2, '0');
  const counter = (Number(orNumber.replace(/\D/g, '')) || 0) % 1_000_000;
  return { certId, nextControl: () => `${storeCode}${String(counter).padStart(6, '0')}` };
}

export function assertValidParty(p: EisParty, who: string) {
  if (!/^\d{9}$/.test(p.tin)) throw new Error(`${who} TIN must be 9 digits without dashes (got "${p.tin}")`);
  if (!/^\d{5}$/.test(p.branchCd)) throw new Error(`${who} branch code must be 5 digits (got "${p.branchCd}")`);
}

// Spread a peso amount over parts in proportion to their size; last part takes the rounding remainder
function allocate(total: number, parts: number[]): number[] {
  const base = parts.reduce((s, p) => s + p, 0);
  if (base <= 0 || total <= 0) return parts.map(() => 0);
  let used = 0;
  return parts.map((p, i) => {
    if (i === parts.length - 1) return r2(total - used);
    const share = r2((total * p) / base);
    used += share;
    return share;
  });
}

export function buildEisInvoice(
  sale: EisSale,
  seller: EisSeller,
  ids: EisIdContext,
  opts: { buyer?: EisParty; adjustment?: EisAdjustment } = {},
): EisBuildResult {
  assertValidParty(seller, 'Seller');
  if (opts.buyer) assertValidParty(opts.buyer, 'Buyer');
  if (!seller.ptuNum || !seller.min || !seller.msn) throw new Error('CRM/POS e-invoices need PtuNum, Min and Msn');
  if (sale.items.length === 0) throw new Error('Sale has no items');

  const vatSeller = seller.type === SELLER_TYPE.VAT;
  const scPwd = sale.discount_type === 'senior_citizen' || sale.discount_type === 'pwd';

  // Gross (before discounts) and line discounts per bucket, in Tindapo's price basis
  const bucket = { vatable: { gross: 0, disc: 0 }, exempt: { gross: 0, disc: 0 }, zero: { gross: 0, disc: 0 } };
  for (const item of sale.items) {
    // SC/PWD sale: entirely VAT-exempt. Non-VAT seller: no output VAT ⚠️ reported as exempt — confirm with BIR
    const b = scPwd || !vatSeller ? bucket.exempt
      : item.vat_type === 'zero_rated' ? bucket.zero
      : item.vat_type === 'vat_exempt' ? bucket.exempt
      : bucket.vatable;
    b.gross = r2(b.gross + item.unit_price * item.quantity);
    b.disc = r2(b.disc + (item.discount_amount || 0));
  }
  const grossAfterLineDisc = r2(Object.values(bucket).reduce((s, b) => s + b.gross - b.disc, 0));

  // Sale-level regular discount, spread over the buckets
  const saleDiscount = sale.discount_type === 'percentage' ? r2((grossAfterLineDisc * (sale.discount_value || 0)) / 100)
    : sale.discount_type === 'fixed' ? r2(Math.min(sale.discount_value || 0, grossAfterLineDisc))
    : 0;
  const keys = ['vatable', 'exempt', 'zero'] as const;
  const shares = allocate(saleDiscount, keys.map((k) => bucket[k].gross - bucket[k].disc));
  keys.forEach((k, i) => { bucket[k].disc = r2(bucket[k].disc + shares[i]); });

  let VATSales: number, ExemptSales: number, ZeroSales: number, VATAmt: number, net: number;
  let ScAmt = 0, PwdAmt = 0;
  let amountPaid: number;

  if (scPwd) {
    // VAT removed from the whole sale, then 20% off — matches Tindapo checkout
    ExemptSales = r2(bucket.exempt.gross / 1.12);
    net = r2((bucket.exempt.gross / 1.12) * 0.8);
    const special = r2(ExemptSales - net);
    if (sale.discount_type === 'senior_citizen') ScAmt = special; else PwdAmt = special;
    VATSales = 0; ZeroSales = 0; VATAmt = 0;
    amountPaid = net;
  } else {
    const vatGrossAfter = r2(bucket.vatable.gross - bucket.vatable.disc);
    const vatNet = r2(vatGrossAfter / (1 + VAT_RATE));
    VATSales = r2(bucket.vatable.gross / (1 + VAT_RATE));
    ExemptSales = bucket.exempt.gross;
    ZeroSales = bucket.zero.gross;
    VATAmt = r2(vatGrossAfter - vatNet);
    net = r2(vatNet + (bucket.exempt.gross - bucket.exempt.disc) + (bucket.zero.gross - bucket.zero.disc));
    amountPaid = r2(grossAfterLineDisc - saleDiscount);
  }

  const TotSalesAmt = r2(VATSales + ExemptSales + ZeroSales);
  const RegAmt = scPwd ? 0 : r2(TotSalesAmt - net); // every non-SC/PWD discount (line + sale), excl. VAT
  const NetAmtPay = r2(net + VATAmt);

  // Adjustment document (void / cancellation): reverses the original amounts
  const sign = opts.adjustment ? -1 : 1;
  const s = (n: number) => r2(n * sign) || 0; // avoid -0

  const invoice: EisInvoice = {
    CompInvoiceId: sale.receipt_no,
    IssueDtm: yyyymmdd(sale.issued_at),
    EisUniqueId: makeEisUniqueId(sale.issued_at, ids),
    DocType: opts.adjustment ? DOC_TYPE.ADJUSTMENT : DOC_TYPE.INVOICE,
    CorrYN: opts.adjustment ? 'Y' : 'N',
    CorrectionCd: opts.adjustment?.code ?? '',
    PrevUniqueId: opts.adjustment?.prevUniqueId ?? '',
    Rmk1: opts.adjustment?.remarks ?? sale.remarks ?? '',
    SellerInfo: {
      Tin: seller.tin, BranchCd: seller.branchCd, Type: seller.type, RegNm: seller.regNm,
      BusinessNm: seller.businessNm || seller.regNm, // spec: same as Registered Name if none
      Email: seller.email ?? '', RegAddr: seller.regAddr ?? '',
    },
    BuyerInfo: {
      Tin: opts.buyer?.tin ?? '', BranchCd: opts.buyer?.branchCd ?? '', Type: '',
      RegNm: opts.buyer?.regNm ?? '', BusinessNm: opts.buyer ? (opts.buyer.businessNm || opts.buyer.regNm) : '',
      Email: opts.buyer?.email ?? '', RegAddr: opts.buyer?.regAddr ?? '',
    },
    VATSales: s(VATSales),
    OtherTaxRev: 0,
    ExemptSales: s(ExemptSales),
    ZeroSales: s(ZeroSales),
    TotSalesAmt: s(TotSalesAmt),
    Discount: { ScAmt: s(ScAmt), PwdAmt: s(PwdAmt), RegAmt: s(RegAmt), SpeAmt: 0, Rmk2: '' },
    TotNetSalesAftDisct: s(net),
    VATAmt: s(VATAmt),
    WithholdIncome: 0,
    WithholdBusVAT: 0,
    WithholdBusPT: 0,
    OtherNonTaxCharge: 0,
    NetAmtPay: s(NetAmtPay),
    PtuNum: seller.ptuNum,
    Min: seller.min,
    Msn: seller.msn,
  };
  return {
    invoice,
    amountPaid: s(amountPaid),
    roundingDiff: r2(invoice.NetAmtPay - s(amountPaid)),
    specVersion: EIS_SPEC_VERSION,
  };
}

