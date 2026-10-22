// src/services/saleAdjustmentService.ts
// Voids and returns — Invoicing plan P0-6.
// BIR: an issued invoice is never edited or deleted; a void / return is its own numbered document (ADJ-…)
// pointing to the sale. Stock comes back, the grand total is NOT touched.
//
// planAdjustment() is pure (no DB) so the money math is unit-tested:
//  - what each returned item gives back, in centavos
//      · senior citizen / PWD sale: the item's own SC/PWD price (same per-item rule as the sale, vatService)
//      · otherwise: the item's net line total × (what the customer paid ÷ sum of line totals) — spreads a
//        sale-wide discount over the items the same way it was given
//  - the last return (everything now returned) gives back exactly what is left, so the refunds add up to the sale
//  - VAT split of the refund with the same rules as the sale (computeSaleVat)
import { computeSaleVat, specialDiscountTotals, type ProductVatType, type VatStatus } from './vatService';

export type AdjustmentKind = 'void' | 'return';
export const CORRECTION_CODES = ['01', '04', '05', '09'] as const;
export type CorrectionCode = typeof CORRECTION_CODES[number];

export interface SaleForAdjustment {
  total_amount: number | string;
  discount_type?: string | null;
  refunded_amount?: number | string | null;
  adjustment_status?: string | null;
}
export interface SaleItemForAdjustment {
  id: string;
  product_id: string;
  name: string;
  quantity: number | string;
  unit_price: number | string;
  total_price: number | string;   // net of the line discount
  vat_type: ProductVatType;
}
export interface PreviousAdjustment { items: Array<{ sales_item_id: string; quantity: number }> }

export interface AdjustmentLine { sales_item_id: string; product_id: string; name: string; quantity: number; unit_price: number; amount: number }
export interface AdjustmentPlan {
  lines: AdjustmentLine[];
  total_amount: number;
  vatable_amount: number;
  vat_exempt_amount: number;
  zero_rated_amount: number;
  tax_amount: number;
  // sale summary after this adjustment
  sale_status: 'voided' | 'returned' | 'partially_returned';
  refunded_after: number;
}

export class AdjustmentError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

const cents = (v: number | string | null | undefined) => Math.round((parseFloat(String(v ?? 0)) || 0) * 100);
const qty4 = (v: number | string) => Math.round((parseFloat(String(v)) || 0) * 10_000);
const isScPwd = (t?: string | null) => t === 'senior_citizen' || t === 'pwd';

export function planAdjustment(opts: {
  kind: AdjustmentKind;
  sale: SaleForAdjustment;
  items: SaleItemForAdjustment[];
  previous: PreviousAdjustment[];
  requested?: Array<{ sales_item_id: string; quantity: number | string }>;
  vatStatus: VatStatus;
}): AdjustmentPlan {
  const { kind, sale, items, previous, vatStatus } = opts;
  if (sale.adjustment_status === 'voided') throw new AdjustmentError('ALREADY_VOIDED', 'This sale is already voided');
  if (sale.adjustment_status === 'returned') throw new AdjustmentError('ALREADY_RETURNED', 'Everything in this sale was already returned');
  if (kind === 'void' && previous.length) throw new AdjustmentError('HAS_RETURNS', 'Items of this sale were already returned — return the rest instead of voiding');

  // Quantity still returnable per item (in 1/10000 units)
  const returned = new Map<string, number>();
  for (const adj of previous) for (const it of adj.items || []) returned.set(it.sales_item_id, (returned.get(it.sales_item_id) || 0) + qty4(it.quantity));
  const remaining = new Map(items.map((it) => [it.id, qty4(it.quantity) - (returned.get(it.id) || 0)]));

  // What is being given back now
  let wanted: Map<string, number>;
  if (kind === 'void') {
    wanted = new Map(items.map((it) => [it.id, qty4(it.quantity)]));
  } else {
    if (!opts.requested?.length) throw new AdjustmentError('NO_ITEMS', 'Choose the items being returned');
    wanted = new Map();
    for (const r of opts.requested) {
      const q = qty4(r.quantity);
      if (!remaining.has(r.sales_item_id)) throw new AdjustmentError('UNKNOWN_ITEM', 'That item is not in this sale');
      if (!(q > 0)) throw new AdjustmentError('BAD_QUANTITY', 'Return quantity must be more than 0');
      wanted.set(r.sales_item_id, (wanted.get(r.sales_item_id) || 0) + q);
    }
    for (const [id, q] of wanted) {
      if (q > remaining.get(id)!) {
        const it = items.find((i) => i.id === id)!;
        throw new AdjustmentError('TOO_MANY', `Only ${remaining.get(id)! / 10_000} of "${it.name}" can still be returned`);
      }
    }
  }

  const saleTotalC = cents(sale.total_amount);
  const refundedBeforeC = cents(sale.refunded_amount);
  const sumNetC = items.reduce((s, it) => s + cents(it.total_price), 0);

  const lines: AdjustmentLine[] = [];
  for (const it of items) {
    const q = wanted.get(it.id);
    if (!q) continue;
    let amountC: number;
    if (isScPwd(sale.discount_type)) {
      amountC = Math.round(specialDiscountTotals([{ price: parseFloat(String(it.unit_price)), quantity: q / 10_000, vatType: it.vat_type }], vatStatus).total * 100);
    } else {
      const lineC = Math.round((cents(it.total_price) * q) / qty4(it.quantity));
      amountC = sumNetC > 0 ? Math.round((lineC * saleTotalC) / sumNetC) : 0;
    }
    lines.push({ sales_item_id: it.id, product_id: it.product_id, name: it.name, quantity: q / 10_000, unit_price: parseFloat(String(it.unit_price)), amount: amountC / 100 });
  }

  const everythingBack = items.every((it) => (returned.get(it.id) || 0) + (wanted.get(it.id) || 0) >= qty4(it.quantity));
  let totalC = lines.reduce((s, l) => s + Math.round(l.amount * 100), 0);
  if (everythingBack) {
    // Last return: exactly what's left, so all refunds add up to what the customer paid. Rounding drift goes on the last line.
    const exact = Math.max(0, saleTotalC - refundedBeforeC);
    const last = lines[lines.length - 1];
    last.amount = (Math.round(last.amount * 100) + exact - totalC) / 100;
    totalC = exact;
  } else {
    totalC = Math.min(totalC, Math.max(0, saleTotalC - refundedBeforeC));
  }

  const vat = computeSaleVat({
    items: lines.map((l) => ({ total: l.amount, vatType: items.find((i) => i.id === l.sales_item_id)!.vat_type })),
    discountType: sale.discount_type,
    totalAmount: totalC / 100,
    vatStatus,
  });

  return {
    lines,
    total_amount: totalC / 100,
    ...vat,
    sale_status: kind === 'void' ? 'voided' : everythingBack ? 'returned' : 'partially_returned',
    refunded_after: (refundedBeforeC + totalC) / 100,
  };
}

export const formatAdjustmentNo = (n: number) => `ADJ-${String(n).padStart(8, '0')}`;
