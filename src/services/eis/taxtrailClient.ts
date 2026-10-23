// src/services/eis/taxtrailClient.ts
// Minimal HTTP client for ITBS TaxTrail's Integration API (Bearer sk_test_/sk_live_ key). Invoicing plan P2-3.
// Never logs the API key. Every call has a timeout so a slow ESP can't hang a request.

export interface EspResponse<T = unknown> {
  ok: boolean;
  status: number;           // 0 = network error / timeout (never reached TaxTrail)
  data: T | null;           // TaxTrail envelope `data` on success
  error: { code: string; message: string; details?: unknown } | null;
  retryAfterSec?: number;
}

export interface WhoAmI {
  keyId: string;
  environment: 'test' | 'live' | string;
  scopes: string[];
  tenant: { id: string; tin: string; registeredName: string; serviceModel: string | null };
  operations: { issueInvoice: { allowed: boolean; failures: unknown[] }; submitSales: { allowed: boolean; failures: unknown[] } };
  software?: string;
}

// https only, except http on localhost / 127.0.0.1 / host.docker.internal (your PC, seen from Docker) for local testing
export function normalizeBaseUrl(input: unknown): { value: string; error?: string } {
  const raw = String(input ?? '').trim().replace(/\/+$/, '');
  let url: URL;
  try { url = new URL(raw); } catch { return { value: raw, error: 'Enter the full TaxTrail address, e.g. https://taxtrail.example.com' }; }
  const local = ['localhost', '127.0.0.1', 'host.docker.internal'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return { value: raw, error: 'The TaxTrail address must start with https://' };
  if (url.pathname.replace(/\/+$/, '') !== '' || url.search || url.hash) return { value: raw, error: 'Enter only the address (no path), e.g. https://taxtrail.example.com' };
  return { value: `${url.protocol}//${url.host}` };
}

export const API_KEY_PATTERN = /^sk_(test|live)_[0-9a-f]{16}_[A-Za-z0-9_-]{43}$/;

export async function espRequest<T>(opts: {
  baseUrl: string; apiKey: string; method: 'GET' | 'POST' | 'DELETE'; path: string; body?: unknown; idempotencyKey?: string; timeoutMs?: number;
}): Promise<EspResponse<T>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8000);
  try {
    const res = await fetch(`${opts.baseUrl}/api${opts.path}`, {
      method: opts.method,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${opts.apiKey}`,
        Accept: 'application/json',
        ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.idempotencyKey ? { 'Idempotency-Key': opts.idempotencyKey } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
    const json = (await res.json().catch(() => null)) as { success?: boolean; data?: T; error?: { code: string; message: string; details?: unknown } } | null;
    const retryAfter = Number(res.headers.get('retry-after'));
    return {
      ok: res.ok && json?.success !== false,
      status: res.status,
      data: (json?.data ?? null) as T | null,
      error: res.ok ? null : (json?.error ?? { code: `HTTP_${res.status}`, message: `TaxTrail answered ${res.status}` }),
      retryAfterSec: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
    };
  } catch (err) {
    const timedOut = (err as Error).name === 'AbortError';
    return { ok: false, status: 0, data: null, error: { code: timedOut ? 'TIMEOUT' : 'NETWORK_ERROR', message: timedOut ? 'TaxTrail did not answer in time' : 'Could not reach TaxTrail' } };
  } finally {
    clearTimeout(timer);
  }
}

export const whoami = (baseUrl: string, apiKey: string) =>
  espRequest<WhoAmI>({ baseUrl, apiKey, method: 'GET', path: '/v1/whoami', timeoutMs: 8000 });

// Plain-language summary of a whoami result for the owner
export function describeWhoAmI(w: WhoAmI): { ok: boolean; message: string } {
  const issue = w.operations?.issueInvoice;
  const who = `${w.tenant?.registeredName || 'Taxpayer'} (TIN ${w.tenant?.tin || '—'})`;
  const env = w.environment === 'live' ? 'live' : 'test';
  if (!w.scopes?.includes('invoices:write')) return { ok: false, message: `Connected to ${who}, but this key can't issue invoices (missing invoices:write).` };
  if (!issue?.allowed) return { ok: false, message: `Connected to ${who} (${env}), but TaxTrail doesn't allow issuing invoices yet.` };
  return { ok: true, message: `Connected to ${who} · ${env} key · can issue invoices` };
}
