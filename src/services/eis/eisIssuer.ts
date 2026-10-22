// src/services/eis/eisIssuer.ts
// E-invoice stores: TaxTrail ISSUES the invoice for each sale — Invoicing plan P2-4.
//  - Checkout: the sale is saved first (never lost), then queued in eis_invoices and sent once with a short timeout.
//  - Not issued yet (no internet, TaxTrail slow/down, rate limit) → stays `pending`; the retry worker resends it
//    with the SAME Idempotency-Key, so TaxTrail can never issue two invoices for one sale.
//  - TaxTrail refuses the data (400/409/422) → `invalid`; the key/taxpayer is not allowed (401/403) → `config_error`.
//    Both need a person; they are never retried automatically.
import { getDb } from '../../config/database';
import { normalizeVatStatus } from '../vatService';
import { decryptSecret } from './secretBox';
import { espRequest, type EspResponse } from './taxtrailClient';
import { mapSaleToTaxTrail, type TaxTrailIssueBody } from './taxtrailMapper';

type Db = ReturnType<typeof getDb>;

export type EisInvoiceStatus = 'pending' | 'issued' | 'accepted' | 'rejected' | 'dead_letter' | 'invalid' | 'config_error';

export interface EspInvoiceSummary {
  id: string; invoiceNo: string; totalAmount: string; vatAmount: string; issuedAt: string; status?: string; businessDate?: string;
}

// What the POS / sale detail shows for a sale's e-invoice
export interface SaleEinvoiceView {
  status: EisInvoiceStatus;
  invoice_no: string | null;
  issued_at: string | null;
  message: string | null;
}

interface EisInvoiceRow {
  id: string; company_id: string; sale_id: string; idempotency_key: string; request_body: TaxTrailIssueBody | string;
  status: EisInvoiceStatus; attempts: number; esp_invoice_no: string | null; issued_at: string | null; last_error: string | null;
}

export const CHECKOUT_TIMEOUT_MS = 5000;
export const WORKER_TIMEOUT_MS = 15000;
export const MAX_ATTEMPTS = 30; // ≈ 2 days with the backoff below, then dead_letter (a person looks at it)

// 30s, 1m, 2m, 4m … capped at 2h; TaxTrail's Retry-After wins when it asks for longer
export function nextAttemptDelaySec(attempts: number, retryAfterSec?: number): number {
  const backoff = Math.min(30 * 2 ** Math.max(0, attempts - 1), 7200);
  return Math.max(backoff, retryAfterSec ?? 0);
}

export type IssueOutcome =
  | { kind: 'issued'; invoice: EspInvoiceSummary }
  | { kind: 'retry'; error: string; retryAfterSec?: number }
  | { kind: 'invalid'; error: string }
  | { kind: 'config_error'; error: string };

// TaxTrail's answer → what we do with the row (see TaxTrail's error table: 429/5xx/network retry, 4xx need a person)
export function classifyIssueResponse(res: EspResponse<{ invoice?: EspInvoiceSummary }>): IssueOutcome {
  const err = res.error ? `${res.error.code}: ${res.error.message}` : `HTTP ${res.status}`;
  if (res.ok && res.data?.invoice?.invoiceNo) return { kind: 'issued', invoice: res.data.invoice };
  if (res.ok) return { kind: 'retry', error: 'TaxTrail answered without an invoice number' };
  if (res.status === 0 || res.status === 429 || res.status === 408) return { kind: 'retry', error: err, retryAfterSec: res.retryAfterSec };
  if (res.status >= 500) {
    // A broken stored invoice on TaxTrail's side won't fix itself by resending
    if (res.error?.code === 'INVOICE_INTEGRITY_FAILED') return { kind: 'invalid', error: err };
    return { kind: 'retry', error: err, retryAfterSec: res.retryAfterSec };
  }
  if (res.status === 401 || res.status === 403) return { kind: 'config_error', error: err };
  const problems = (res.error?.details as { problems?: unknown[]; errors?: unknown[] } | undefined);
  const detail = problems?.problems ?? problems?.errors;
  return { kind: 'invalid', error: detail ? `${err} ${JSON.stringify(detail).slice(0, 500)}` : err };
}

