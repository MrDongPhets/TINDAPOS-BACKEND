// src/routes/client/utang.ts - Utang (Credit/Debt) Tracking Routes
import express, { Request, Response } from 'express';
import { getDb } from '../../config/database';

const router = express.Router();

// GET /client/utang/customers - list all customers with their current balance
router.get('/customers', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const company_id = req.user!.company_id;

    const { data: customers, error } = await db
      .from('customers')
      .select('*')
      .eq('company_id', company_id)
      .eq('is_active', true)
      .order('name');

    if (error) throw error;

    // Get balance for each customer
    const { data: ledger, error: ledgerError } = await db
      .from('credit_ledger')
      .select('customer_id, type, amount')
      .eq('company_id', company_id);

    if (ledgerError) throw ledgerError;

    const balanceMap: Record<string, number> = {};
    for (const entry of ledger || []) {
      if (!balanceMap[entry.customer_id]) balanceMap[entry.customer_id] = 0;
      if (entry.type === 'charge') balanceMap[entry.customer_id] += Number(entry.amount);
      else balanceMap[entry.customer_id] -= Number(entry.amount);
    }

    const result = (customers || []).map((c: any) => ({
      ...c,
      balance: balanceMap[c.id] || 0
    }));

    console.log(`✅ Fetched ${result.length} customers`);
    res.json({ customers: result });
  } catch (err: any) {
    console.error('❌ Get customers error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /client/utang/customers - create a customer
router.post('/customers', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, phone, notes } = req.body;

    if (!name?.trim()) {
      res.status(400).json({ error: 'Customer name is required' });
      return;
    }

    const { data, error } = await db
      .from('customers')
      .insert({
        company_id: req.user!.company_id,
        name: name.trim(),
        phone: phone?.trim() || null,
        notes: notes?.trim() || null,
        created_by: req.user!.id
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Created customer: ${data.name}`);
    res.status(201).json({ customer: data });
  } catch (err: any) {
    console.error('❌ Create customer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// PUT /client/utang/customers/:id - update a customer
router.put('/customers/:id', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { name, phone, notes } = req.body;

    const { data, error } = await db
      .from('customers')
      .update({ name: name?.trim(), phone: phone?.trim() || null, notes: notes?.trim() || null, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('company_id', req.user!.company_id)
      .select()
      .single();

    if (error) throw error;

    res.json({ customer: data });
  } catch (err: any) {
    console.error('❌ Update customer error:', err);
    res.status(500).json({ error: err.message });
  }
});

// GET /client/utang/customers/:id/ledger - full ledger history for a customer
router.get('/customers/:id/ledger', async (req: Request, res: Response) => {
  try {
    const db = getDb();

    const { data: customer, error: custErr } = await db
      .from('customers')
      .select('*')
      .eq('id', req.params.id)
      .eq('company_id', req.user!.company_id)
      .single();

    if (custErr || !customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    const { data: entries, error } = await db
      .from('credit_ledger')
      .select('*')
      .eq('customer_id', req.params.id)
      .eq('company_id', req.user!.company_id)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const balance = (entries || []).reduce((sum: number, e: any) => {
      return sum + (e.type === 'charge' ? Number(e.amount) : -Number(e.amount));
    }, 0);

    res.json({ customer: { ...customer, balance }, entries: entries || [] });
  } catch (err: any) {
    console.error('❌ Get ledger error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /client/utang/customers/:id/charge - manually record a charge (utang)
router.post('/customers/:id/charge', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { amount, notes } = req.body;

    if (!amount || Number(amount) <= 0) {
      res.status(400).json({ error: 'Valid amount is required' });
      return;
    }

    const { data: customer, error: custErr } = await db
      .from('customers')
      .select('id, name')
      .eq('id', req.params.id)
      .eq('company_id', req.user!.company_id)
      .single();

    if (custErr || !customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    const { data, error } = await db
      .from('credit_ledger')
      .insert({
        company_id: req.user!.company_id,
        customer_id: req.params.id,
        type: 'charge',
        amount: Number(amount),
        notes: notes?.trim() || null,
        created_by: req.user!.id
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Manual charge recorded for customer: ${customer.name} — ₱${amount}`);
    res.status(201).json({ entry: data });
  } catch (err: any) {
    console.error('❌ Record charge error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /client/utang/customers/:id/payment - record a payment
router.post('/customers/:id/payment', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { amount, notes } = req.body;

    if (!amount || Number(amount) <= 0) {
      res.status(400).json({ error: 'Valid payment amount is required' });
      return;
    }

    // Verify customer belongs to company
    const { data: customer, error: custErr } = await db
      .from('customers')
      .select('id, name')
      .eq('id', req.params.id)
      .eq('company_id', req.user!.company_id)
      .single();

    if (custErr || !customer) {
      res.status(404).json({ error: 'Customer not found' });
      return;
    }

    const { data, error } = await db
      .from('credit_ledger')
      .insert({
        company_id: req.user!.company_id,
        customer_id: req.params.id,
        type: 'payment',
        amount: Number(amount),
        notes: notes?.trim() || null,
        created_by: req.user!.id
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Payment recorded for customer: ${customer.name} — ₱${amount}`);
    res.status(201).json({ entry: data });
  } catch (err: any) {
    console.error('❌ Record payment error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /client/utang/customers/search - search customers by name/phone (for POS)
router.get('/customers/search', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const q = (req.query.q as string)?.trim();

    if (!q || q.length < 1) {
      res.json({ customers: [] });
      return;
    }

    const { data, error } = await db
      .from('customers')
      .select('id, name, phone')
      .eq('company_id', req.user!.company_id)
      .eq('is_active', true)
      .or(`name.ilike.%${q}%,phone.ilike.%${q}%`)
      .order('name')
      .limit(10);

    if (error) throw error;
    res.json({ customers: data || [] });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
