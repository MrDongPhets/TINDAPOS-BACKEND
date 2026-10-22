/**
 * Voids / returns money math — Invoicing plan P0-6
 */
import { planAdjustment, formatAdjustmentNo, type SaleItemForAdjustment, type PreviousAdjustment } from '../services/saleAdjustmentService'

const coke: SaleItemForAdjustment = { id: 'i1', product_id: 'p1', name: 'Coke', quantity: 2, unit_price: 20, total_price: 40, vat_type: 'vatable' }
const rice: SaleItemForAdjustment = { id: 'i2', product_id: 'p2', name: 'Rice', quantity: 1, unit_price: 100, total_price: 100, vat_type: 'vat_exempt' }
const bread: SaleItemForAdjustment = { id: 'i3', product_id: 'p3', name: 'Bread', quantity: 3, unit_price: 10, total_price: 30, vat_type: 'vatable' }

describe('void', () => {
  it('gives back the whole sale with the same VAT split', () => {
    const p = planAdjustment({ kind: 'void', sale: { total_amount: 140 }, items: [coke, rice], previous: [], vatStatus: 'vat' })
    expect(p.total_amount).toBe(140)
    expect(p).toMatchObject({ vatable_amount: 40, vat_exempt_amount: 100, tax_amount: 4.29, sale_status: 'voided', refunded_after: 140 })
    expect(p.lines.map(l => [l.sales_item_id, l.quantity, l.amount])).toEqual([['i1', 2, 40], ['i2', 1, 100]])
  })
  it('refuses a second void, or a void after a return', () => {
    expect(() => planAdjustment({ kind: 'void', sale: { total_amount: 140, adjustment_status: 'voided' }, items: [coke], previous: [], vatStatus: 'vat' })).toThrow(/already voided/)
    const prev: PreviousAdjustment[] = [{ items: [{ sales_item_id: 'i1', quantity: 1 }] }]
    expect(() => planAdjustment({ kind: 'void', sale: { total_amount: 140, adjustment_status: 'partially_returned', refunded_amount: 20 }, items: [coke, rice], previous: prev, vatStatus: 'vat' })).toThrow(/return the rest/)
  })
  it('non-VAT store: no VAT on the refund', () => {
    const p = planAdjustment({ kind: 'void', sale: { total_amount: 140 }, items: [coke, rice], previous: [], vatStatus: 'non_vat' })
    expect(p).toMatchObject({ total_amount: 140, vatable_amount: 0, vat_exempt_amount: 0, tax_amount: 0 })
  })
})

describe('return', () => {
  it('partial return of one item', () => {
    const p = planAdjustment({ kind: 'return', sale: { total_amount: 140 }, items: [coke, rice], previous: [], requested: [{ sales_item_id: 'i1', quantity: 1 }], vatStatus: 'vat' })
    expect(p).toMatchObject({ total_amount: 20, vatable_amount: 20, tax_amount: 2.14, sale_status: 'partially_returned', refunded_after: 20 })
  })
  it('spreads a sale-wide discount over the returned items', () => {
    // 170 of items, ₱17 off (10%) → paid 153
    const sale = { total_amount: 153, discount_type: 'percentage' }
    const p = planAdjustment({ kind: 'return', sale, items: [coke, rice, bread], previous: [], requested: [{ sales_item_id: 'i2', quantity: 1 }], vatStatus: 'vat' })
    expect(p.total_amount).toBe(90)
  })
  it('the returns always add up to exactly what was paid', () => {
    const sale = { total_amount: 99.99, discount_type: 'fixed' }   // odd amount → rounding on every line
    const items = [coke, rice, bread]
    const prev: PreviousAdjustment[] = []
    let refunded = 0
    const steps = [[{ sales_item_id: 'i3', quantity: 1 }], [{ sales_item_id: 'i3', quantity: 1 }, { sales_item_id: 'i1', quantity: 1 }], [{ sales_item_id: 'i3', quantity: 1 }, { sales_item_id: 'i1', quantity: 1 }, { sales_item_id: 'i2', quantity: 1 }]]
    let last
    for (const requested of steps) {
      last = planAdjustment({ kind: 'return', sale: { ...sale, refunded_amount: refunded, adjustment_status: refunded ? 'partially_returned' : null }, items, previous: prev, requested, vatStatus: 'vat' })
      refunded = last.refunded_after
      prev.push({ items: last.lines.map(l => ({ sales_item_id: l.sales_item_id, quantity: l.quantity })) })
    }
    expect(refunded).toBe(99.99)
    expect(last!.sale_status).toBe('returned')
    expect(() => planAdjustment({ kind: 'return', sale: { ...sale, refunded_amount: refunded, adjustment_status: 'returned' }, items, previous: prev, requested: [{ sales_item_id: 'i1', quantity: 1 }], vatStatus: 'vat' })).toThrow(/already returned/)
  })
  it('refuses more than what is left, unknown items and zero', () => {
    const prev: PreviousAdjustment[] = [{ items: [{ sales_item_id: 'i1', quantity: 1.5 }] }]
    const base = { kind: 'return' as const, sale: { total_amount: 140, refunded_amount: 30 }, items: [coke, rice], previous: prev, vatStatus: 'vat' as const }
    expect(() => planAdjustment({ ...base, requested: [{ sales_item_id: 'i1', quantity: 1 }] })).toThrow(/Only 0.5 of "Coke"/)
    expect(() => planAdjustment({ ...base, requested: [{ sales_item_id: 'nope', quantity: 1 }] })).toThrow(/not in this sale/)
    expect(() => planAdjustment({ ...base, requested: [{ sales_item_id: 'i2', quantity: 0 }] })).toThrow(/more than 0/)
    expect(() => planAdjustment({ ...base, requested: [] })).toThrow(/Choose the items/)
  })
  it('senior citizen sale: each item gives back its own SC price (VAT-exempt)', () => {
    // ₱112 VATable + ₱100 rice, SC → paid 80 + 80 = 160
    const sc = { total_amount: 160, discount_type: 'senior_citizen' }
    const softdrink: SaleItemForAdjustment = { id: 'a', product_id: 'pa', name: 'Item', quantity: 1, unit_price: 112, total_price: 112, vat_type: 'vatable' }
    const r = planAdjustment({ kind: 'return', sale: sc, items: [softdrink, rice], previous: [], requested: [{ sales_item_id: 'i2', quantity: 1 }], vatStatus: 'vat' })
    expect(r).toMatchObject({ total_amount: 80, vat_exempt_amount: 80, vatable_amount: 0, tax_amount: 0 })
  })
})

it('formats adjustment numbers', () => {
  expect(formatAdjustmentNo(1)).toBe('ADJ-00000001')
})
