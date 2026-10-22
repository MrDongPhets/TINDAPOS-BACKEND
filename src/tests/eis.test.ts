/**
 * EIS e-invoice builder tests (src/services/eis/eisInvoice.ts) — official CRM/POS format
 * Tindapo sale (VAT-inclusive prices) → BIR EIS JSON amounts
 */
import { buildEisInvoice, idsForSale, makeEisUniqueId, yyyymmdd, type EisSale, type EisSeller } from '../services/eis/eisInvoice'
import { CORRECTION_CD, DOC_TYPE, SELLER_TYPE } from '../services/eis/eisSpec'

const seller: EisSeller = {
  tin: '000123456', branchCd: '00000', type: SELLER_TYPE.VAT, regNm: 'TEST SELLER', regAddr: 'Test Address',
  ptuNum: 'PTU-1', min: 'MIN-1', msn: 'MSN-1',
}
const ids = () => { let n = 0; return { certId: 'TESTCERT', nextControl: () => String(++n).padStart(8, '0') } }
const at = new Date('2026-10-21T02:30:00Z') // 10:30 AM Manila
const sale = (over: Partial<EisSale>): EisSale => ({ receipt_no: 'OR-00000001', issued_at: at, items: [], ...over })

describe('buildEisInvoice (CRM/POS)', () => {
  it('cash VATable sale: VAT removed, NetAmtPay equals the amount paid', () => {
    const { invoice, amountPaid, roundingDiff } = buildEisInvoice(sale({ items: [
      { name: 'Coca-Cola 1.5L', quantity: 2, unit_price: 20 },
      { name: 'Chicken Noodles', quantity: 1, unit_price: 15 },
    ] }), seller, ids())
    expect(invoice.DocType).toBe(DOC_TYPE.INVOICE)
    expect(invoice.VATSales).toBe(49.11)
    expect(invoice.TotSalesAmt).toBe(49.11)
    expect(invoice.TotNetSalesAftDisct).toBe(49.11)
    expect(invoice.VATAmt).toBe(5.89)
    expect(invoice.NetAmtPay).toBe(55)
    expect(amountPaid).toBe(55)
    expect(roundingDiff).toBe(0)
    expect(invoice).not.toHaveProperty('ItemList') // CRM/POS e-invoices carry totals only
  })

  it('VATable + VAT-exempt items stay in ONE document', () => {
    const { invoice } = buildEisInvoice(sale({ items: [
      { name: 'Coca-Cola 1.5L', quantity: 1, unit_price: 56 },
      { name: 'Bigas 1kg', quantity: 2, unit_price: 50, vat_type: 'vat_exempt' },
    ] }), seller, ids())
    expect(invoice.VATSales).toBe(50)
    expect(invoice.ExemptSales).toBe(100)
    expect(invoice.TotSalesAmt).toBe(150)
    expect(invoice.VATAmt).toBe(6)
    expect(invoice.NetAmtPay).toBe(156)
  })

  it('senior citizen: whole sale VAT-exempt, 20% off the VAT-exclusive price', () => {
    const { invoice, amountPaid } = buildEisInvoice(sale({ discount_type: 'senior_citizen', items: [
      { name: 'Pandesal', quantity: 10, unit_price: 5.6 },
      { name: 'Kape', quantity: 1, unit_price: 56 },
    ] }), seller, ids())
    expect(invoice.VATSales).toBe(0)
    expect(invoice.ExemptSales).toBe(100)
    expect(invoice.Discount.ScAmt).toBe(20)
    expect(invoice.Discount.PwdAmt).toBe(0)
    expect(invoice.TotNetSalesAftDisct).toBe(80)
    expect(invoice.VATAmt).toBe(0)
    expect(amountPaid).toBe(80)
  })

  it('regular 10% discount: RegAmt excludes VAT, VAT on the discounted amount', () => {
    const { invoice, amountPaid } = buildEisInvoice(sale({ discount_type: 'percentage', discount_value: 10, items: [
      { name: 'A', quantity: 1, unit_price: 112 },
      { name: 'B', quantity: 1, unit_price: 112 },
    ] }), seller, ids())
    expect(invoice.TotSalesAmt).toBe(200)
    expect(invoice.Discount.RegAmt).toBe(20)
    expect(invoice.TotNetSalesAftDisct).toBe(180)
    expect(invoice.VATAmt).toBe(21.6)
    expect(invoice.NetAmtPay).toBe(201.6)
    expect(amountPaid).toBe(201.6)
  })

  it('spec formula holds: TotNetSalesAftDisct = TotSalesAmt + OtherTaxRev - discounts', () => {
    const { invoice } = buildEisInvoice(sale({ discount_type: 'fixed', discount_value: 7.77, items: [
      { name: 'A', quantity: 3, unit_price: 9.99, discount_amount: 1 },
      { name: 'B', quantity: 2, unit_price: 50, vat_type: 'vat_exempt' },
      { name: 'C', quantity: 1, unit_price: 30, vat_type: 'zero_rated' },
    ] }), seller, ids())
    const d = invoice.Discount
    expect(invoice.TotSalesAmt).toBeCloseTo(invoice.VATSales + invoice.ExemptSales + invoice.ZeroSales, 2)
    expect(invoice.TotNetSalesAftDisct).toBeCloseTo(invoice.TotSalesAmt + invoice.OtherTaxRev - (d.ScAmt + d.PwdAmt + d.RegAmt + d.SpeAmt), 2)
  })

  it('adjustment (void) document: DocType 06, negative amounts, points to the original', () => {
    const items = [{ name: 'X', quantity: 1, unit_price: 112 }]
    const { invoice } = buildEisInvoice(sale({ items }), seller, ids(),
      { adjustment: { code: CORRECTION_CD.CANCELLATION, prevUniqueId: '20261021TESTCERT00000001' } })
    expect(invoice.DocType).toBe(DOC_TYPE.ADJUSTMENT)
    expect(invoice.CorrYN).toBe('Y')
    expect(invoice.CorrectionCd).toBe('04')
    expect(invoice.PrevUniqueId).toBe('20261021TESTCERT00000001')
    expect(invoice.NetAmtPay).toBe(-112)
    expect(invoice.VATAmt).toBe(-12)
  })

  it('requires PTU, MIN and MSN, and a 9-digit TIN', () => {
    const items = [{ name: 'X', quantity: 1, unit_price: 1 }]
    expect(() => buildEisInvoice(sale({ items }), { ...seller, min: '' }, ids())).toThrow(/PtuNum, Min and Msn/)
    expect(() => buildEisInvoice(sale({ items }), { ...seller, tin: '000-123-456' }, ids())).toThrow(/9 digits/)
  })

  it('BusinessNm falls back to the registered name', () => {
    const { invoice } = buildEisInvoice(sale({ items: [{ name: 'X', quantity: 1, unit_price: 1 }] }), seller, ids())
    expect(invoice.SellerInfo.BusinessNm).toBe('TEST SELLER')
    expect(invoice.SellerInfo.Type).toBe('0')
  })
})