export function toEinvoiceView(row: Pick<EisInvoiceRow, 'status' | 'esp_invoice_no' | 'issued_at' | 'last_error'> | null | undefined): SaleEinvoiceView | null {
  if (!row) return null;
  const message =
    row.status === 'pending' ? 'E-invoice pending — it will be issued automatically when TaxTrail answers'
    : row.status === 'invalid' ? 'TaxTrail did not accept this sale. Check the e-invoice status in Sales.'
    : row.status === 'config_error' ? 'TaxTrail refused the connection. Check Settings → BIR & Invoicing.'
    : row.status === 'dead_letter' ? 'E-invoice could not be issued after many tries. Contact support.'
    : null;
  return { status: row.status, invoice_no: row.esp_invoice_no, issued_at: row.issued_at, message };
}

async function loadConnection(db: Db, companyId: string): Promise<{ baseUrl: string; apiKey: string } | null> {
  const { data } = await db.from('eis_connections').select('base_url, api_key_enc').eq('company_id', companyId).limit(1);
  const row = data?.[0] as { base_url: string; api_key_enc: string } | undefined;
  if (!row) return null;
  try { return { baseUrl: row.base_url, apiKey: decryptSecret(row.api_key_enc) }; } catch { return null; }
}

// Build the TaxTrail body from what is saved in the DB (the same for checkout, offline sync and the worker)
async function buildRequest(db: Db, saleId: string) {
  const { data: sales, error } = await db.from('sales').select('*').eq('id', saleId).limit(1);
  if (error) throw error;
  const sale = sales?.[0];
  if (!sale) throw new Error(`Sale ${saleId} not found`);

  const [{ data: items, error: itemsErr }, { data: stores }, { data: companies }] = await Promise.all([
    db.from('sales_items').select('product_id, quantity, unit_price, discount_amount').eq('sales_id', saleId),
    db.from('stores').select('branch_code').eq('id', sale.store_id).limit(1),
    db.from('companies').select('vat_status').eq('id', sale.company_id).limit(1),
  ]);
  if (itemsErr) throw itemsErr;
  const productIds = [...new Set((items || []).map((i: { product_id: string }) => i.product_id))];
  const { data: products } = productIds.length
    ? await db.from('products').select('id, name, vat_type').in('id', productIds)
    : { data: [] };
  type ProductInfo = { id: string; name: string; vat_type: string | null };
  const productMap = new Map<string, ProductInfo>(((products || []) as ProductInfo[]).map((p) => [p.id, p]));

  const mapped = mapSaleToTaxTrail({
    sale,
    items: (items || []).map((i: { product_id: string; quantity: number; unit_price: number; discount_amount: number }) => ({
      name: productMap.get(i.product_id)?.name || 'Item',
      quantity: i.quantity,
      unit_price: i.unit_price,
      discount_amount: i.discount_amount,
      vat_type: productMap.get(i.product_id)?.vat_type || 'vatable',
    })),
    vatStatus: normalizeVatStatus(companies?.[0]?.vat_status),
    branchCode: stores?.[0]?.branch_code || '00000',
    beneficiary: sale.sc_pwd_name && sale.sc_pwd_id_no ? { name: sale.sc_pwd_name, idNumber: sale.sc_pwd_id_no } : null,
  });
  return { sale, mapped };
}

const nowIso = () => new Date().toISOString();

