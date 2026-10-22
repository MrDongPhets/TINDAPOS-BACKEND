/**
 * Voids / returns → TaxTrail corrections — Invoicing plan P2-7
 */
import { mapAdjustmentToTaxTrail } from '../services/eis/taxtrailMapper'
import { classifyCorrectionResponse } from '../services/eis/eisIssuer'
import type { EspResponse } from '../services/eis/taxtrailClient'

const adj = (kind: 'void' | 'return', lines: Array<{ name: string; quantity: number; amount: number; vat_type?: string }> = []) =>
  ({ id: 'a1', adjustment_no: 'ADJ-00000007', kind, reason: 'Customer returned it', lines })
// what TaxTrail computes for a line: qty × price − discount (centavos, half-up)
const lineTotal = (l: { quantity: string; unitPrice: string; discount: string }) =>
  Math.floor((Math.round(parseFloat(l.quantity) * 10_000) * Math.round(parseFloat(l.unitPrice) * 100) * 2 + 10_000) / 20_000) - Math.round(parseFloat(l.discount) * 100)

describe('mapAdjustmentToTaxTrail', () => {
  it('void → cancellation with the ADJ no. in the reason', () => {
    const m = mapAdjustmentToTaxTrail({ adjustment: adj('void'), vatStatus: 'vat' })
    expect(m.body).toEqual({ kind: 'cancellation', reason: 'ADJ-00000007: Customer returned it' })
    expect(m.idempotencyKey).toBe('tindapo-adj-a1')
  })

  it('return → credit memo whose lines add up exactly to what was given back', () => {
    const m = mapAdjustmentToTaxTrail({ adjustment: adj('return', [
      { name: 'Coke', quantity: 3, amount: 50, vat_type: 'vatable' },          // 50 ÷ 3 doesn't divide
      { name: 'Rice', quantity: 1.25, amount: 61.37, vat_type: 'vat_exempt' }, // fractional quantity
      { name: 'Export', quantity: 1, amount: 10, vat_type: 'zero_rated' },
    ]), vatStatus: 'vat' })
    expect(m.body.kind).toBe('credit_memo')
    expect(m.body.pricesIncludeVat).toBe(true)
    expect(m.body.lines!.map(l => l.vatType)).toEqual(['vatable', 'exempt', 'zero_rated'])
    expect(m.body.lines!.map(lineTotal)).toEqual([5000, 6137, 1000])
    expect(m.body.lines![0]).toMatchObject({ quantity: '3', unitPrice: '16.67', discount: '0.01' })
    expect(m.total).toBe(121.37)
  })

  it('senior citizen / PWD sale: refund lines are VAT-exempt (VAT already taken out)', () => {
    const m = mapAdjustmentToTaxTrail({ adjustment: adj('return', [{ name: 'Item', quantity: 1, amount: 80, vat_type: 'vatable' }]), vatStatus: 'vat', saleDiscountType: 'senior_citizen' })
    expect(m.body.lines![0]).toMatchObject({ unitPrice: '80.00', discount: '0.00', vatType: 'exempt' })
  })

  it('non-VAT seller: no VATable lines, prices as is', () => {
    const m = mapAdjustmentToTaxTrail({ adjustment: adj('return', [{ name: 'Coke', quantity: 2, amount: 40, vat_type: 'vatable' }]), vatStatus: 'non_vat' })
    expect(m.body.pricesIncludeVat).toBe(false)
    expect(m.body.lines![0].vatType).toBe('exempt')
  })

  it('refuses an empty return', () => {
    expect(() => mapAdjustmentToTaxTrail({ adjustment: adj('return', []), vatStatus: 'vat' })).toThrow()
  })
})

describe('classifyCorrectionResponse', () => {
  const r = (status: number, extra: Partial<EspResponse<{ memo?: unknown }>> = {}) =>
    ({ ok: status >= 200 && status < 300, status, data: null, error: status >= 200 && status < 300 ? null : { code: 'X', message: 'x' }, ...extra }) as EspResponse<{ memo?: never }>
  const memo = { id: 'm1', invoiceNo: 'TEST-CM-0000000001', totalAmount: '18.00', vatAmount: '1.93', issuedAt: 't' }

  it('credit memo issued (and replayed) → its own number', () => {
    expect(classifyCorrectionResponse({ ...r(201), data: { memo } } as never, 'credit_memo')).toEqual({ kind: 'issued', invoice: memo })
    expect(classifyCorrectionResponse({ ...r(200), data: { memo } } as never, 'credit_memo').kind).toBe('issued')
  })
  it('cancellation done, also when a resend finds it already cancelled', () => {
    expect(classifyCorrectionResponse(r(201), 'cancellation')).toEqual({ kind: 'cancelled' })
    expect(classifyCorrectionResponse(r(422, { error: { code: 'CORRECTION_NOT_ALLOWED', message: 'This invoice is cancelled' } }), 'cancellation')).toEqual({ kind: 'cancelled' })
  })
  it('refused corrections need a person; outages are retried', () => {
    expect(classifyCorrectionResponse(r(422, { error: { code: 'CORRECTION_NOT_ALLOWED', message: 'An invoice with memos cannot be cancelled' } }), 'cancellation').kind).toBe('invalid')
    expect(classifyCorrectionResponse(r(422, { error: { code: 'CORRECTION_NOT_ALLOWED', message: 'Credits (X) would exceed' } }), 'credit_memo').kind).toBe('invalid')
    expect(classifyCorrectionResponse(r(503), 'credit_memo').kind).toBe('retry')
    expect(classifyCorrectionResponse(r(0), 'cancellation').kind).toBe('retry')
  })
})
