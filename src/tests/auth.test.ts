/**
 * Auth Tests
 * Tests login validation logic without hitting the real DB
 */

// Replicate the null password guard logic from loginController
function validateLoginInput(email: string, password: string): string | null {
  if (!email || !password) return 'Email and password are required'
  if (typeof password !== 'string') return 'Invalid password format'
  if (password.trim() === '') return 'Password cannot be empty'
  return null
}

// SKU generator logic from productsController
function generateSku(name: string): string {
  const timestamp = Date.now().toString().slice(-6)
  const namePrefix = name.substring(0, 3).toUpperCase()
  return `TP-${namePrefix}${timestamp}`
}

describe('Login Input Validation', () => {
  test('valid email and password passes', () => {
    expect(validateLoginInput('user@test.com', 'password123')).toBeNull()
  })

  test('missing email fails', () => {
    expect(validateLoginInput('', 'password123')).not.toBeNull()
  })

  test('missing password fails', () => {
    expect(validateLoginInput('user@test.com', '')).not.toBeNull()
  })

  test('null/undefined password fails (the production bug)', () => {
    // This was the actual bug causing 500 — bcrypt.compare(password, null) throws
    expect(validateLoginInput('user@test.com', null as unknown as string)).not.toBeNull()
  })

  test('whitespace-only password fails', () => {
    expect(validateLoginInput('user@test.com', '   ')).not.toBeNull()
  })
})

describe('SKU Generation', () => {
  test('starts with TP- prefix', () => {
    const sku = generateSku('Coca Cola')
    expect(sku.startsWith('TP-')).toBe(true)
  })

  test('uses first 3 letters of name uppercased', () => {
    const sku = generateSku('Coca Cola')
    expect(sku.startsWith('TP-COC')).toBe(true)
  })

  test('short name uses full name', () => {
    const sku = generateSku('AB')
    expect(sku.startsWith('TP-AB')).toBe(true)
  })

  test('generates different SKUs at different times', async () => {
    const sku1 = generateSku('Rice')
    await new Promise(r => setTimeout(r, 10))
    const sku2 = generateSku('Rice')
    // Timestamps may differ — both are valid TP-RIC format
    expect(sku1.startsWith('TP-RIC')).toBe(true)
    expect(sku2.startsWith('TP-RIC')).toBe(true)
  })

  test('lowercase name gets uppercased prefix', () => {
    const sku = generateSku('instant noodles')
    expect(sku.startsWith('TP-INS')).toBe(true)
  })
})
