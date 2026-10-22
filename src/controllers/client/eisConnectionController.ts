// src/controllers/client/eisConnectionController.ts
// Owner settings: the company's connection to its e-invoicing service provider (ITBS TaxTrail). Invoicing plan P2-3.
// The API key is encrypted at rest (secretBox) and never returned — only its last 4 characters.
import { Request, Response } from 'express';
import { getDb } from '../../config/database';
import { decryptSecret, encryptionConfigured, encryptSecret } from '../../services/eis/secretBox';
import { requeueConfigErrors } from '../../services/eis/eisIssuer';
import { registerWebhook, unregisterWebhook } from '../../services/eis/eisStatus';
import { API_KEY_PATTERN, describeWhoAmI, normalizeBaseUrl, whoami } from '../../services/eis/taxtrailClient';

type ConnectionRow = {
  base_url: string; api_key_enc: string; api_key_last4: string | null;
  last_checked_at: string | null; last_check_ok: boolean | number | null; last_check_message: string | null;
  webhook_id?: string | null;
};

const publicView = (row: ConnectionRow | null) => row
  ? {
      connected: true,
      provider: 'taxtrail',
      base_url: row.base_url,
      api_key_hint: row.api_key_last4 ? `••••${row.api_key_last4}` : '••••',
      key_environment: null as string | null,
      last_checked_at: row.last_checked_at,
      last_check_ok: row.last_check_ok === true || row.last_check_ok === 1,
      last_check_message: row.last_check_message,
      // BIR status updates: instant through the TaxTrail webhook, otherwise polled every few minutes
      status_updates: row.webhook_id ? 'webhook' : 'polling',
    }
  : { connected: false };

async function loadConnection(companyId: string): Promise<ConnectionRow | null> {
  const { data, error } = await getDb().from('eis_connections')
    .select('base_url, api_key_enc, api_key_last4, last_checked_at, last_check_ok, last_check_message, webhook_id')
    .eq('company_id', companyId).limit(1);
  if (error) throw error;
  return (data?.[0] as ConnectionRow | undefined) || null;
}

// Runs whoami and records the result; returns the owner-facing view
async function checkAndRecord(companyId: string, baseUrl: string, apiKey: string) {
  const res = await whoami(baseUrl, apiKey);
  let ok = false;
  let message: string;
  if (res.ok && res.data) ({ ok, message } = describeWhoAmI(res.data));
  else if (res.status === 401) message = 'TaxTrail did not accept this API key.';
  else if (res.status === 0) message = `${res.error?.message} (${baseUrl}).`;
  else message = `TaxTrail error: ${res.error?.message || res.status}`;

  await getDb().from('eis_connections').update({
    last_checked_at: new Date().toISOString(), last_check_ok: ok, last_check_message: message, updated_at: new Date().toISOString(),
  }).eq('company_id', companyId);
  return { ok, message, environment: res.data?.environment ?? null };
}

// GET /client/settings/eis
export async function getEisConnection(req: Request, res: Response): Promise<void> {
  try {
    const row = await loadConnection(req.user!.company_id as string);
    res.set('Cache-Control', 'no-store');
    res.json({ ...publicView(row), encryption_ready: encryptionConfigured() });
  } catch (error) {
    console.error('❌ getEisConnection error:', error);
    res.status(500).json({ error: 'Failed to load e-invoicing settings', code: 'EIS_SETTINGS_ERROR' });
  }
}

