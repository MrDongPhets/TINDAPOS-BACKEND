/**
 * VAT Computation Tests
 * Tests the BIR VAT breakdown logic used in salesController.createSale
 */

// Pure functions extracted from salesController for testing
function computeVatBreakdown(
  items: { total: number; vatType: string }[]
): { vatableAmount: number; vatExemptAmount: number; zeroRatedAmount: number; vatAmount: number } {
  let vatableAmount = 0
  let vatExemptAmount = 0
  let zeroRatedAmount = 0

  for (const item of items) {
    if (item.vatType === 'vat_exempt') vatExemptAmount += item.total
    else if (item.vatType === 'zero_rated') zeroRatedAmount += item.total
    else vatableAmount += item.total
  }

  // VAT-inclusive: price already includes 12% VAT
  const vatAmount = parseFloat((vatableAmount * 12 / 112).toFixed(2))
  return { vatableAmount, vatExemptAmount, zeroRatedAmount, vatAmount }
}

function computeOrNumber(counter: number, prefix: string = 'OR'): string {
  return `${prefix}-${String(counter).padStart(8, '0')}`
}

describe('VAT Computation', () => {
  test('all vatable items — VAT is 12/112 of total', () => {
    const items = [
      { total: 112, vatType: 'vatable' },
      { total: 224, vatType: 'vatable' },
    ]
    const result = computeVatBreakdown(items)
    expect(result.vatableAmount).toBe(336)
    expect(result.vatAmount).toBe(36) // 336 * 12/112 = 36
    expect(result.vatExemptAmount).toBe(0)
    expect(result.zeroRatedAmount).toBe(0)
  })

  test('all vat-exempt items — no VAT computed', () => {
    const items = [{ total: 500, vatType: 'vat_exempt' }]
    const result = computeVatBreakdown(items)
    expect(result.vatExemptAmount).toBe(500)
    expect(result.vatAmount).toBe(0)
    expect(result.vatableAmount).toBe(0)
  })

  test('zero-rated items — no VAT', () => {
    const items = [{ total: 200, vatType: 'zero_rated' }]
    const result = computeVatBreakdown(items)
    expect(result.zeroRatedAmount).toBe(200)
    expect(result.vatAmount).toBe(0)
  })

  test('mixed vatable and exempt items', () => {
    const items = [
      { total: 112, vatType: 'vatable' },   // vat = 12
      { total: 100, vatType: 'vat_exempt' },
    ]
    const result = computeVatBreakdown(items)
    expect(result.vatableAmount).toBe(112)
    expect(result.vatExemptAmount).toBe(100)
    expect(result.vatAmount).toBe(12)
  })

  test('unknown vat_type defaults to vatable', () => {
    const items = [{ total: 112, vatType: 'unknown' }]
    const result = computeVatBreakdown(items)
    expect(result.vatableAmount).toBe(112)
    expect(result.vatAmount).toBe(12)
  })

  test('empty cart — all zeros', () => {
    const result = computeVatBreakdown([])
    expect(result.vatableAmount).toBe(0)
    expect(result.vatAmount).toBe(0)
  })
})

describe('OR Number Generation', () => {
  test('generates padded OR number', () => {
    expect(computeOrNumber(1)).toBe('OR-00000001')
    expect(computeOrNumber(100)).toBe('OR-00000100')
    expect(computeOrNumber(99999999)).toBe('OR-99999999')
  })

  test('uses custom prefix', () => {
    expect(computeOrNumber(1, 'CW')).toBe('CW-00000001')
  })

  test('sequential numbers increment correctly', () => {
    const or1 = computeOrNumber(1)
    const or2 = computeOrNumber(2)
    expect(or1).toBe('OR-00000001')
    expect(or2).toBe('OR-00000002')
    expect(or1 < or2).toBe(true) // string sort works for padded numbers
  })
})
