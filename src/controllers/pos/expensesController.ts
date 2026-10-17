// src/controllers/pos/expensesController.ts
// Daily expenses (rent, electricity, salary, ice, delivery...). Owner + staff record; owner edits/deletes.
import { Request, Response } from 'express';
import { getDb } from '../../config/database';
import { resolveActor, resolveStoreId } from './actor';

const CATEGORIES = ['rent', 'electricity', 'water', 'internet', 'salary', 'supplies', 'transportation', 'maintenance', 'taxes', 'other'];
const PAYMENT_METHODS = ['cash', 'gcash', 'bank', 'other'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Today in the Philippines (server runs in UTC) — YYYY-MM-DD
const todayPH = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });

type ExpenseInput = { category?: string; description?: string; amount?: unknown; expense_date?: string; payment_method?: string };

// Returns an error message, or null when valid
function validateExpense(body: ExpenseInput): string | null {
  if (!(Number(body.amount) > 0)) return 'Enter a valid amount';
  if (body.category && !CATEGORIES.includes(body.category)) return 'Invalid category';
  if (body.payment_method && !PAYMENT_METHODS.includes(body.payment_method)) return 'Invalid payment method';
  if (body.expense_date && !DATE_RE.test(body.expense_date)) return 'Invalid date';
  return null;
}

// GET /pos/expenses?store_id=&start_date=&end_date=&category=  (dates: YYYY-MM-DD)
async function getExpenses(req: Request, res: Response): Promise<void> {
  try {
    const db = getDb();
    const actor = resolveActor(req);
    const { start_date, end_date, category } = req.query as Record<string, string | undefined>;
    const storeId = actor.isStaff ? actor.storeId : (req.query.store_id as string | undefined);

    let query = db
      .from('expenses')
      .select('*')
      .eq('company_id', actor.companyId)
      .order('expense_date', { ascending: false })
      .limit(500);

    if (storeId) query = query.eq('store_id', storeId);
    if (category && CATEGORIES.includes(category)) query = query.eq('category', category);
    if (start_date && DATE_RE.test(start_date)) query = query.gte('expense_date', start_date);
    if (end_date && DATE_RE.test(end_date)) query = query.lte('expense_date', end_date);

    const { data, error } = await query;
    if (error) throw error;

    const rows = (data || []) as Array<{ category: string; amount: number | string }>;
    const byCategory: Record<string, number> = {};
    for (const r of rows) byCategory[r.category] = (byCategory[r.category] || 0) + Number(r.amount || 0);

    res.set('Cache-Control', 'no-store');
    res.json({
      expenses: rows,
      summary: {
        count: rows.length,
        total: rows.reduce((s, r) => s + Number(r.amount || 0), 0),
        by_category: byCategory,
      },
    });
  } catch (error) {
    console.error('❌ getExpenses error:', error);
    res.status(500).json({ error: 'Failed to fetch expenses', code: 'EXPENSES_ERROR' });
  }
}

// POST /pos/expenses
async function createExpense(req: Request, res: Response): Promise<void> {
  try {
    const actor = resolveActor(req);
    const invalid = validateExpense(req.body);
    if (invalid) {
      res.status(400).json({ error: invalid, code: 'VALIDATION_ERROR' });
      return;
    }

    const storeId = await resolveStoreId(req, actor);
    if (storeId === false) {
      res.status(400).json({ error: 'Invalid store', code: 'INVALID_STORE' });
      return;
    }

    const { category, description, amount, expense_date, payment_method } = req.body;
    const { data, error } = await getDb()
      .from('expenses')
      .insert({
        company_id: actor.companyId,
        store_id: storeId,
        category: category || 'other',
        description: description?.trim() || null,
        amount: Number(amount),
        expense_date: expense_date || todayPH(),
        payment_method: payment_method || 'cash',
        created_by: actor.createdBy,
        staff_id: actor.staffId,
      })
      .select()
      .single();
    if (error) throw error;

    console.log(`✅ Expense recorded: ${data.category} ₱${data.amount}`);
    res.status(201).json({ expense: data });
  } catch (error) {
    console.error('❌ createExpense error:', error);
    res.status(500).json({ error: 'Failed to record expense', code: 'EXPENSES_ERROR' });
  }
}

async function findOwnExpense(id: string, companyId: string): Promise<boolean> {
  const { data, error } = await getDb().from('expenses').select('id').eq('id', id).eq('company_id', companyId).limit(1);
  if (error) throw error;
  return !!data && data.length > 0;
}

// PUT /pos/expenses/:id — owner only
async function updateExpense(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const companyId = req.user!.company_id as string;
    const invalid = validateExpense(req.body);
    if (invalid) {
      res.status(400).json({ error: invalid, code: 'VALIDATION_ERROR' });
      return;
    }
    if (!(await findOwnExpense(id, companyId))) {
      res.status(404).json({ error: 'Expense not found', code: 'NOT_FOUND' });
      return;
    }

    const storeId = await resolveStoreId(req, resolveActor(req));
    if (storeId === false) {
      res.status(400).json({ error: 'Invalid store', code: 'INVALID_STORE' });
      return;
    }

    const { category, description, amount, expense_date, payment_method } = req.body;
    const { error } = await getDb()
      .from('expenses')
      .update({
        store_id: storeId,
        category: category || 'other',
        description: description?.trim() || null,
        amount: Number(amount),
        expense_date: expense_date || todayPH(),
        payment_method: payment_method || 'cash',
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('company_id', companyId);
    if (error) throw error;

    console.log(`✅ Expense ${id} updated`);
    res.json({ message: 'Expense updated' });
  } catch (error) {
    console.error('❌ updateExpense error:', error);
    res.status(500).json({ error: 'Failed to update expense', code: 'EXPENSES_ERROR' });
  }
}

// DELETE /pos/expenses/:id — owner only
async function deleteExpense(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const companyId = req.user!.company_id as string;
    if (!(await findOwnExpense(id, companyId))) {
      res.status(404).json({ error: 'Expense not found', code: 'NOT_FOUND' });
      return;
    }

    const { error } = await getDb().from('expenses').delete().eq('id', id).eq('company_id', companyId);
    if (error) throw error;

    console.log(`✅ Expense ${id} deleted`);
    res.json({ message: 'Expense deleted' });
  } catch (error) {
    console.error('❌ deleteExpense error:', error);
    res.status(500).json({ error: 'Failed to delete expense', code: 'EXPENSES_ERROR' });
  }
}

export { getExpenses, createExpense, updateExpense, deleteExpense, CATEGORIES as EXPENSE_CATEGORIES };
