// src/services/eis/taxtrailMapper.ts
// Tindapo sale → ITBS TaxTrail `POST /api/v1/invoices` body (TaxTrail ISSUES the e-invoice) — Invoicing plan P2-2.
// Contract read from TaxTrail's code (invoicing.schema.ts, special-discounts.ts):
//  - lines: description, quantity (≤ 4 decimals, as text), unit, unitPrice / discount ("0.00"), vatType vatable|exempt|zero_rated
//  - non-VAT taxpayers may not send VATable lines → their items go out as `exempt`
//  - senior citizen / PWD / NAC / solo parent: the LINES must carry the discount; VATable lines are made VAT-exempt
//    with the VAT taken out of the price first (TaxTrail's applySpecialDiscount, mirrored here centavo for centavo)
//  - a sale-wide regular discount is spread over the lines' `discount` (TaxTrail has no sale-level discount field)

export type VatStatus = 'vat' | 'non_vat' | 'rbe';
export type SpecialDiscountType = 'senior_citizen' | 'pwd' | 'nac' | 'solo_parent';
type EspVatType = 'vatable' | 'exempt' | 'zero_rated';

export const SPECIAL_DISCOUNT_RATE: Record<SpecialDiscountType, number> = { senior_citizen: 20, pwd: 20, nac: 20, solo_parent: 10 };

export interface TindapoSaleForEsp {
  id: string;
  or_number?: string | null;
  receipt_number?: string | null;
  payment_method?: string | null;
  discount_type?: string | null;     // senior_citizen | pwd | percentage | fixed | null
  discount_amount?: number | string | null;   // sale-wide regular discount in pesos (as Tindapo stores it)
  total_amount: number | string;
}

export interface TindapoItemForEsp {
  name: string;
  quantity: number | string;
  unit_price: number | string;       // VAT-inclusive for VAT sellers
  discount_amount?: number | string | null;  // line discount in pesos
  vat_type?: string | null;          // vatable | vat_exempt | zero_rated
}

export interface Beneficiary { name: string; idNumber: string; tin?: string | null }
export interface EspBuyer { name?: string | null; tin?: string | null; branchCode?: string | null; address?: string | null; email?: string | null; vatRegistered?: boolean | null }

export interface TaxTrailLine { description: string; quantity: string; unit: string; unitPrice: string; discount: string; vatType: EspVatType }
export interface TaxTrailIssueBody {
  docType: 'invoice';
  branchCode: string;
  pricesIncludeVat: boolean;
  reference: string;
  notes: string;
  lines: TaxTrailLine[];
  buyer?: EspBuyer;
  specialDiscount?: { type: SpecialDiscountType; beneficiaryName: string; idNumber: string; beneficiaryTin?: string | null };
}

export interface MappedInvoice {
  body: TaxTrailIssueBody;
  idempotencyKey: string;
  tindapoTotal: number;        // what the customer paid in Tindapo
  expectedEspTotal: number;    // what TaxTrail should compute from these lines (centavo-exact)
}

// ── centavo math, same rounding as TaxTrail (half away from zero on non-negative values) ──
const toCents = (v: number | string | null | undefined) => Math.round((parseFloat(String(v ?? 0)) || 0) * 100);
const fmt = (cents: number) => (cents / 100).toFixed(2);
const divRound = (n: number, d: number) => Math.floor((n * 2 + d) / (2 * d));