describe('EisUniqueId', () => {
  it('is date (8) + EIS Cert number (8) + control value (8)', () => {
    const id = makeEisUniqueId(at, ids())
    expect(id).toBe('20261021TESTCERT00000001')
  })

  it('uses the Philippine date even when the server clock is UTC', () => {
    // 2026-10-21 07:00 in Manila = 2026-10-20 23:00 UTC
    expect(yyyymmdd(new Date('2026-10-20T23:00:00Z'))).toBe('20261021')
  })

  it('same sale → same id; same OR number in another store → different id', () => {
    const items = [{ name: 'Coke', quantity: 1, unit_price: 56 }]
    const build = (store: string) => buildEisInvoice(sale({ receipt_no: 'OR-00000008', items }), seller, idsForSale('TESTCERT', 'OR-00000008', store)).invoice.EisUniqueId
    expect(build('store_a')).toBe(build('store_a'))
    expect(build('store_a')).not.toBe(build('store_b'))
    expect(build('store_a')).toHaveLength(24)
    expect(build('store_a').endsWith('000008')).toBe(true)
  })

  it('rejects an EIS Cert number that is not 8 characters', () => {
    expect(() => makeEisUniqueId(at, { certId: 'TESTCERT01', nextControl: () => '00000001' })).toThrow(/8 digits/)
  })
})
