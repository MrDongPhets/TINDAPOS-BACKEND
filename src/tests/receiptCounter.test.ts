/**
 * OR Number / Grand Total Accumulator Tests
 * Mocks Supabase and tests receiptCounterService (atomic RPC path + fallbacks)
 */

import { reserveOrNumber, addToGrandTotal, formatOrNumber } from '../services/receiptCounterService'

type Store = { or_counter: number; or_prefix: string | null; grand_total_accumulator: number }

// Mock Supabase: rpc() mimics the Postgres functions (single atomic UPDATE ... RETURNING)
function makeMockSupabase(store: Store | null, { rpcMissing = false } = {}) {
  const updates: Record<string, unknown>[] = []

  const db = {
    rpc: async (fn: string, args: { p_store_id: string; p_amount?: number }) => {
      if (rpcMissing) return { data: null, error: { code: 'PGRST202', message: 'function not found' } }
      if (!store) return { data: [], error: null }
      if (fn === 'reserve_or_number') {
        store.or_counter += 1
        return { data: [{ counter: store.or_counter, prefix: store.or_prefix ?? 'OR' }], error: null }
      }
      if (fn === 'add_to_grand_total') {
        store.grand_total_accumulator += args.p_amount!
        return { data: store.grand_total_accumulator, error: null }
      }
      return { data: null, error: { code: 'UNKNOWN' } }
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () => (store ? { data: { ...store }, error: null } : { data: null, error: { message: 'not found' } }),
        }),
      }),
      update: (vals: Partial<Store>) => ({
        eq: async () => {
          updates.push(vals)
          if (store) Object.assign(store, vals)
          return { error: null }
        },
      }),
    }),
  }

  return { db: db as any, updates }
}

describe('formatOrNumber', () => {
  it('pads the counter to 8 digits', () => {
    expect(formatOrNumber('OR', 42)).toBe('OR-00000042')
    expect(formatOrNumber('ST1', 12345678)).toBe('ST1-12345678')
  })
})

describe('reserveOrNumber (atomic RPC)', () => {
  const OLD_MODE = process.env.DB_MODE
  beforeEach(() => { process.env.DB_MODE = 'supabase' })
  afterAll(() => { process.env.DB_MODE = OLD_MODE })

  it('returns the next OR number from the database function', async () => {
    const store = { or_counter: 41, or_prefix: 'OR', grand_total_accumulator: 0 }
    const { db } = makeMockSupabase(store)
    await expect(reserveOrNumber(db, 'STORE-1')).resolves.toBe('OR-00000042')
  })

  it('gives 20 simultaneous sales 20 unique, sequential OR numbers', async () => {
    const store = { or_counter: 0, or_prefix: 'OR', grand_total_accumulator: 0 }
    const { db } = makeMockSupabase(store)

    const results = await Promise.all(Array.from({ length: 20 }, () => reserveOrNumber(db, 'STORE-1')))

    expect(new Set(results).size).toBe(20)
    expect(results.sort()).toEqual(Array.from({ length: 20 }, (_, i) => formatOrNumber('OR', i + 1)))
  })

  it('throws when the store does not exist', async () => {
    const { db } = makeMockSupabase(null)
    await expect(reserveOrNumber(db, 'MISSING')).rejects.toThrow('not found')
  })

  it('falls back to read-then-write when the migration is not installed', async () => {
    const store = { or_counter: 9, or_prefix: null, grand_total_accumulator: 0 }
    const { db, updates } = makeMockSupabase(store, { rpcMissing: true })

    await expect(reserveOrNumber(db, 'STORE-1')).resolves.toBe('OR-00000010')
    expect(updates).toEqual([{ or_counter: 10 }])
  })
})

describe('addToGrandTotal', () => {
  const OLD_MODE = process.env.DB_MODE
  afterAll(() => { process.env.DB_MODE = OLD_MODE })

  it('adds every concurrent sale to the accumulator (no lost updates)', async () => {
    process.env.DB_MODE = 'supabase'
    const store = { or_counter: 0, or_prefix: 'OR', grand_total_accumulator: 1000 }
    const { db } = makeMockSupabase(store)

    await Promise.all([150, 250.5, 99.5].map(amount => addToGrandTotal(db, 'STORE-1', amount)))

    expect(store.grand_total_accumulator).toBe(1500)
  })

  it('uses read-then-write in SQLite (desktop) mode', async () => {
    process.env.DB_MODE = 'sqlite'
    const store = { or_counter: 0, or_prefix: 'OR', grand_total_accumulator: 100 }
    const { db, updates } = makeMockSupabase(store)

    await addToGrandTotal(db, 'STORE-1', 50)

    expect(updates).toEqual([{ grand_total_accumulator: 150 }])
  })
})