// PUT /client/settings/eis  { base_url, api_key? }  — api_key omitted = keep the saved one. Always tests the connection.
export async function saveEisConnection(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id as string;
    if (!encryptionConfigured()) {
      res.status(503).json({ error: 'E-invoicing is not set up on this server yet (missing encryption key).', code: 'EIS_NOT_CONFIGURED' });
      return;
    }
    const url = normalizeBaseUrl(req.body?.base_url);
    if (url.error) { res.status(400).json({ error: url.error, code: 'VALIDATION_ERROR' }); return; }

    const existing = await loadConnection(companyId);
    const newKey = typeof req.body?.api_key === 'string' ? req.body.api_key.trim() : '';
    if (!newKey && !existing) { res.status(400).json({ error: 'Enter the TaxTrail API key', code: 'VALIDATION_ERROR' }); return; }
    if (newKey && !API_KEY_PATTERN.test(newKey)) {
      res.status(400).json({ error: 'That doesn\'t look like a TaxTrail API key (it starts with sk_test_ or sk_live_). Copy it again.', code: 'VALIDATION_ERROR' });
      return;
    }

    const apiKey = newKey || decryptSecret(existing!.api_key_enc);
    const now = new Date().toISOString();
    const row = {
      company_id: companyId,
      provider: 'taxtrail',
      base_url: url.value,
      api_key_enc: newKey ? encryptSecret(newKey) : existing!.api_key_enc,
      api_key_last4: newKey ? newKey.slice(-4) : existing!.api_key_last4,
      updated_at: now,
    };
    const { error } = existing
      ? await getDb().from('eis_connections').update(row).eq('company_id', companyId)
      : await getDb().from('eis_connections').insert({ ...row, created_at: now });
    if (error) throw error;

    const check = await checkAndRecord(companyId, url.value, apiKey);
    if (check.ok) {
      await requeueConfigErrors(companyId);
      if (newKey || !existing?.webhook_id || existing.base_url !== url.value) {
        const hook = await registerWebhook(companyId, url.value, apiKey);
        console.log(`🔔 ${hook.message}`);
      }
    }
    console.log(`🔌 E-invoicing connection saved for company ${companyId}: ${check.ok ? 'OK' : 'not ready'}`);
    res.json({ ...publicView(await loadConnection(companyId)), key_environment: check.environment, encryption_ready: true });
  } catch (error) {
    console.error('❌ saveEisConnection error:', (error as Error).message);
    res.status(500).json({ error: 'Failed to save e-invoicing settings', code: 'EIS_SETTINGS_ERROR' });
  }
}

// POST /client/settings/eis/test — re-check the saved connection
export async function testEisConnection(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id as string;
    const existing = await loadConnection(companyId);
    if (!existing) { res.status(404).json({ error: 'No TaxTrail connection saved yet', code: 'EIS_NOT_CONNECTED' }); return; }
    const check = await checkAndRecord(companyId, existing.base_url, decryptSecret(existing.api_key_enc));
    if (check.ok) await requeueConfigErrors(companyId);
    res.json({ ...publicView(await loadConnection(companyId)), key_environment: check.environment, encryption_ready: true });
  } catch (error) {
    console.error('❌ testEisConnection error:', (error as Error).message);
    res.status(500).json({ error: 'Failed to test the connection', code: 'EIS_SETTINGS_ERROR' });
  }
}

// DELETE /client/settings/eis — remove the connection; every store goes back to manual invoices
export async function deleteEisConnection(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id as string;
    const db = getDb();
    const existing = await loadConnection(companyId);
    if (existing?.webhook_id) {
      try { await unregisterWebhook(companyId, existing.base_url, decryptSecret(existing.api_key_enc)); } catch { /* removed below anyway */ }
    }
    const { error: storeErr } = await db.from('stores').update({ invoicing_mode: 'manual', updated_at: new Date().toISOString() }).eq('company_id', companyId);
    if (storeErr) throw storeErr;
    const { error } = await db.from('eis_connections').delete().eq('company_id', companyId);
    if (error) throw error;
    console.log(`🔌 E-invoicing connection removed for company ${companyId}`);
    res.json({ connected: false, encryption_ready: encryptionConfigured() });
  } catch (error) {
    console.error('❌ deleteEisConnection error:', error);
    res.status(500).json({ error: 'Failed to remove the connection', code: 'EIS_SETTINGS_ERROR' });
  }
}

// Used by the BIR settings save: a store may switch to e-invoice only with a working connection
export async function hasWorkingEisConnection(companyId: string): Promise<boolean> {
  const row = await loadConnection(companyId);
  return !!row && (row.last_check_ok === true || row.last_check_ok === 1);
}