// Record one attempt's result on the row; returns the row's new view
async function recordOutcome(db: Db, row: EisInvoiceRow, outcome: IssueOutcome, httpStatus: number, expectedTotal?: number) {
  const attempts = row.attempts + 1;
  let patch: Record<string, unknown>;
  if (outcome.kind === 'issued') {
    const espTotal = parseFloat(outcome.invoice.totalAmount);
    const mismatch = expectedTotal !== undefined && Math.abs(espTotal - expectedTotal) >= 0.005;
    if (mismatch) console.error(`⚠️ E-invoice ${outcome.invoice.invoiceNo} total ${espTotal} ≠ expected ${expectedTotal} (sale ${row.sale_id})`);
    patch = {
      status: 'issued', esp_invoice_id: outcome.invoice.id, esp_invoice_no: outcome.invoice.invoiceNo,
      esp_totals: { totalAmount: outcome.invoice.totalAmount, vatAmount: outcome.invoice.vatAmount, businessDate: outcome.invoice.businessDate ?? null },
      issued_at: outcome.invoice.issuedAt || nowIso(), status_changed_at: nowIso(),
      last_error: mismatch ? `Total mismatch: TaxTrail ${espTotal}, expected ${expectedTotal}` : null,
    };
  } else if (outcome.kind === 'retry') {
    const dead = attempts >= MAX_ATTEMPTS;
    patch = {
      status: dead ? 'dead_letter' : 'pending', last_error: outcome.error,
      next_attempt_at: new Date(Date.now() + nextAttemptDelaySec(attempts, outcome.retryAfterSec) * 1000).toISOString(),
      ...(dead ? { status_changed_at: nowIso() } : {}),
    };
  } else {
    patch = { status: outcome.kind, last_error: outcome.error, status_changed_at: nowIso() };
  }
  const update = { ...patch, attempts, last_http_status: httpStatus || null, updated_at: nowIso() };
  const { error } = await db.from('eis_invoices').update(update).eq('id', row.id);
  if (error) console.error(`❌ Could not record e-invoice result for sale ${row.sale_id}:`, error);
  return toEinvoiceView({ ...row, ...(update as Partial<EisInvoiceRow>) } as EisInvoiceRow);
}

async function sendOnce(db: Db, row: EisInvoiceRow, timeoutMs: number, expectedTotal?: number): Promise<SaleEinvoiceView | null> {
  const conn = await loadConnection(db, row.company_id);
  if (!conn) {
    // Connection removed / key unreadable: park it until the owner reconnects (requeueConfigErrors)
    return recordOutcome(db, row, { kind: 'config_error', error: 'No working TaxTrail connection' }, 0);
  }
  const body = typeof row.request_body === 'string' ? JSON.parse(row.request_body) : row.request_body;
  const res = await espRequest<{ invoice?: EspInvoiceSummary }>({
    baseUrl: conn.baseUrl, apiKey: conn.apiKey, method: 'POST', path: '/v1/invoices', body, idempotencyKey: row.idempotency_key, timeoutMs,
  });
  return recordOutcome(db, row, classifyIssueResponse(res), res.status, expectedTotal);
}

/**
 * Checkout / offline sync: queue the sale's e-invoice and try once. Never throws — the sale is already saved,
 * so any problem leaves the row pending (or invalid) and the POS prints "E-invoice pending".
 * Returns null when the store isn't in e-invoice mode.
 */
export async function issueSaleEinvoice(saleId: string, opts: { timeoutMs?: number } = {}): Promise<SaleEinvoiceView | null> {
  const db = getDb();
  try {
    const existing = await getSaleEinvoiceRow(db, saleId);
    if (existing) return existing.status === 'pending' ? sendOnce(db, existing, opts.timeoutMs ?? CHECKOUT_TIMEOUT_MS) : toEinvoiceView(existing);

    const { data: sales, error: saleErr } = await db.from('sales').select('company_id, store_id').eq('id', saleId).limit(1);
    if (saleErr) throw saleErr;
    if (!sales?.[0]) return null;
    const { data: stores } = await db.from('stores').select('invoicing_mode').eq('id', sales[0].store_id).limit(1);
    if (stores?.[0]?.invoicing_mode !== 'eis') return null;

    let built: Awaited<ReturnType<typeof buildRequest>> | null = null;
    let buildError: string | null = null;
    try { built = await buildRequest(db, saleId); } catch (err) { buildError = (err as Error).message; }

    const row = {
      company_id: sales[0].company_id, store_id: sales[0].store_id, sale_id: saleId, kind: 'invoice',
      idempotency_key: `tindapo-${saleId}`, request_body: built?.mapped.body ?? {},
      // Can't even build the request (e.g. bad branch code) → recorded as invalid so it shows up, never sent
      status: built ? 'pending' : 'invalid', attempts: 0, last_error: buildError,
    };
    const { data: inserted, error } = await db.from('eis_invoices').insert(row).select().single();
    if (error) {
      // Another request queued it first (one invoice per sale) → use that row
      const raced = await getSaleEinvoiceRow(db, saleId);
      if (raced) return toEinvoiceView(raced);
      console.error(`❌ E-invoice: could not queue sale ${saleId}:`, error);
      return null;
    }
    if (!built) {
      console.error(`❌ E-invoice: could not build the TaxTrail request for sale ${saleId}: ${buildError}`);
      return toEinvoiceView(inserted as EisInvoiceRow);
    }
    return sendOnce(db, inserted as EisInvoiceRow, opts.timeoutMs ?? CHECKOUT_TIMEOUT_MS, built.mapped.expectedEspTotal);
  } catch (err) {
    console.error(`❌ E-invoice: unexpected error for sale ${saleId}:`, err);
    return { status: 'pending', invoice_no: null, issued_at: null, message: toEinvoiceView({ status: 'pending', esp_invoice_no: null, issued_at: null, last_error: null })!.message };
  }
}

