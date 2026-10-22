/**
 * BIR settings validation (src/controllers/client/birSettingsController.ts) — Invoicing plan P0-2
 */
import { cleanText, normalizeBranchCode, normalizeTin, validateCompanyInput, validateStoreInput } from '../controllers/client/birSettingsController'

describe('normalizeTin', () => {
  it('accepts 9 digits with dashes or spaces', () => {
    expect(normalizeTin('123-456-789')).toEqual({ value: '123456789' })
    expect(normalizeTin(' 123 456 789 ')).toEqual({ value: '123456789' })
  })
  it('empty clears the TIN', () => {
    expect(normalizeTin('')).toEqual({ value: null })
    expect(normalizeTin(null)).toEqual({ value: null })
  })
  it('explains when the branch code was typed into the TIN', () => {
    expect(normalizeTin('123-456-789-000').error).toMatch(/branch code/)
  })
  it('rejects letters and short TINs', () => {
    expect(normalizeTin('12345678A').error).toMatch(/only contain numbers/)
    expect(normalizeTin('12345').error).toMatch(/9 digits/)
  })
})

describe('normalizeBranchCode', () => {
  it("pads a 3-digit code to 5 ('101' → '00101')", () => {
    expect(normalizeBranchCode('101')).toEqual({ value: '00101' })
  })
  it('keeps 5 digits; empty means head office', () => {
    expect(normalizeBranchCode('00002')).toEqual({ value: '00002' })
    expect(normalizeBranchCode('')).toEqual({ value: '00000' })
  })
  it('rejects other lengths', () => {
    expect(normalizeBranchCode('1234').error).toBeDefined()
    expect(normalizeBranchCode('12a').error).toBeDefined()
  })
})

describe('cleanText', () => {
  it('trims, turns empty into null, and enforces the max length', () => {
    expect(cleanText('  Aling Nena  ', 200, 'Name')).toEqual({ value: 'Aling Nena' })
    expect(cleanText('   ', 200, 'Name')).toEqual({ value: null })
    expect(cleanText('x'.repeat(51), 50, 'PTU').error).toMatch(/at most 50/)
  })
})

describe('validateCompanyInput', () => {
  it('only updates fields that were sent', () => {
    const { update, errors } = validateCompanyInput({ tin: '123-456-789', vat_status: 'non_vat' })
    expect(errors).toEqual([])
    expect(update).toEqual({ tin: '123456789', vat_status: 'non_vat' })
  })
  it('rejects an unknown VAT status', () => {
    expect(validateCompanyInput({ vat_status: 'exempt' }).errors[0].field).toBe('company.vat_status')
  })
})

describe('validateStoreInput', () => {
  it('normalizes branch code and machine numbers', () => {
    const r = validateStoreInput({ id: 'store_1', branch_code: '101', ptu_number: ' FP012345 ', min_number: '', msn_number: 'SN-1' }, 0)
    expect(r.errors).toEqual([])
    expect(r.update).toEqual({ branch_code: '00101', ptu_number: 'FP012345', min_number: null, msn_number: 'SN-1' })
  })
  it('accepts manual / eis modes (the TaxTrail connection is checked when saving), refuses others, requires the store id', () => {
    expect(validateStoreInput({ id: 's', invoicing_mode: 'eis' }, 0)).toMatchObject({ errors: [], update: { invoicing_mode: 'eis' } })
    const r = validateStoreInput({ invoicing_mode: 'paper' }, 2)
    expect(r.errors.map(e => e.field)).toEqual(['stores[2].id', 'stores[2].invoicing_mode'])
  })
})
