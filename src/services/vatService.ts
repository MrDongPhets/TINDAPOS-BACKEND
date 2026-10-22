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

// SC/PWD discount on a VAT-inclusive subtotal: remove VAT, then 20% off (VAT sellers);
// non-VAT sellers have no VAT in their prices, so it's simply 20% off
export function scPwdDiscount(subtotal: number, vatStatus: VatStatus): number {
  return vatStatus === 'non_vat' ? r2(subtotal * 0.2) : r2(subtotal - (subtotal / 1.12) * 0.8);
}
