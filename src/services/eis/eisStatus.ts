// src/services/eis/eisStatus.ts
// BIR status of issued e-invoices — Invoicing plan P2-6.
// TaxTrail sends each invoice to BIR on its own; Tindapo learns the outcome two ways:
//  1. Webhook (fast): TaxTrail POSTs transmission.accepted / rejected / dead_lettered to
//     /eis/webhooks/taxtrail/:companyId, signed `X-TaxTrail-Signature: t=<unix>,v1=<hex HMAC-SHA256 of "<t>.<body>">`.
//     Delivered at least once and in no global order → dedupe on the event id, ignore older `resource.sequence`.
//  2. Polling (fallback): the worker asks GET /v1/transmissions?invoiceId=… for invoices still waiting on BIR.
import { createHmac, timingSafeEqual } from 'crypto';
import { getDb } from '../../config/database';
import { decryptSecret, encryptSecret } from './secretBox';
import { espRequest } from './taxtrailClient';

type Db = ReturnType<typeof getDb>;
const nowIso = () => new Date().toISOString();

export const SIGNATURE_TOLERANCE_SEC = 300;
export const WEBHOOK_EVENTS = ['invoice.created', 'transmission.accepted', 'transmission.rejected', 'transmission.dead_lettered'];

// `t=<unix>,v1=<hex>[,v1=<hex>]` — any v1 matching any of our secrets (TaxTrail signs with old + new during rotation)
export function verifyTaxTrailSignature(header: string | undefined, rawBody: string, secrets: string[], nowSec = Math.floor(Date.now() / 1000)): boolean {
  if (!header || !secrets.length) return false;
  const parts = header.split(',').map((p) => p.trim());
  const t = Number(parts.find((p) => p.startsWith('t='))?.slice(2));
  if (!Number.isInteger(t) || Math.abs(nowSec - t) > SIGNATURE_TOLERANCE_SEC) return false;
  const given = parts.filter((p) => p.startsWith('v1=')).map((p) => p.slice(3)).filter((h) => /^[0-9a-f]{64}$/.test(h));
  for (const secret of secrets) {
    const expected = Buffer.from(createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex'));
    if (given.some((g) => timingSafeEqual(Buffer.from(g), expected))) return true;
  }
  return false;
}

// TaxTrail transmission status → what changes on our eis_invoices row (null = still on its way to BIR)
export function transmissionPatch(t: { status?: string; ackNo?: string | null; rejectionCode?: string | null; rejectionClass?: string | null; lastError?: string | null; submissionId?: string | null }): Record<string, unknown> | null {
  const base = t.submissionId ? { esp_submission_id: t.submissionId } : {};
  switch (t.status) {
    case 'accepted':
      return { ...base, status: 'accepted', bir_ack_no: t.ackNo ?? null, rejection_code: null, rejection_class: null, last_error: null };
    case 'rejected':
      return { ...base, status: 'rejected', rejection_code: t.rejectionCode ?? null, rejection_class: t.rejectionClass ?? null, last_error: t.lastError ?? `BIR rejected the invoice${t.rejectionCode ? ` (${t.rejectionCode})` : ''}` };
    case 'dead_letter':
      return { ...base, status: 'dead_letter', last_error: t.lastError ?? 'TaxTrail could not deliver the invoice to BIR' };
    default:
      return null;
  }
}

export interface TaxTrailEvent {
  id: string;
  type: string;
  createdAt?: string;
  resource?: { id?: string; sequence?: number };
  data?: { invoiceId?: string; invoiceNo?: string; submissionId?: string; status?: string; ackNo?: string | null; rejectionCode?: string | null; rejectionClass?: string | null };
}

/** Apply one verified webhook event. Returns what happened (for the log / response). */
export async function handleTaxTrailEvent(companyId: string, ev: TaxTrailEvent): Promise<'duplicate' | 'applied' | 'ignored' | 'unknown_invoice' | 'stale'> {
  const db = getDb();
  // Dedupe: TaxTrail resends the same event id on retries / redelivery
  const { error: dupErr } = await db.from('eis_webhook_events').insert({ event_id: ev.id, company_id: companyId, event_type: ev.type });
  if (dupErr) {
    const { data: seen } = await db.from('eis_webhook_events').select('event_id').eq('event_id', ev.id).limit(1);
    if (seen?.length) return 'duplicate';
    throw dupErr;
  }

  const invoiceId = ev.data?.invoiceId;
  if (!invoiceId || !(ev.type.startsWith('transmission.') || ev.type === 'invoice.created')) return 'ignored';
  const { data: rows } = await db.from('eis_invoices').select('id, status, last_event_seq')
    .eq('company_id', companyId).eq('esp_invoice_id', invoiceId).limit(1);
  const row = rows?.[0] as { id: string; status: string; last_event_seq: number | string | null } | undefined;
  if (!row) return 'unknown_invoice';

  if (ev.type === 'invoice.created') {
    if (!ev.data?.submissionId) return 'ignored';
    await db.from('eis_invoices').update({ esp_submission_id: ev.data.submissionId, updated_at: nowIso() }).eq('id', row.id);
    return 'applied';
  }

  const seq = Number(ev.resource?.sequence);
  if (Number.isFinite(seq) && row.last_event_seq != null && seq <= Number(row.last_event_seq)) return 'stale';
  const patch = transmissionPatch({ ...ev.data, status: ev.data?.status ?? ev.type.replace('transmission.', '').replace('dead_lettered', 'dead_letter') });
  if (!patch) return 'ignored';
  const { error } = await db.from('eis_invoices').update({
    ...patch, ...(Number.isFinite(seq) ? { last_event_seq: seq } : {}), status_checked_at: nowIso(), status_changed_at: nowIso(), updated_at: nowIso(),
  }).eq('id', row.id);
  if (error) throw error;
  return 'applied';
}

/** Signing secrets for a company's webhook (null = no webhook registered) */
export async function webhookSecrets(companyId: string): Promise<string[] | null> {
  const { data } = await getDb().from('eis_connections').select('webhook_secret_enc').eq('company_id', companyId).limit(1);
  const enc = data?.[0]?.webhook_secret_enc as string | null | undefined;
  if (!enc) return null;
  try { return [decryptSecret(enc)]; } catch { return null; }
}

// ── Polling fallback ──
export const POLL_WITH_WEBHOOK_MIN = 30;   // webhook registered: a slow safety net
export const POLL_WITHOUT_WEBHOOK_MIN = 2; // no webhook (e.g. local server): polling is the only way
export const POLL_MAX_AGE_DAYS = 7;

interface TransmissionItem { submissionId: string; status: string; ackNo?: string | null; rejectionCode?: string | null; rejectionClass?: string | null; lastError?: string | null; revision?: number; updatedAt?: string }

// The transmission that counts: newest revision that wasn't replaced
export function currentTransmission(items: TransmissionItem[]): TransmissionItem | null {
  const live = items.filter((i) => i.status !== 'superseded');
  if (!live.length) return null;
  return [...live].sort((a, b) => (b.revision ?? 0) - (a.revision ?? 0) || String(b.updatedAt).localeCompare(String(a.updatedAt)))[0];
}

export async function pollBirStatus(limit = 20): Promise<{ checked: number; updated: number }> {
  const db = getDb();
  const since = new Date(Date.now() - POLL_MAX_AGE_DAYS * 86_400_000).toISOString();
  const { data, error } = await db.from('eis_invoices').select('id, company_id, esp_invoice_id, status_checked_at')
    .eq('status', 'issued').gte('issued_at', since).order('status_checked_at', { ascending: true, nullsFirst: true }).limit(limit * 3);
  if (error) throw error;

  const conns = new Map<string, { baseUrl: string; apiKey: string; webhook: boolean } | null>();
  let checked = 0, updated = 0;
  for (const row of (data || []) as Array<{ id: string; company_id: string; esp_invoice_id: string | null; status_checked_at: string | null }>) {
    if (checked >= limit || !row.esp_invoice_id) continue;
    if (!conns.has(row.company_id)) {
      const { data: c } = await db.from('eis_connections').select('base_url, api_key_enc, webhook_id').eq('company_id', row.company_id).limit(1);
      let conn = null;
      try { if (c?.[0]) conn = { baseUrl: c[0].base_url, apiKey: decryptSecret(c[0].api_key_enc), webhook: !!c[0].webhook_id }; } catch { /* unreadable key */ }
      conns.set(row.company_id, conn);
    }
    const conn = conns.get(row.company_id);
    if (!conn) continue;
    const everyMin = conn.webhook ? POLL_WITH_WEBHOOK_MIN : POLL_WITHOUT_WEBHOOK_MIN;
    if (row.status_checked_at && Date.now() - new Date(row.status_checked_at).getTime() < everyMin * 60_000) continue;

    checked++;
    const res = await espRequest<{ items: TransmissionItem[] }>({
      baseUrl: conn.baseUrl, apiKey: conn.apiKey, method: 'GET', path: `/v1/transmissions?invoiceId=${encodeURIComponent(row.esp_invoice_id)}&limit=10`, timeoutMs: 10_000,
    });
    const t = res.ok ? currentTransmission(res.data?.items || []) : null;
    const patch = t ? transmissionPatch(t) : null;
    await db.from('eis_invoices').update({
      ...(patch ?? (t ? { esp_submission_id: t.submissionId } : {})),
      ...(patch ? { status_changed_at: nowIso() } : {}),
      status_checked_at: nowIso(), updated_at: nowIso(),
    }).eq('id', row.id).eq('status', 'issued');
    if (patch) updated++;
  }
  return { checked, updated };
}

// ── Webhook registration (done for the owner when the connection is saved) ──
export function webhookUrl(companyId: string): string | null {
  const base = (process.env.BACKEND_URL || '').trim().replace(/\/+$/, '');
  // TaxTrail only delivers to public https addresses
  if (!/^https:\/\//.test(base) || /\/\/(localhost|127\.0\.0\.1)/.test(base)) return null;
  return `${base}/eis/webhooks/taxtrail/${companyId}`;
}

export async function registerWebhook(companyId: string, baseUrl: string, apiKey: string): Promise<{ ok: boolean; message: string }> {
  const url = webhookUrl(companyId);
  if (!url) return { ok: false, message: 'Status updates: checked every few minutes (this server has no public https address for webhooks).' };
  const db = getDb();
  const { data: c } = await db.from('eis_connections').select('webhook_id').eq('company_id', companyId).limit(1);
  if (c?.[0]?.webhook_id) await unregisterWebhook(companyId, baseUrl, apiKey);

  const res = await espRequest<{ id: string; secret: string }>({ baseUrl, apiKey, method: 'POST', path: '/v1/webhooks', body: { url, events: WEBHOOK_EVENTS }, timeoutMs: 10_000 });
  if (!res.ok || !res.data?.id || !res.data?.secret) {
    return { ok: false, message: `Status updates: checked every few minutes (TaxTrail webhook not set up: ${res.error?.message || res.status}).` };
  }
  await db.from('eis_connections').update({ webhook_id: res.data.id, webhook_secret_enc: encryptSecret(res.data.secret), updated_at: nowIso() }).eq('company_id', companyId);
  return { ok: true, message: 'Status updates: instant (TaxTrail webhook set up).' };
}

// Best effort — the connection is removed either way
export async function unregisterWebhook(companyId: string, baseUrl: string, apiKey: string): Promise<void> {
  const db = getDb();
  const { data: c } = await db.from('eis_connections').select('webhook_id').eq('company_id', companyId).limit(1);
  const id = c?.[0]?.webhook_id as string | undefined;
  if (!id) return;
  await espRequest({ baseUrl, apiKey, method: 'DELETE', path: `/v1/webhooks/${encodeURIComponent(id)}`, timeoutMs: 8000 });
  await db.from('eis_connections').update({ webhook_id: null, webhook_secret_enc: null, updated_at: nowIso() }).eq('company_id', companyId);
}
