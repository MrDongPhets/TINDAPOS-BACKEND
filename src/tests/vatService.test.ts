/**
 * VAT by the company's BIR status (src/services/vatService.ts) — Invoicing plan P0-5
 */
import { computeSaleVat, normalizeVatStatus, specialDiscountTotals } from '../services/vatService'
import { mapSaleToTaxTrail } from '../services/eis/taxtrailMapper'

const items = [
  { total: 112, vatType: 'vatable' as const },
  { total: 100, vatType: 'vat_exempt' as const },
  { total: 50, vatType: 'zero_rated' as const },
]

describe('computeSaleVat', () => {
  it('VAT store: splits by product VAT type, VAT = 12/112 of VATable', () => {
    expect(computeSaleVat({ items, totalAmount: 262, vatStatus: 'vat' }))
      .toEqual({ vatable_amount: 112, vat_exempt_amount: 100, zero_rated_amount: 50, tax_amount: 12 })
  })

  it('VAT store, senior citizen: the whole sale is VAT-exempt', () => {
    expect(computeSaleVat({ items, discountType: 'senior_citizen', totalAmount: 200, vatStatus: 'vat' }))
      .toEqual({ vatable_amount: 0, vat_exempt_amount: 200, zero_rated_amount: 0, tax_amount: 0 })
  })

  it('non-VAT store: no VAT at all, even for VATable products or SC/PWD', () => {
    const zero = { vatable_amount: 0, vat_exempt_amount: 0, zero_rated_amount: 0, tax_amount: 0 }
    expect(computeSaleVat({ items, totalAmount: 262, vatStatus: 'non_vat' })).toEqual(zero)
    expect(computeSaleVat({ items, discountType: 'pwd', totalAmount: 209.6, vatStatus: 'non_vat' })).toEqual(zero)
  })

  it('RBE follows the VAT rules', () => {
    expect(computeSaleVat({ items, totalAmount: 262, vatStatus: 'rbe' }).tax_amount).toBe(12)
  })
})

describe('specialDiscountTotals (senior citizen / PWD, per item)', () => {
  it('VAT store, VATable items: ₱112 → pay ₱80', () => {
    expect(specialDiscountTotals([{ price: 56, quantity: 2, vatType: 'vatable' }], 'vat')).toEqual({ gross: 112, discount: 32, total: 80 })
  })
  it('VAT store with a VAT-exempt item: VAT is NOT removed from the rice (the bug P2-2 found)', () => {
    const t = specialDiscountTotals([{ price: 112, quantity: 1, vatType: 'vatable' }, { price: 100, quantity: 1, vatType: 'vat_exempt' }], 'vat')
    expect(t).toEqual({ gross: 212, discount: 52, total: 160 })   // old whole-total rule charged ₱151.43
  })
  it('non-VAT store: simply 20% off every item', () => {
    expect(specialDiscountTotals([{ price: 20, quantity: 2, vatType: 'vatable' }], 'non_vat')).toEqual({ gross: 40, discount: 8, total: 32 })
  })
  it('always lands on the same total TaxTrail computes for the e-invoice', () => {
    const cases: Array<{ items: Array<{ price: number; quantity: number; vatType: 'vatable' | 'vat_exempt' | 'zero_rated' }>; vat: 'vat' | 'non_vat' }> = [
      { items: [{ price: 9.99, quantity: 3, vatType: 'vatable' }, { price: 0.75, quantity: 7, vatType: 'vatable' }], vat: 'vat' },
      { items: [{ price: 112, quantity: 1, vatType: 'vatable' }, { price: 50, quantity: 2, vatType: 'vat_exempt' }, { price: 33.33, quantity: 3, vatType: 'zero_rated' }], vat: 'vat' },
      { items: [{ price: 17.5, quantity: 1.25, vatType: 'vatable' }], vat: 'non_vat' },
    ]
    for (const c of cases) {
      const ours = specialDiscountTotals(c.items, c.vat)
      const esp = mapSaleToTaxTrail({
        sale: { id: 'x', discount_type: 'senior_citizen', total_amount: ours.total }, vatStatus: c.vat, branchCode: '00000',
        items: c.items.map((i, n) => ({ name: 'Item ' + n, quantity: i.quantity, unit_price: i.price, vat_type: i.vatType })),
        beneficiary: { name: 'Juan Dela Cruz', idNumber: 'OSCA-1' },
      })
      expect(esp.expectedEspTotal).toBe(ours.total)
    }
  })
})

describe('normalizeVatStatus', () => {
  it('defaults unknown or missing values to VAT (today\'s behaviour)', () => {
    expect(normalizeVatStatus(undefined)).toBe('vat')
    expect(normalizeVatStatus('non_vat')).toBe('non_vat')
    expect(normalizeVatStatus('weird')).toBe('vat')
  })
})
