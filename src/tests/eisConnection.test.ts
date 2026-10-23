/**
 * E-invoicing connection helpers — Invoicing plan P2-3
 */
import { decryptSecret, encryptSecret, encryptionConfigured } from '../services/eis/secretBox'
import { API_KEY_PATTERN, describeWhoAmI, normalizeBaseUrl, type WhoAmI } from '../services/eis/taxtrailClient'

describe('secretBox', () => {
  const saved = process.env.EIS_ENCRYPTION_KEY
  afterEach(() => { process.env.EIS_ENCRYPTION_KEY = saved })

  it('round-trips a secret and never stores it in plain text', () => {
    process.env.EIS_ENCRYPTION_KEY = 'a'.repeat(64)
    const enc = encryptSecret('sk_test_secret')
    expect(enc.startsWith('v1:')).toBe(true)
    expect(enc).not.toContain('sk_test_secret')
    expect(decryptSecret(enc)).toBe('sk_test_secret')
  })

  it('detects tampering', () => {
    process.env.EIS_ENCRYPTION_KEY = 'b'.repeat(64)
    const [v, iv, tag, data] = encryptSecret('hello').split(':')
    const flipped = Buffer.from(data, 'base64'); flipped[0] ^= 1
    expect(() => decryptSecret([v, iv, tag, flipped.toString('base64')].join(':'))).toThrow()
  })

  it('reports when no key is configured', () => {
    delete process.env.EIS_ENCRYPTION_KEY
    expect(encryptionConfigured()).toBe(false)
    expect(() => encryptSecret('x')).toThrow(/EIS_ENCRYPTION_KEY/)
  })
})

describe('normalizeBaseUrl', () => {
  it('accepts https, and http only for localhost', () => {
    expect(normalizeBaseUrl('https://taxtrail.example.com/')).toEqual({ value: 'https://taxtrail.example.com' })
    expect(normalizeBaseUrl('http://localhost:3001')).toEqual({ value: 'http://localhost:3001' })
    expect(normalizeBaseUrl('http://host.docker.internal:3002')).toEqual({ value: 'http://host.docker.internal:3002' })
    expect(normalizeBaseUrl('http://taxtrail.example.com').error).toMatch(/https/)
    expect(normalizeBaseUrl('https://taxtrail.example.com/api/v1').error).toMatch(/no path/)
    expect(normalizeBaseUrl('not a url').error).toBeDefined()
  })
})

describe('API key format', () => {
  it('matches TaxTrail keys only', () => {
    expect(API_KEY_PATTERN.test(`sk_test_${'0'.repeat(16)}_${'A'.repeat(43)}`)).toBe(true)
    expect(API_KEY_PATTERN.test('sk_test_short')).toBe(false)
  })
})

describe('describeWhoAmI', () => {
  const base: WhoAmI = {
    keyId: 'k', environment: 'test', scopes: ['invoices:write', 'invoices:read'],
    tenant: { id: 't', tin: '900000001', registeredName: 'Sandbox Store', serviceModel: 'full' },
    operations: { issueInvoice: { allowed: true, failures: [] }, submitSales: { allowed: false, failures: [] } },
  }
  it('ok when the key can issue invoices', () => {
    expect(describeWhoAmI(base)).toEqual({ ok: true, message: 'Connected to Sandbox Store (TIN 900000001) · test key · can issue invoices' })
  })
  it('not ok without the scope or when TaxTrail blocks issuing', () => {
    expect(describeWhoAmI({ ...base, scopes: ['invoices:read'] }).ok).toBe(false)
    expect(describeWhoAmI({ ...base, operations: { ...base.operations, issueInvoice: { allowed: false, failures: ['PTI_NOT_ACTIVE'] } } }).message).toMatch(/doesn't allow/)
  })
})
