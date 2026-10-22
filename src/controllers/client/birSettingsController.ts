// src/controllers/client/birSettingsController.ts
// BIR registration data (company = taxpayer, store = branch / POS terminal) and invoicing mode — Invoicing plan P0-2.
// Lengths follow BIR's EIS e-invoice JSON format (Annex B v2.1). Owner only (client routes).
import { Request, Response } from 'express';
import { getDb } from '../../config/database';
import { hasWorkingEisConnection } from './eisConnectionController';

export const VAT_STATUSES = ['vat', 'non_vat', 'rbe'] as const;
// 'eis' = TaxTrail issues the invoice; allowed only with a working connection (checked when saving)
export const AVAILABLE_INVOICING_MODES = ['manual', 'eis'] as const;

type FieldError = { field: string; message: string };

// "123-456-789" / "123 456 789" → "123456789"; null when empty; error when not 9 digits
export function normalizeTin(input: unknown): { value: string | null; error?: string } {
  if (input === null || input === undefined || String(input).trim() === '') return { value: null };
  const raw = String(input).trim();
  if (!/^[0-9\s-]+$/.test(raw)) return { value: null, error: 'TIN can only contain numbers (dashes and spaces are OK)' };
  const digits = raw.replace(/\D/g, '');
  if (digits.length !== 9) {
    return { value: null, error: digits.length > 9
      ? 'Enter only the 9-digit TIN — the branch code (e.g. 00000) is set per store'
      : 'TIN must have 9 digits' };
  }
  return { value: digits };
}

// BIR: 5 digits; a 3-digit branch code '101' becomes '00101'
export function normalizeBranchCode(input: unknown): { value: string; error?: string } {
  const raw = String(input ?? '').trim();
  if (raw === '') return { value: '00000' };
  if (!/^\d{3}$|^\d{5}$/.test(raw)) return { value: raw, error: 'Branch code must be 3 or 5 digits (head office: 00000)' };
  return { value: raw.padStart(5, '0') };
}

// Trimmed text, null when empty; error when too long
export function cleanText(input: unknown, max: number, label: string): { value: string | null; error?: string } {
  if (input === null || input === undefined) return { value: null };
  const v = String(input).trim();
  if (v === '') return { value: null };
  if (v.length > max) return { value: null, error: `${label} can be at most ${max} characters` };
  return { value: v };
}

interface CompanyInput { bir_registered_name?: unknown; bir_trade_name?: unknown; bir_registered_address?: unknown; tin?: unknown; vat_status?: unknown }
interface StoreInput { id?: unknown; branch_code?: unknown; invoicing_mode?: unknown; ptu_number?: unknown; min_number?: unknown; msn_number?: unknown }

// Returns the company columns to update (only fields that were sent) + errors
export function validateCompanyInput(body: CompanyInput): { update: Record<string, string | null>; errors: FieldError[] } {
  const update: Record<string, string | null> = {};
  const errors: FieldError[] = [];
  const text = (key: keyof CompanyInput, max: number, label: string) => {
    if (!(key in body)) return;
    const r = cleanText(body[key], max, label);
    if (r.error) errors.push({ field: `company.${key}`, message: r.error }); else update[key] = r.value;
  };
  text('bir_registered_name', 200, 'Registered name');
  text('bir_trade_name', 200, 'Trade name');
  text('bir_registered_address', 300, 'Registered address');
  if ('tin' in body) {
    const r = normalizeTin(body.tin);
    if (r.error) errors.push({ field: 'company.tin', message: r.error }); else update.tin = r.value;
  }
  if ('vat_status' in body) {
    if ((VAT_STATUSES as readonly string[]).includes(String(body.vat_status))) update.vat_status = String(body.vat_status);
    else errors.push({ field: 'company.vat_status', message: 'Choose VAT, Non-VAT or Registered Business Enterprise' });
  }
  return { update, errors };
}

export function validateStoreInput(body: StoreInput, index: number): { id: string; update: Record<string, string | null>; errors: FieldError[] } {
  const update: Record<string, string | null> = {};
  const errors: FieldError[] = [];
  const at = (f: string) => `stores[${index}].${f}`;
  const id = typeof body.id === 'string' ? body.id : '';
  if (!id) errors.push({ field: at('id'), message: 'Store id is required' });
  if ('branch_code' in body) {
    const r = normalizeBranchCode(body.branch_code);
    if (r.error) errors.push({ field: at('branch_code'), message: r.error }); else update.branch_code = r.value;
  }
  if ('invoicing_mode' in body) {
    if ((AVAILABLE_INVOICING_MODES as readonly string[]).includes(String(body.invoicing_mode))) update.invoicing_mode = String(body.invoicing_mode);
    else errors.push({ field: at('invoicing_mode'), message: 'Invalid invoicing mode' });
  }
  for (const [key, label] of [['ptu_number', 'PTU number'], ['min_number', 'MIN'], ['msn_number', 'Machine serial number']] as const) {
    if (!(key in body)) continue;
    const r = cleanText(body[key], 50, label);
    if (r.error) errors.push({ field: at(key), message: r.error }); else update[key] = r.value;
  }
  return { id, update, errors };
}

