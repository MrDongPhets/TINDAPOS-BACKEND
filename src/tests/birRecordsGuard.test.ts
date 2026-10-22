/**
 * Permanent company delete is refused once there are BIR tax records — Invoicing plan P0-8
 */
import { describeBirLock } from '../services/birRecordsGuard'

describe('describeBirLock', () => {
  it('allows deleting sign-ups / tests / unregistered stores', () => {
    expect(describeBirLock({ ptuStores: [], eisStores: [], einvoices: 0 })).toBeNull()
  })
  it('refuses with every reason listed', () => {
    const msg = describeBirLock({ ptuStores: ['Main'], eisStores: ['Main', 'Branch 2'], einvoices: 3 })!
    expect(msg).toContain('BIR-registered POS (PTU) at Main')
    expect(msg).toContain('e-invoicing on at Main, Branch 2')
    expect(msg).toContain('3 e-invoices sent to TaxTrail')
    expect(msg).toMatch(/Deactivate it instead/)
  })
  it('one e-invoice is enough (store switched back to manual later)', () => {
    expect(describeBirLock({ ptuStores: [], eisStores: [], einvoices: 1 })).toContain('1 e-invoice sent')
  })
})
