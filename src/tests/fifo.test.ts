/**
 * FIFO Batch Costing Tests
 * Mocks Supabase and tests the depleteBatchesFIFO weighted average cost logic
 */

import { depleteBatchesFIFO, createBatch } from '../services/fifoService'

// Mock Supabase client
function makeMockSupabase(batches: { id: string; cost_price: number; qty_remaining: number }[], productCostPrice = 0) {
  const updatedBatches: Record<string, number> = {}

  const chainable = (resolveValue: unknown): any => ({
    eq: () => chainable(resolveValue),
    gt: () => chainable(resolveValue),
    order: () => Promise.resolve(resolveValue),
    single: () => Promise.resolve(resolveValue),
  })

  return {
    from: (table: string) => ({
      select: (col?: string) => {
        if (col === 'cost_price') {
          // fallback product fetch
          return chainable({ data: { cost_price: productCostPrice }, error: null })
        }
        // batch fetch
        return chainable({ data: batches, error: null })
      },
      insert: () => Promise.resolve({ error: null }),
      update: (vals: { qty_remaining: number }) => ({
        eq: (_col: string, val: string) => {
          updatedBatches[val] = vals.qty_remaining
          return Promise.resolve({ error: null })
        }
      })
    }),
    _updatedBatches: updatedBatches
  } as any
}

describe('FIFO Weighted Average Cost', () => {
  test('single batch — returns exact cost price', async () => {
    const supabase = makeMockSupabase([
      { id: 'b1', cost_price: 10, qty_remaining: 20 }
    ])
    const cost = await depleteBatchesFIFO(supabase, {
      product_id: 'p1', store_id: 's1', qty_sold: 5
    })
    expect(cost).toBe(10)
  })

  test('two batches — weighted average across batches', async () => {
    // 3 units @ ₱10, 2 units @ ₱20 = (30 + 40) / 5 = ₱14
    const supabase = makeMockSupabase([
      { id: 'b1', cost_price: 10, qty_remaining: 3 },
      { id: 'b2', cost_price: 20, qty_remaining: 10 }
    ])
    const cost = await depleteBatchesFIFO(supabase, {
      product_id: 'p1', store_id: 's1', qty_sold: 5
    })
    expect(cost).toBe(14) // (3*10 + 2*20) / 5
  })

  test('qty sold exactly equals first batch — uses only first batch cost', async () => {
    const supabase = makeMockSupabase([
      { id: 'b1', cost_price: 15, qty_remaining: 10 },
      { id: 'b2', cost_price: 25, qty_remaining: 10 }
    ])
    const cost = await depleteBatchesFIFO(supabase, {
      product_id: 'p1', store_id: 's1', qty_sold: 10
    })
    expect(cost).toBe(15)
  })

  test('no batches — falls back to product cost_price', async () => {
    const supabase = makeMockSupabase([], 8)
    const cost = await depleteBatchesFIFO(supabase, {
      product_id: 'p1', store_id: 's1', qty_sold: 3
    })
    expect(cost).toBe(8)
  })

  test('sold more than available batches — uses last batch cost for remainder', async () => {
    // 5 available, selling 8 → 5 @ ₱10 + 3 @ ₱10 (last batch) = ₱10
    const supabase = makeMockSupabase([
      { id: 'b1', cost_price: 10, qty_remaining: 5 }
    ])
    const cost = await depleteBatchesFIFO(supabase, {
      product_id: 'p1', store_id: 's1', qty_sold: 8
    })
    expect(cost).toBe(10)
  })
})

describe('createBatch validation', () => {
  test('skips insert when qty is 0 or negative', async () => {
    const insertCalled: boolean[] = []
    const supabase = {
      from: () => ({
        insert: () => {
          insertCalled.push(true)
          return Promise.resolve({ error: null })
        }
      })
    } as any

    await createBatch(supabase, { product_id: 'p1', store_id: 's1', cost_price: 10, qty: 0 })
    await createBatch(supabase, { product_id: 'p1', store_id: 's1', cost_price: 10, qty: -5 })
    expect(insertCalled.length).toBe(0)
  })

  test('skips insert when cost_price is negative', async () => {
    const insertCalled: boolean[] = []
    const supabase = {
      from: () => ({
        insert: () => {
          insertCalled.push(true)
          return Promise.resolve({ error: null })
        }
      })
    } as any

    await createBatch(supabase, { product_id: 'p1', store_id: 's1', cost_price: -1, qty: 10 })
    expect(insertCalled.length).toBe(0)
  })
})
