/**
 * Tindapo sale → TaxTrail invoice body (src/services/eis/taxtrailMapper.ts) — Invoicing plan P2-2
 */
import { formatQuantity, mapSaleToTaxTrail, type TindapoItemForEsp } from '../services/eis/taxtrailMapper'

const sale = (over = {}) => ({ id: 'sale-1', or_number: 'OR-00000008', payment_method: 'cash', discount_type: null, discount_amount: 0, total_amount: 55, ...over })
const coke: TindapoItemForEsp = { name: 'Coca-Cola 1.5L', quantity: 2, unit_price: 20, vat_type: 'vatable' }
const noodles: TindapoItemForEsp = { name: 'Chicken Noodles', quantity: 1, unit_price: 15, vat_type: 'vatable' }

describe('mapSaleToTaxTrail', () => {
  it('plain VAT sale: lines as sold, prices include VAT, totals match Tindapo', () => {
    const m = mapSaleToTaxTrail({ sale: sale(), items: [coke, noodles], vatStatus: 'vat', branchCode: '00000' })
    expect(m.idempotencyKey).toBe('tindapo-sale-1')
    expect(m.body).toMatchObject({ docType: 'invoice', branchCode: '00000', pricesIncludeVat: true, reference: 'OR-00000008' })
    expect(m.body.lines).toEqual([
      { description: 'Coca-Cola 1.5L', quantity: '2', unit: 'pc', unitPrice: '20.00', discount: '0.00', vatType: 'vatable' },
      { description: 'Chicken Noodles', quantity: '1', unit: 'pc', unitPrice: '15.00', discount: '0.00', vatType: 'vatable' },
    ])
    expect(m.expectedEspTotal).toBe(55)
    expect(m.tindapoTotal).toBe(55)
    expect(m.body.specialDiscount).toBeUndefined()
  })

  it('VAT-exempt and zero-rated products keep their type', () => {
    const m = mapSaleToTaxTrail({ sale: sale({ total_amount: 600 }), vatStatus: 'vat', branchCode: '00000', items: [
      { name: 'Bigas 1kg', quantity: 2, unit_price: 50, vat_type: 'vat_exempt' },
      { name: 'Export', quantity: 1, unit_price: 500, vat_type: 'zero_rated' },
    ] })
    expect(m.body.lines.map(l => l.vatType)).toEqual(['exempt', 'zero_rated'])
  })

  it('non-VAT store: every line is exempt and prices carry no VAT', () => {
    const m = mapSaleToTaxTrail({ sale: sale(), items: [coke, noodles], vatStatus: 'non_vat', branchCode: '00000' })
    expect(m.body.pricesIncludeVat).toBe(false)
    expect(m.body.lines.every(l => l.vatType === 'exempt')).toBe(true)
    expect(m.expectedEspTotal).toBe(55)
  })

  it('sale-wide 10% discount is spread over the lines and still adds up', () => {
    const m = mapSaleToTaxTrail({ sale: sale({ discount_type: 'percentage', discount_amount: 22.4, total_amount: 201.6 }), vatStatus: 'vat', branchCode: '00000', items: [
      { name: 'A', quantity: 1, unit_price: 112, vat_type: 'vatable' },
      { name: 'B', quantity: 1, unit_price: 112, vat_type: 'vatable', discount_amount: 0 },
    ] })
    expect(m.body.lines.map(l => l.discount)).toEqual(['11.20', '11.20'])
    expect(m.expectedEspTotal).toBe(201.6)
  })

  it('senior citizen: VAT out of the price, exempt, 20% off per line (TaxTrail rule) — matches Tindapo', () => {
    const m = mapSaleToTaxTrail({
      sale: sale({ discount_type: 'senior_citizen', discount_amount: 32, total_amount: 80 }), vatStatus: 'vat', branchCode: '00000',
      items: [{ name: 'Pandesal', quantity: 10, unit_price: 5.6, vat_type: 'vatable' }, { name: 'Kape', quantity: 1, unit_price: 56, vat_type: 'vatable' }],
      beneficiary: { name: 'Juan Dela Cruz', idNumber: 'OSCA-12345' },
    })
    expect(m.body.lines).toEqual([
      { description: 'Pandesal', quantity: '10', unit: 'pc', unitPrice: '5.00', discount: '10.00', vatType: 'exempt' },
      { description: 'Kape', quantity: '1', unit: 'pc', unitPrice: '50.00', discount: '10.00', vatType: 'exempt' },
    ])
    expect(m.body.specialDiscount).toEqual({ type: 'senior_citizen', beneficiaryName: 'Juan Dela Cruz', idNumber: 'OSCA-12345', beneficiaryTin: null })
    expect(m.expectedEspTotal).toBe(80)
    expect(m.tindapoTotal).toBe(80)
  })

  it('senior citizen with awkward prices: per-line rounding still lands on Tindapo\'s total here', () => {
    const m = mapSaleToTaxTrail({
      sale: sale({ discount_type: 'pwd', total_amount: 21.41 }), vatStatus: 'vat', branchCode: '00000',
      items: [{ name: 'Candy', quantity: 3, unit_price: 9.99, vat_type: 'vatable' }],
      beneficiary: { name: 'Maria Santos', idNumber: 'PWD-0001' },
    })
    expect(m.body.lines[0]).toMatchObject({ unitPrice: '8.92', discount: '5.35', vatType: 'exempt' })
    expect(m.expectedEspTotal).toBe(21.41)
  })

  it('non-VAT store + senior citizen: just 20% off the price (matches P0-5)', () => {
    const m = mapSaleToTaxTrail({
      sale: sale({ discount_type: 'senior_citizen', total_amount: 32 }), vatStatus: 'non_vat', branchCode: '00000',
      items: [coke], beneficiary: { name: 'Juan Dela Cruz', idNumber: 'OSCA-1' },
    })
    expect(m.body.lines[0]).toMatchObject({ unitPrice: '20.00', discount: '8.00', vatType: 'exempt' })
    expect(m.expectedEspTotal).toBe(32)
  })

  it('refuses a senior citizen / PWD sale without beneficiary details, and a bad branch code', () => {
    expect(() => mapSaleToTaxTrail({ sale: sale({ discount_type: 'senior_citizen' }), items: [coke], vatStatus: 'vat', branchCode: '00000' })).toThrow(/beneficiary/)
    expect(() => mapSaleToTaxTrail({ sale: sale(), items: [coke], vatStatus: 'vat', branchCode: '101' })).toThrow(/5 digits/)
  })

  it('utang sales are noted as credit', () => {
    const m = mapSaleToTaxTrail({ sale: sale({ payment_method: 'credit' }), items: [coke], vatStatus: 'vat', branchCode: '00000' })
    expect(m.body.notes).toBe('Tindapo OR-00000008 · Payment: Utang (credit)')
  })
})

describe('formatQuantity', () => {
  it('writes up to 4 decimals without trailing zeros', () => {
    expect(formatQuantity(2)).toBe('2')
    expect(formatQuantity('1.5')).toBe('1.5')
    expect(formatQuantity(0.125)).toBe('0.125')
    expect(() => formatQuantity(0)).toThrow()
  })
})
