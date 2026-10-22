/**
 * BIR status from TaxTrail: webhook signature + status mapping — Invoicing plan P2-6
 */
import { createHmac } from 'crypto'
import { currentTransmission, transmissionPatch, verifyTaxTrailSignature, webhookUrl } from '../services/eis/eisStatus'

const secret = 'whsec_test_secret'
const sign = (body: string, t: number, s = secret) => `t=${t},v1=${createHmac('sha256', s).update(`${t}.${body}`).digest('hex')}`

describe('verifyTaxTrailSignature', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'transmission.accepted', data: { invoiceId: 'x' } })
  const now = 1_800_000_000

  it('accepts TaxTrail\'s signature over "<t>.<body>"', () => {
    expect(verifyTaxTrailSignature(sign(body, now), body, [secret], now)).toBe(true)
  })
  it('accepts any v1 during a secret rotation', () => {
    const header = `${sign(body, now, 'whsec_old')},v1=${sign(body, now).split('v1=')[1]}`
    expect(verifyTaxTrailSignature(header, body, [secret], now)).toBe(true)
  })
  it('refuses a changed body, a wrong secret, a missing header and old timestamps', () => {
    expect(verifyTaxTrailSignature(sign(body, now), body.replace('accepted', 'rejected'), [secret], now)).toBe(false)
    expect(verifyTaxTrailSignature(sign(body, now, 'whsec_other'), body, [secret], now)).toBe(false)
    expect(verifyTaxTrailSignature(undefined, body, [secret], now)).toBe(false)
    expect(verifyTaxTrailSignature(sign(body, now - 301), body, [secret], now)).toBe(false)
    expect(verifyTaxTrailSignature(sign(body, now - 299), body, [secret], now)).toBe(true)
    expect(verifyTaxTrailSignature('t=abc,v1=zz', body, [secret], now)).toBe(false)
    expect(verifyTaxTrailSignature(sign(body, now), body, [], now)).toBe(false)
  })
})

describe('transmissionPatch', () => {
  it('maps BIR outcomes onto the e-invoice row', () => {
    expect(transmissionPatch({ status: 'accepted', ackNo: 'ACK-1', submissionId: 's1' }))
      .toEqual({ esp_submission_id: 's1', status: 'accepted', bir_ack_no: 'ACK-1', rejection_code: null, rejection_class: null, last_error: null })
    expect(transmissionPatch({ status: 'rejected', rejectionCode: 'FIELD_INVALID', rejectionClass: 'B' }))
      .toMatchObject({ status: 'rejected', rejection_code: 'FIELD_INVALID', rejection_class: 'B', last_error: 'BIR rejected the invoice (FIELD_INVALID)' })
    expect(transmissionPatch({ status: 'dead_letter' })).toMatchObject({ status: 'dead_letter' })
  })
  it('leaves in-progress transmissions alone', () => {
    for (const s of ['queued', 'claimed', 'send_started', 'retry_wait', 'outcome_unknown', 'held', 'in_batch', 'result_pending']) {
      expect(transmissionPatch({ status: s })).toBeNull()
    }
  })
})

describe('currentTransmission', () => {
  it('uses the newest revision that was not superseded', () => {
    expect(currentTransmission([
      { submissionId: 'a', status: 'superseded', revision: 1 },
      { submissionId: 'b', status: 'accepted', revision: 2 },
    ])?.submissionId).toBe('b')
    expect(currentTransmission([{ submissionId: 'a', status: 'superseded' }])).toBeNull()
    expect(currentTransmission([])).toBeNull()
  })
})

describe('webhookUrl', () => {
  const saved = process.env.BACKEND_URL
  afterEach(() => { process.env.BACKEND_URL = saved })
  it('only for a public https server (TaxTrail refuses others)', () => {
    process.env.BACKEND_URL = 'https://api.tindapo.com/'
    expect(webhookUrl('c1')).toBe('https://api.tindapo.com/eis/webhooks/taxtrail/c1')
    process.env.BACKEND_URL = 'http://localhost:3099'
    expect(webhookUrl('c1')).toBeNull()
    delete process.env.BACKEND_URL
    expect(webhookUrl('c1')).toBeNull()
  })
})
