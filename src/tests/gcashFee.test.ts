/**
 * GCash Fee Tests
 * Tests the cash-in / cash-out fee rules in gcashFeeService
 */

import { computeGcashFee, normalizeGcashSettings, DEFAULT_GCASH_SETTINGS } from '../services/gcashFeeService'

describe('computeGcashFee — bracket mode (₱10 per ₱500)', () => {
  const rule = DEFAULT_GCASH_SETTINGS.cash_in

  it('charges one bracket for amounts up to ₱500', () => {
    expect(computeGcashFee(100, rule)).toBe(10)
    expect(computeGcashFee(500, rule)).toBe(10)
  })

  it('charges per started bracket', () => {
    expect(computeGcashFee(501, rule)).toBe(20)
    expect(computeGcashFee(1000, rule)).toBe(20)
    expect(computeGcashFee(2500, rule)).toBe(50)
  })

  it('returns 0 for zero or invalid amounts', () => {
    expect(computeGcashFee(0, rule)).toBe(0)
    expect(computeGcashFee(-50, rule)).toBe(0)
    expect(computeGcashFee(NaN, rule)).toBe(0)
  })
})

describe('computeGcashFee — percent mode', () => {
  const rule = { mode: 'percent' as const, bracket_amount: 500, bracket_fee: 10, percent: 2, minimum_fee: 15 }

  it('charges the percentage', () => {
    expect(computeGcashFee(1000, rule)).toBe(20)
    expect(computeGcashFee(1234, rule)).toBe(24.68)
  })

  it('never charges below the minimum fee', () => {
    expect(computeGcashFee(100, rule)).toBe(15)
  })
})

describe('normalizeGcashSettings', () => {
  it('falls back to defaults when nothing is saved', () => {
    expect(normalizeGcashSettings(undefined)).toEqual(DEFAULT_GCASH_SETTINGS)
  })

  it('keeps valid saved values and repairs invalid ones', () => {
    const settings = normalizeGcashSettings({
      cash_in: { mode: 'bracket', bracket_amount: 1000, bracket_fee: 15, percent: 2, minimum_fee: 0 },
      cash_out: { mode: 'percent', bracket_amount: 0, bracket_fee: -5, percent: 3, minimum_fee: 20 } as never,
    })
    expect(settings.cash_in.bracket_amount).toBe(1000)
    expect(settings.cash_in.bracket_fee).toBe(15)
    expect(settings.cash_out.mode).toBe('percent')
    expect(settings.cash_out.bracket_amount).toBe(500) // 0 would divide by zero
    expect(settings.cash_out.bracket_fee).toBe(10)     // negative → default
    expect(settings.cash_out.percent).toBe(3)
  })
})