export function formatQuantity(q: number | string): string {
  const n = parseFloat(String(q));
  if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid quantity: ${q}`);
  return n.toFixed(4).replace(/\.?0+$/, '');
}

const espVatType = (t: string | null | undefined, vatStatus: VatStatus): EspVatType => {
  if (vatStatus === 'non_vat') return 'exempt';               // non-VAT taxpayers: no VATable lines
  if (t === 'vat_exempt') return 'exempt';
  if (t === 'zero_rated') return 'zero_rated';
  return 'vatable';
};

// Spread a total (centavos) over parts in proportion to their size; last part takes the remainder
function allocate(totalCents: number, parts: number[]): number[] {
  const base = parts.reduce((s, p) => s + p, 0);
  if (totalCents <= 0 || base <= 0) return parts.map(() => 0);
  let used = 0;
  return parts.map((p, i) => {
    if (i === parts.length - 1) return totalCents - used;
    const share = Math.round((totalCents * p) / base);
    used += share;
    return share;
  });
}

export function mapSaleToTaxTrail(opts: {
  sale: TindapoSaleForEsp;
  items: TindapoItemForEsp[];
  vatStatus: VatStatus;
  branchCode: string;
  beneficiary?: Beneficiary | null;
  buyer?: EspBuyer | null;
}): MappedInvoice {
  const { sale, items, vatStatus } = opts;
  if (!items.length) throw new Error('Sale has no items');
  if (items.length > 500) throw new Error('TaxTrail accepts at most 500 lines per invoice');
  if (!/^\d{5}$/.test(opts.branchCode)) throw new Error(`Branch code must be 5 digits (got "${opts.branchCode}")`);

  const special = (['senior_citizen', 'pwd'] as const).find((t) => t === sale.discount_type) as SpecialDiscountType | undefined;
  if (special && !opts.beneficiary) throw new Error('Senior citizen / PWD sale needs the beneficiary name and ID number');

  // Base lines in Tindapo's price basis
  const base = items.map((it) => {
    const qtyStr = formatQuantity(it.quantity);
    const priceCents = toCents(it.unit_price);
    const extendedCents = divRound(Math.round(parseFloat(qtyStr) * 10_000) * priceCents, 10_000);
    return { it, qtyStr, priceCents, extendedCents, lineDiscCents: toCents(it.discount_amount), vatType: espVatType(it.vat_type, vatStatus) };
  });

  let lines: TaxTrailLine[];
  if (special) {
    // TaxTrail applySpecialDiscount: VATable → VAT out of the price, exempt; then rate% off the extended amount
    const rate = SPECIAL_DISCOUNT_RATE[special];
    lines = base.map((b) => {
      let price = b.priceCents;
      let vatType = b.vatType;
      if (vatType === 'vatable') { price = divRound(price * 100, 112); vatType = 'exempt'; }
      const extended = divRound(Math.round(parseFloat(b.qtyStr) * 10_000) * price, 10_000);
      return { description: b.it.name.slice(0, 500), quantity: b.qtyStr, unit: 'pc', unitPrice: fmt(price), discount: fmt(divRound(extended * rate, 100)), vatType };
    });
  } else {
    // Regular discount: line discount + the sale-wide discount spread by each line's amount
    const saleDiscCents = sale.discount_type === 'percentage' || sale.discount_type === 'fixed' ? toCents(sale.discount_amount) : 0;
    const shares = allocate(saleDiscCents, base.map((b) => Math.max(b.extendedCents - b.lineDiscCents, 0)));
    lines = base.map((b, i) => ({
      description: b.it.name.slice(0, 500), quantity: b.qtyStr, unit: 'pc', unitPrice: fmt(b.priceCents),
      discount: fmt(Math.min(b.lineDiscCents + shares[i], b.extendedCents)), vatType: b.vatType,
    }));
  }

  const expectedEspCents = lines.reduce((s, l) => {
    const ext = divRound(Math.round(parseFloat(l.quantity) * 10_000) * toCents(l.unitPrice), 10_000);
    return s + ext - toCents(l.discount);
  }, 0);

  const orNo = sale.or_number || sale.receipt_number || sale.id;
  const payment = sale.payment_method === 'credit' ? 'Utang (credit)' : (sale.payment_method || 'cash').replace('_', ' ');
  const body: TaxTrailIssueBody = {
    docType: 'invoice',
    branchCode: opts.branchCode,
    pricesIncludeVat: vatStatus !== 'non_vat',
    reference: orNo.slice(0, 100),
    notes: `Tindapo ${orNo} · Payment: ${payment}`.slice(0, 1000),
    lines,
  };
  if (opts.buyer && (opts.buyer.name || opts.buyer.tin)) body.buyer = opts.buyer;
  if (special && opts.beneficiary) {
    body.specialDiscount = { type: special, beneficiaryName: opts.beneficiary.name.trim(), idNumber: opts.beneficiary.idNumber.trim(), beneficiaryTin: opts.beneficiary.tin || null };
  }

  return {
    body,
    idempotencyKey: `tindapo-${sale.id}`,
    tindapoTotal: toCents(sale.total_amount) / 100,
    expectedEspTotal: expectedEspCents / 100,
  };
}
