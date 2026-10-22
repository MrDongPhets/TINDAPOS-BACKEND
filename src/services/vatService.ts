// src/services/vatService.ts
// VAT on a sale, following the company's BIR VAT status (Invoicing plan P0-5).
//  - VAT-registered (and RBE): prices include 12% VAT; VAT = VATable gross × 12/112, split by product vat_type.
//    Senior citizen / PWD (RA 9994 / RA 7277): the whole sale is VAT-exempt.
//  - Non-VAT: no output VAT at all — every VAT bucket is 0 (gross sales are just total_amount).

export type VatStatus = 'vat' | 'non_vat' | 'rbe';
export type ProductVatType = 'vatable' | 'vat_exempt' | 'zero_rated';

export interface SaleVat {
  vatable_amount: number;
  vat_exempt_amount: number;
  zero_rated_amount: number;
  tax_amount: number;
}

export const normalizeVatStatus = (v: unknown): VatStatus => (v === 'non_vat' || v === 'rbe' ? v : 'vat');

const isScPwd = (t: string | null | undefined) => t === 'senior_citizen' || t === 'pwd';
const r2 = (n: number) => parseFloat(n.toFixed(2));

export function computeSaleVat(opts: {
  items: Array<{ total: number; vatType: ProductVatType }>;
  discountType?: string | null;
  totalAmount: number;
  vatStatus: VatStatus;
}): SaleVat {
  if (opts.vatStatus === 'non_vat') return { vatable_amount: 0, vat_exempt_amount: 0, zero_rated_amount: 0, tax_amount: 0 };

  if (isScPwd(opts.discountType)) {
    return { vatable_amount: 0, vat_exempt_amount: r2(opts.totalAmount), zero_rated_amount: 0, tax_amount: 0 };
  }

  let vatable = 0, exempt = 0, zero = 0;
  for (const item of opts.items) {
    if (item.vatType === 'vat_exempt') exempt += item.total;
    else if (item.vatType === 'zero_rated') zero += item.total;
    else vatable += item.total;
  }
  return {
    vatable_amount: r2(vatable),
    vat_exempt_amount: r2(exempt),
    zero_rated_amount: r2(zero),
    tax_amount: r2((vatable * 12) / 112),
  };
}

// Senior citizen / PWD discount, item by item (RA 9994 / RA 7277) — same rule and rounding as TaxTrail's
// applySpecialDiscount, so a Tindapo sale and the e-invoice TaxTrail issues for it come to the same total:
//  - VATable item (VAT seller): VAT taken out of the price first (price × 100/112), then the rate off
//  - VAT-exempt / zero-rated item, or any item of a non-VAT seller: the rate off the price as is
// All math in centavos, rounded half away from zero per line. Line discounts are replaced by the special discount.
export interface SpecialDiscountLine { price: number; quantity: number; vatType: ProductVatType }

const divRound = (n: number, d: number) => Math.floor((n * 2 + d) / (2 * d));

export function specialDiscountTotals(lines: SpecialDiscountLine[], vatStatus: VatStatus, ratePercent = 20) {
  let grossC = 0;
  let totalC = 0;
  for (const l of lines) {
    const qty4 = Math.round(l.quantity * 10_000);
    const priceC = Math.round(l.price * 100);
    grossC += divRound(qty4 * priceC, 10_000);
    const base = l.vatType === 'vatable' && vatStatus !== 'non_vat' ? divRound(priceC * 100, 112) : priceC;
    const extended = divRound(qty4 * base, 10_000);
    totalC += extended - divRound(extended * ratePercent, 100);
  }
  return { gross: grossC / 100, discount: (grossC - totalC) / 100, total: totalC / 100 };
}
