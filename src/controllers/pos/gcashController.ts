// src/controllers/pos/gcashController.ts
// GCash cash-in / cash-out recording (owner + staff). Store income = fee.
import { Request, Response } from 'express';
import { getDb } from '../../config/database';
import { computeGcashFee, normalizeGcashSettings } from '../../services/gcashFeeService';
import { resolveActor, resolveStoreId } from './actor';

const TYPES = ['cash_in', 'cash_out'] as const;

async function loadSettings(companyId: string) {
  const { data } = await getDb().from('companies').select('settings').eq('id', companyId).limit(1);
  return normalizeGcashSettings(data?.[0]?.settings?.gcash);
}

// GET /pos/gcash/settings — fee rules (for the live fee preview)
async function getGcashSettings(req: Request, res: Response): Promise<void> {
  try {
    res.json({ settings: await loadSettings(req.user!.company_id as string) });
  } catch (error) {
    console.error('❌ getGcashSettings error:', error);
    res.status(500).json({ error: 'Failed to load GCash settings', code: 'GCASH_SETTINGS_ERROR' });
  }
}

// PUT /client/settings/gcash — owner only
async function updateGcashSettings(req: Request, res: Response): Promise<void> {
  try {
    const db = getDb();
    const companyId = req.user!.company_id as string;
    const settings = normalizeGcashSettings(req.body);

    const { data } = await db.from('companies').select('settings').eq('id', companyId).limit(1);
    const current = data?.[0]?.settings || {};

    const { error } = await db
      .from('companies')
      .update({ settings: { ...current, gcash: settings }, updated_at: new Date().toISOString() })
      .eq('id', companyId);
    if (error) throw error;

    console.log(`✅ GCash fee settings updated for company ${companyId}`);
    res.json({ settings });
  } catch (error) {
    console.error('❌ updateGcashSettings error:', error);
    res.status(500).json({ error: 'Failed to save GCash settings', code: 'GCASH_SETTINGS_ERROR' });
  }
}

// GET /pos/gcash?store_id=&start_date=&end_date=&type=
async function getGcashTransactions(req: Request, res: Response): Promise<void> {
  try {
    const db = getDb();
    const actor = resolveActor(req);
    const { start_date, end_date, type } = req.query as Record<string, string | undefined>;
    const storeId = actor.isStaff ? actor.storeId : (req.query.store_id as string | undefined);

    let query = db
      .from('gcash_transactions')
      .select('*')
      .eq('company_id', actor.companyId)
      .order('created_at', { ascending: false })
      .limit(500);

    if (storeId) query = query.eq('store_id', storeId);
    if (type && (TYPES as readonly string[]).includes(type)) query = query.eq('type', type);
    if (start_date) query = query.gte('created_at', start_date);
    if (end_date) query = query.lte('created_at', end_date);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data || []) as Array<{ type: string; amount: number | string; fee: number | string }>;
    const sum = (list: typeof rows, key: 'amount' | 'fee') => list.reduce((s, r) => s + Number(r[key] || 0), 0);
    const cashIn = rows.filter(r => r.type === 'cash_in');
    const cashOut = rows.filter(r => r.type === 'cash_out');

    res.set('Cache-Control', 'no-store');
    res.json({
      transactions: rows,
      summary: {
        cash_in_count: cashIn.length,
        cash_in_total: sum(cashIn, 'amount'),
        cash_out_count: cashOut.length,
        cash_out_total: sum(cashOut, 'amount'),
        total_fees: sum(rows, 'fee'),
      },
    });
  } catch (error) {
    console.error('❌ getGcashTransactions error:', error);
    res.status(500).json({ error: 'Failed to fetch GCash transactions', code: 'GCASH_ERROR' });
  }
}

// POST /pos/gcash — fee is computed from settings unless the cashier overrides it
async function createGcashTransaction(req: Request, res: Response): Promise<void> {
  try {
    const db = getDb();
    const actor = resolveActor(req);
    const { type, amount, fee, customer_name, reference_number, notes } = req.body;

    if (!(TYPES as readonly string[]).includes(type)) {
      res.status(400).json({ error: 'Type must be cash_in or cash_out', code: 'VALIDATION_ERROR' });
      return;
    }
    const amountNum = Number(amount);
    if (!(amountNum > 0)) {
      res.status(400).json({ error: 'Enter a valid amount', code: 'VALIDATION_ERROR' });
      return;
    }
    if (fee !== undefined && fee !== null && fee !== '' && !(Number(fee) >= 0)) {
      res.status(400).json({ error: 'Fee cannot be negative', code: 'VALIDATION_ERROR' });
      return;
    }

    const storeId = await resolveStoreId(req, actor);
    if (storeId === false) {
      res.status(400).json({ error: 'Invalid store', code: 'INVALID_STORE' });
      return;
    }

    const settings = await loadSettings(actor.companyId);
    const finalFee = fee !== undefined && fee !== null && fee !== ''
      ? Math.round(Number(fee) * 100) / 100
      : computeGcashFee(amountNum, settings[type as 'cash_in' | 'cash_out']);

    const { data, error } = await db
      .from('gcash_transactions')
      .insert({
        company_id: actor.companyId,
        store_id: storeId,
        type,
        amount: amountNum,
        fee: finalFee,
        customer_name: customer_name?.trim() || null,
        reference_number: reference_number?.trim() || null,
        notes: notes?.trim() || null,
        created_by: actor.createdBy,
        staff_id: actor.staffId,
      })
      .select()
      .single();
    if (error) throw error;

    console.log(`✅ GCash ${type} ₱${amountNum} (fee ₱${finalFee}) recorded`);
    res.status(201).json({ transaction: data });
  } catch (error) {
    console.error('❌ createGcashTransaction error:', error);
    res.status(500).json({ error: 'Failed to record GCash transaction', code: 'GCASH_ERROR' });
  }
}

// DELETE /pos/gcash/:id — owner only (fix mistakes)
async function deleteGcashTransaction(req: Request, res: Response): Promise<void> {
  try {
    const db = getDb();
    const id = req.params.id as string;

    // Check ownership first (SQLiteAdapter's delete() returns no rows)
    const { data: found, error: findError } = await db
      .from('gcash_transactions')
      .select('id')
      .eq('id', id)
      .eq('company_id', req.user!.company_id)
      .limit(1);
    if (findError) throw findError;
    if (!found || found.length === 0) {
      res.status(404).json({ error: 'Transaction not found', code: 'NOT_FOUND' });
      return;
    }

    const { error } = await db.from('gcash_transactions').delete().eq('id', id).eq('company_id', req.user!.company_id);
    if (error) throw error;

    console.log(`✅ GCash transaction ${id} deleted`);
    res.json({ message: 'Transaction deleted' });
  } catch (error) {
    console.error('❌ deleteGcashTransaction error:', error);
    res.status(500).json({ error: 'Failed to delete GCash transaction', code: 'GCASH_ERROR' });
  }
}

export { getGcashSettings, updateGcashSettings, getGcashTransactions, createGcashTransaction, deleteGcashTransaction };