const COMPANY_COLUMNS = 'id, name, address, tax_id, tin, vat_status, bir_registered_name, bir_trade_name, bir_registered_address';
const STORE_COLUMNS = 'id, name, address, is_active, branch_code, invoicing_mode, ptu_number, min_number, msn_number';

async function loadBirSettings(companyId: string) {
  const db = getDb();
  const [{ data: companies, error: cErr }, { data: stores, error: sErr }] = await Promise.all([
    db.from('companies').select(COMPANY_COLUMNS).eq('id', companyId).limit(1),
    db.from('stores').select(STORE_COLUMNS).eq('company_id', companyId).order('created_at', { ascending: true }),
  ]);
  if (cErr) throw cErr;
  if (sErr) throw sErr;
  return { company: companies?.[0] || null, stores: stores || [] };
}

// GET /client/settings/bir
export async function getBirSettings(req: Request, res: Response): Promise<void> {
  try {
    const settings = await loadBirSettings(req.user!.company_id as string);
    if (!settings.company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }
    res.set('Cache-Control', 'no-store');
    res.json({ ...settings, vat_statuses: VAT_STATUSES, invoicing_modes: AVAILABLE_INVOICING_MODES });
  } catch (error) {
    console.error('❌ getBirSettings error:', error);
    res.status(500).json({ error: 'Failed to load BIR settings', code: 'BIR_SETTINGS_ERROR' });
  }
}

// PUT /client/settings/bir  { company?: {...}, stores?: [{ id, branch_code, ptu_number, ... }] }
export async function updateBirSettings(req: Request, res: Response): Promise<void> {
  try {
    const db = getDb();
    const companyId = req.user!.company_id as string;
    const body = (req.body || {}) as { company?: CompanyInput; stores?: StoreInput[] };

    const company = body.company ? validateCompanyInput(body.company) : { update: {}, errors: [] };
    if (body.stores !== undefined && !Array.isArray(body.stores)) {
      res.status(400).json({ error: 'stores must be a list', code: 'VALIDATION_ERROR' });
      return;
    }
    const stores = (body.stores || []).map((s, i) => validateStoreInput(s || {}, i));
    const errors = [...company.errors, ...stores.flatMap((s) => s.errors)];
    if (errors.length) {
      res.status(400).json({ error: errors[0].message, code: 'VALIDATION_ERROR', details: errors });
      return;
    }

    // E-invoice mode needs a TaxTrail connection that passed its last test
    if (stores.some((s) => s.update.invoicing_mode === 'eis') && !(await hasWorkingEisConnection(companyId))) {
      res.status(400).json({ error: 'Connect TaxTrail first (and pass the connection test) before switching a store to e-invoice', code: 'EIS_NOT_CONNECTED' });
      return;
    }

    // Stores must belong to this company
    if (stores.length) {
      const { data: owned, error } = await db.from('stores').select('id').eq('company_id', companyId).in('id', stores.map((s) => s.id));
      if (error) throw error;
      const ownedIds = new Set((owned || []).map((s: { id: string }) => s.id));
      const foreign = stores.find((s) => !ownedIds.has(s.id));
      if (foreign) {
        res.status(404).json({ error: 'Store not found', code: 'STORE_NOT_FOUND' });
        return;
      }
    }

    const now = new Date().toISOString();
    if (Object.keys(company.update).length) {
      const { error } = await db.from('companies').update({ ...company.update, updated_at: now }).eq('id', companyId);
      if (error) throw error;
    }
    for (const s of stores) {
      if (!Object.keys(s.update).length) continue;
      const { error } = await db.from('stores').update({ ...s.update, updated_at: now }).eq('id', s.id).eq('company_id', companyId);
      if (error) throw error;
    }

    console.log(`✅ BIR settings updated for company ${companyId} (${Object.keys(company.update).length} company fields, ${stores.length} stores)`);
    res.json(await loadBirSettings(companyId));
  } catch (error) {
    console.error('❌ updateBirSettings error:', error);
    res.status(500).json({ error: 'Failed to save BIR settings', code: 'BIR_SETTINGS_ERROR' });
  }
}
