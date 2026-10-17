/**
 * Barcode Lookup Tests
 * Tests how the shared-catalog suggestion picks a product name
 */

import { mostCommon, CORPORATE_NAME } from '../controllers/client/barcodeLookupController'

describe('mostCommon', () => {
  it('picks the name used by the most stores', () => {
    expect(mostCommon(['Lucky Me Pancit Canton', 'Pancit Canton Lucky Me', 'Lucky Me Pancit Canton'])).toBe('Lucky Me Pancit Canton')
  })

  it('treats case and extra spaces as the same name, keeping the first spelling', () => {
    expect(mostCommon(['Coke 1.5L', 'coke  1.5l', 'Sprite 1.5L'])).toBe('Coke 1.5L')
  })

  it('ignores empty values', () => {
    expect(mostCommon(['', '   ', 'Bear Brand 33g'])).toBe('Bear Brand 33g')
    expect(mostCommon(['', ''])).toBeNull()
  })
})

describe('CORPORATE_NAME (Open Food Facts brand filter)', () => {
  it('flags legal company names', () => {
    expect(CORPORATE_NAME.test('COCA-COLA SERVICES SA/NV')).toBe(true)
    expect(CORPORATE_NAME.test('Universal Robina Corp.')).toBe(true)
    expect(CORPORATE_NAME.test('Monde Nissin Inc')).toBe(true)
  })

  it('keeps real brand names', () => {
    expect(CORPORATE_NAME.test("Piatto's")).toBe(false)
    expect(CORPORATE_NAME.test('Lucky Me!')).toBe(false)
    expect(CORPORATE_NAME.test('Bear Brand')).toBe(false)
  })
})
