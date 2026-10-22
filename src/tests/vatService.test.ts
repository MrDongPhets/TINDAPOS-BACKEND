/**
 * VAT by the company's BIR status (src/services/vatService.ts) — Invoicing plan P0-5
 */
import { computeSaleVat, normalizeVatStatus, scPwdDiscount } from '../services/vatService'

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

describe('scPwdDiscount', () => {
  it('VAT store: remove VAT, then 20% off (₱112 → pay ₱80, discount ₱32)', () => {
    expect(scPwdDiscount(112, 'vat')).toBe(32)
  })
  it('non-VAT store: simply 20% off (₱112 → discount ₱22.40)', () => {
    expect(scPwdDiscount(112, 'non_vat')).toBe(22.4)
  })
})

describe('normalizeVatStatus', () => {
  it('defaults unknown or missing values to VAT (today\'s behaviour)', () => {
    expect(normalizeVatStatus(undefined)).toBe('vat')
    expect(normalizeVatStatus('non_vat')).toBe('non_vat')
    expect(normalizeVatStatus('weird')).toBe('vat')
  })
})
