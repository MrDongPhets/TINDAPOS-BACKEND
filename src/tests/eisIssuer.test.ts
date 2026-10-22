/**
 * E-invoice issuing at checkout + retry rules — Invoicing plan P2-4
 */
import http from 'http'
import type { AddressInfo } from 'net'
import { classifyIssueResponse, nextAttemptDelaySec, toEinvoiceView, MAX_ATTEMPTS } from '../services/eis/eisIssuer'
import { espRequest, type EspResponse } from '../services/eis/taxtrailClient'

const invoice = { id: 'inv-1', invoiceNo: 'TEST-INV-0000000042', totalAmount: '160.00', vatAmount: '0.00', issuedAt: '2026-10-22T03:00:00.000Z' }
const res = (status: number, extra: Partial<EspResponse<{ invoice?: typeof invoice }>> = {}): EspResponse<{ invoice?: typeof invoice }> => ({
  ok: status >= 200 && status < 300, status, data: null, error: status >= 400 || status === 0 ? { code: `E${status}`, message: 'x' } : null, ...extra,
})

describe('classifyIssueResponse', () => {
  it('issued on 201 and on an idempotent replay (200)', () => {
    expect(classifyIssueResponse(res(201, { data: { invoice } }))).toEqual({ kind: 'issued', invoice })
    expect(classifyIssueResponse(res(200, { data: { invoice } })).kind).toBe('issued')
  })
  it('retries network errors, timeouts, rate limits and server errors', () => {
    expect(classifyIssueResponse(res(0)).kind).toBe('retry')
    expect(classifyIssueResponse(res(429, { retryAfterSec: 40 }))).toMatchObject({ kind: 'retry', retryAfterSec: 40 })
    expect(classifyIssueResponse(res(500)).kind).toBe('retry')
    expect(classifyIssueResponse(res(503)).kind).toBe('retry')
  })
  it('needs a person for bad data, reused keys and refused keys', () => {
    expect(classifyIssueResponse(res(400)).kind).toBe('invalid')
    expect(classifyIssueResponse(res(409)).kind).toBe('invalid')
    const v = classifyIssueResponse(res(422, { error: { code: 'INVOICE_VALIDATION_FAILED', message: 'bad', details: { problems: ['line 1'] } } }))
    expect(v).toMatchObject({ kind: 'invalid' })
    expect((v as { error: string }).error).toContain('line 1')
    expect(classifyIssueResponse(res(401)).kind).toBe('config_error')
    expect(classifyIssueResponse(res(403)).kind).toBe('config_error')
    expect(classifyIssueResponse(res(500, { error: { code: 'INVOICE_INTEGRITY_FAILED', message: 'hash' } })).kind).toBe('invalid')
  })
  it('a success without an invoice number is retried, not marked issued', () => {
    expect(classifyIssueResponse(res(201, { data: {} })).kind).toBe('retry')
  })
})

describe('nextAttemptDelaySec', () => {
  it('backs off 30s, 1m, 2m … capped at 2h, and respects Retry-After', () => {
    expect([1, 2, 3, 4].map(n => nextAttemptDelaySec(n))).toEqual([30, 60, 120, 240])
    expect(nextAttemptDelaySec(20)).toBe(7200)
    expect(nextAttemptDelaySec(1, 300)).toBe(300)
    expect(nextAttemptDelaySec(5, 10)).toBe(480)
  })
  it('gives up after about two days', () => {
    let total = 0
    for (let n = 1; n < MAX_ATTEMPTS; n++) total += nextAttemptDelaySec(n)
    expect(total / 3600).toBeGreaterThan(24)
    expect(total / 3600).toBeLessThan(72)
  })
})

describe('toEinvoiceView', () => {
  it('shows the TaxTrail number once issued, and a plain message otherwise', () => {
    expect(toEinvoiceView({ status: 'issued', esp_invoice_no: 'TEST-INV-1', issued_at: 't', last_error: null }))
      .toEqual({ status: 'issued', invoice_no: 'TEST-INV-1', issued_at: 't', message: null })
    expect(toEinvoiceView({ status: 'pending', esp_invoice_no: null, issued_at: null, last_error: 'TIMEOUT' })!.message).toMatch(/pending/)
    expect(toEinvoiceView(null)).toBeNull()
  })
})

describe('POST /v1/invoices request (fake TaxTrail)', () => {
  let server: http.Server
  let baseUrl: string
  const seen: Array<{ auth?: string; key?: string; body: unknown }> = []

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      let raw = ''
      req.on('data', c => { raw += c })
      req.on('end', () => {
        seen.push({ auth: req.headers.authorization, key: req.headers['idempotency-key'] as string, body: JSON.parse(raw || 'null') })
        if (req.url !== '/api/v1/invoices') { res.writeHead(404).end(); return }
        const replay = seen.filter(s => s.key === req.headers['idempotency-key']).length > 1
        res.writeHead(replay ? 200 : 201, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ success: true, data: { invoice, replayed: replay } }))
      })
    })
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => new Promise<void>(r => server.close(() => r())))

  it('sends the key, the Idempotency-Key and the body; a resend gets the same invoice', async () => {
    const body = { docType: 'invoice', lines: [] }
    const send = () => espRequest<{ invoice?: typeof invoice }>({ baseUrl, apiKey: 'sk_test_x', method: 'POST', path: '/v1/invoices', body, idempotencyKey: 'tindapo-sale-1' })
    const first = await send()
    const again = await send()
    expect(first.status).toBe(201)
    expect(again.status).toBe(200)
    expect(classifyIssueResponse(first)).toEqual({ kind: 'issued', invoice })
    expect(classifyIssueResponse(again)).toEqual({ kind: 'issued', invoice })
    expect(seen[0]).toEqual({ auth: 'Bearer sk_test_x', key: 'tindapo-sale-1', body })
  })

  it('a TaxTrail that never answers is a retry, not a failed sale', async () => {
    const slow = http.createServer(() => { /* never responds */ })
    await new Promise<void>(r => slow.listen(0, '127.0.0.1', r))
    const r = await espRequest({ baseUrl: `http://127.0.0.1:${(slow.address() as AddressInfo).port}`, apiKey: 'k', method: 'POST', path: '/v1/invoices', body: {}, idempotencyKey: 'tindapo-x', timeoutMs: 200 })
    slow.closeAllConnections(); slow.close()
    expect(r.status).toBe(0)
    expect(classifyIssueResponse(r as EspResponse<{ invoice?: typeof invoice }>).kind).toBe('retry')
  })
})
