/**
 * Invoice seller details (src/services/invoiceSellerService.ts) — Invoicing plan P0-4
 */
import { toInvoiceSeller } from '../services/invoiceSellerService'

const company = { name: 'Demo Bakery', address: 'Company St', tin: null, vat_status: 'vat', bir_registered_name: null, bir_trade_name: null, bir_registered_address: null }
const store = { name: 'BANANASHOP', address: 'Store St', phone: '0917', branch_code: '00101', ptu_number: null, min_number: null, msn_number: null }

describe('toInvoiceSeller', () => {
  it('falls back to the company name and the store address when BIR fields are empty', () => {
    const s = toInvoiceSeller(company, store)
    expect(s.registered_name).toBe('Demo Bakery')
    expect(s.address).toBe('Store St')
    expect(s.branch_code).toBe('00101')
    expect(s.vat_status).toBe('vat')
  })

  it('uses the BIR registration when it is filled', () => {
    const s = toInvoiceSeller({ ...company, tin: '123456789', vat_status: 'non_vat', bir_registered_name: 'JUANA DELA CRUZ', bir_trade_name: 'Aling Nena Store', bir_registered_address: 'BIR Address' },
      { ...store, ptu_number: 'PTU-1', min_number: 'MIN-1', msn_number: 'SN-1' })
    expect(s).toMatchObject({ registered_name: 'JUANA DELA CRUZ', trade_name: 'Aling Nena Store', address: 'BIR Address', tin: '123456789', vat_status: 'non_vat', ptu_number: 'PTU-1' })
  })

  it('defaults to head office and VAT when the store or status is missing', () => {
    const s = toInvoiceSeller({ ...company, vat_status: null }, null)
    expect(s.branch_code).toBe('00000')
    expect(s.vat_status).toBe('vat')
    expect(s.address).toBe('Company St')
  })
})
