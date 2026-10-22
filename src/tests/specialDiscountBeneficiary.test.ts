/**
 * SC/PWD beneficiary on a sale (createSale) — Invoicing plan P2-5
 */
import { specialDiscountBeneficiary } from '../controllers/pos/salesController'

describe('specialDiscountBeneficiary', () => {
  it('ignores the fields for non-SC/PWD sales', () => {
    expect(specialDiscountBeneficiary('percentage', 'Juan', 'OSCA-1')).toEqual({ required: false, value: null })
  })
  it('accepts a name and ID as printed on the card (trimmed)', () => {
    expect(specialDiscountBeneficiary('senior_citizen', '  Juan Dela Cruz ', ' OSCA 12-345/B ')).toEqual({ required: true, value: { name: 'Juan Dela Cruz', idNumber: 'OSCA 12-345/B' } })
  })
  it('allows none at all (manual stores); the e-invoice requirement is checked against the store', () => {
    expect(specialDiscountBeneficiary('pwd', '', '')).toEqual({ required: true, value: null })
  })
  it('rejects half-filled or invalid details', () => {
    expect(specialDiscountBeneficiary('pwd', 'J', 'PWD-123').error).toMatch(/name/)
    expect(specialDiscountBeneficiary('pwd', 'Juan', 'ab').error).toMatch(/ID number/)
    expect(specialDiscountBeneficiary('pwd', 'Juan', 'ID#123').error).toMatch(/ID number/)
  })
})