async function getSaleEinvoiceRow(db: Db, saleId: string): Promise<EisInvoiceRow | null> {
  const { data } = await db.from('eis_invoices').select('*').eq('sale_id', saleId).eq('kind', 'invoice').limit(1);
  return (data?.[0] as EisInvoiceRow | undefined) || null;
}

export async function getSaleEinvoice(saleId: string): Promise<SaleEinvoiceView | null> {
  try { return toEinvoiceView(await getSaleEinvoiceRow(getDb(), saleId)); } catch { return null; }
}

/**
 * Retry worker: resend pending invoices that are due. Each row is claimed first (next_attempt_at pushed ahead,
 * guarded by its attempts count) so two server processes never send the same row at the same time —
 * and even if they did, the Idempotency-Key makes TaxTrail return the same invoice.
 */
export async function processDueEinvoices(limit = 20): Promise<{ processed: number; issued: number }> {
  const db = getDb();
  const { data, error } = await db.from('eis_invoices').select('*')
    .eq('status', 'pending').lte('next_attempt_at', nowIso()).order('next_attempt_at', { ascending: true }).limit(limit);
  if (error) throw error;
  let processed = 0, issued = 0;
  for (const row of (data || []) as EisInvoiceRow[]) {
    const { data: claimed } = await db.from('eis_invoices')
      .update({ next_attempt_at: new Date(Date.now() + 2 * WORKER_TIMEOUT_MS).toISOString() })
      .eq('id', row.id).eq('status', 'pending').eq('attempts', row.attempts).select('id');
    if (!claimed?.length) continue;
    const view = await sendOnce(db, row, WORKER_TIMEOUT_MS);
    processed++;
    if (view?.status === 'issued') issued++;
  }
  return { processed, issued };
}

// The owner fixed the connection (saved + whoami OK): give parked invoices another go
export async function requeueConfigErrors(companyId: string): Promise<void> {
  const { error } = await getDb().from('eis_invoices')
    .update({ status: 'pending', next_attempt_at: nowIso(), status_changed_at: nowIso(), updated_at: nowIso() })
    .eq('company_id', companyId).eq('status', 'config_error');
  if (error) console.error('❌ Could not requeue e-invoices after reconnect:', error);
}

let workerTimer: NodeJS.Timeout | null = null;
export function startEinvoiceWorker(intervalMs = 30_000): void {
  if (workerTimer || process.env.EIS_WORKER_DISABLED === '1') return;
  let running = false;
  workerTimer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await processDueEinvoices();
      if (r.processed) console.log(`🧾 E-invoice worker: ${r.issued}/${r.processed} issued`);
    } catch (err) {
      console.error('❌ E-invoice worker error:', (err as Error).message);
    } finally {
      running = false;
    }
  }, intervalMs);
  workerTimer.unref();
  console.log('🧾 E-invoice retry worker started');
}
