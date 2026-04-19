import { Request, Response } from 'express';
import { getDb } from '../../config/database';

async function getStockCounts(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id } = req.query;
    const supabase = getDb();

    const { data: stores } = await supabase
      .from('stores').select('id').eq('company_id', companyId);
    const storeIds = stores?.map((s: { id: string }) => s.id) || [];
    if (storeIds.length === 0) { res.json({ stock_counts: [] }); return; }

    let query = supabase
      .from('stock_counts')
      .select(`*, stores(name), users!stock_counts_created_by_fkey(name)`)
      .in('store_id', storeIds)
      .order('created_at', { ascending: false });

    if (store_id) query = query.eq('store_id', store_id);

    const { data, error } = await query;
    if (error) throw error;

    console.log('✅ Stock counts fetched:', data?.length);
    res.json({ stock_counts: data || [] });
  } catch (error) {
    console.error('❌ getStockCounts error:', error);
    res.status(500).json({ error: 'Failed to fetch stock counts', code: 'STOCK_COUNT_ERROR' });
  }
}

async function getStockCount(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const userType = req.user!.userType;
    const supabase = getDb();

    const { data: stores } = await supabase
      .from('stores').select('id').eq('company_id', companyId);
    const storeIds = stores?.map((s: { id: string }) => s.id) || [];

    const { data: stockCount, error } = await supabase
      .from('stock_counts')
      .select(`*, stores(name), users!stock_counts_created_by_fkey(name)`)
      .eq('id', id)
      .in('store_id', storeIds)
      .single();

    if (error || !stockCount) {
      res.status(404).json({ error: 'Stock count not found', code: 'NOT_FOUND' });
      return;
    }

    const { data: items, error: itemsError } = await supabase
      .from('stock_count_items')
      .select(`*, products(id, name, sku, stock_quantity)`)
      .eq('stock_count_id', id)
      .order('created_at', { ascending: true });

    if (itemsError) throw itemsError;

    // Hide expected_qty and variance from staff on draft/submitted counts
    const isOwner = userType === 'client';
    const sanitizedItems = items?.map((item: Record<string, unknown>) => ({
      ...item,
      expected_qty: isOwner || stockCount.status === 'approved' ? item.expected_qty : null,
      variance: isOwner || stockCount.status === 'approved' ? item.variance : null,
    }));

    console.log('✅ Stock count detail fetched:', id);
    res.json({ stock_count: stockCount, items: sanitizedItems || [] });
  } catch (error) {
    console.error('❌ getStockCount error:', error);
    res.status(500).json({ error: 'Failed to fetch stock count', code: 'STOCK_COUNT_ERROR' });
  }
}

async function createStockCount(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const userId = req.user!.id;
    const { store_id, notes } = req.body;
    const supabase = getDb();

    if (!store_id) {
      res.status(400).json({ error: 'store_id is required', code: 'VALIDATION_ERROR' });
      return;
    }

    // Verify store belongs to company
    const { data: store } = await supabase
      .from('stores').select('id').eq('id', store_id).eq('company_id', companyId).single();
    if (!store) {
      res.status(400).json({ error: 'Invalid store', code: 'INVALID_STORE' });
      return;
    }

    // Create stock count session
    const { data: stockCount, error } = await supabase
      .from('stock_counts')
      .insert([{ store_id, company_id: companyId, created_by: userId, notes, status: 'draft' }])
      .select()
      .single();
    if (error) throw error;

    // Pre-populate items with all active products in this store and their current stock as expected_qty
    const { data: products } = await supabase
      .from('products')
      .select('id, stock_quantity')
      .eq('store_id', store_id)
      .eq('is_active', true);

    if (products && products.length > 0) {
      const items = products.map((p: { id: string; stock_quantity: number }) => ({
        stock_count_id: stockCount.id,
        product_id: p.id,
        expected_qty: p.stock_quantity || 0,
        actual_qty: null,
        variance: null,
      }));
      await supabase.from('stock_count_items').insert(items);
    }

    console.log('✅ Stock count created:', stockCount.id);
    res.status(201).json({ message: 'Stock count created', stock_count: stockCount });
  } catch (error) {
    console.error('❌ createStockCount error:', error);
    res.status(500).json({ error: 'Failed to create stock count', code: 'CREATE_ERROR' });
  }
}

async function updateStockCountItems(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const { items } = req.body; // [{ id, actual_qty, notes }]
    const supabase = getDb();

    // Verify stock count belongs to company and is still draft
    const { data: stores } = await supabase
      .from('stores').select('id').eq('company_id', companyId);
    const storeIds = stores?.map((s: { id: string }) => s.id) || [];

    const { data: stockCount } = await supabase
      .from('stock_counts').select('status').eq('id', id).in('store_id', storeIds).single();

    if (!stockCount) {
      res.status(404).json({ error: 'Stock count not found', code: 'NOT_FOUND' });
      return;
    }
    if (stockCount.status !== 'draft') {
      res.status(400).json({ error: 'Cannot edit a submitted or approved stock count', code: 'LOCKED' });
      return;
    }

    // Update each item
    for (const item of items) {
      const { data: existing } = await supabase
        .from('stock_count_items').select('expected_qty').eq('id', item.id).single();
      const variance = item.actual_qty != null && existing
        ? item.actual_qty - (existing.expected_qty || 0)
        : null;

      await supabase.from('stock_count_items').update({
        actual_qty: item.actual_qty,
        variance,
        notes: item.notes || null,
        updated_at: new Date().toISOString(),
      }).eq('id', item.id);
    }

    console.log('✅ Stock count items updated:', id);
    res.json({ message: 'Items updated successfully' });
  } catch (error) {
    console.error('❌ updateStockCountItems error:', error);
    res.status(500).json({ error: 'Failed to update items', code: 'UPDATE_ERROR' });
  }
}

async function submitStockCount(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const supabase = getDb();

    const { data: stores } = await supabase
      .from('stores').select('id').eq('company_id', companyId);
    const storeIds = stores?.map((s: { id: string }) => s.id) || [];

    const { data: stockCount } = await supabase
      .from('stock_counts').select('status').eq('id', id).in('store_id', storeIds).single();

    if (!stockCount) {
      res.status(404).json({ error: 'Stock count not found', code: 'NOT_FOUND' });
      return;
    }
    if (stockCount.status !== 'draft') {
      res.status(400).json({ error: 'Already submitted', code: 'ALREADY_SUBMITTED' });
      return;
    }

    const { error } = await supabase
      .from('stock_counts')
      .update({ status: 'submitted', submitted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;

    console.log('✅ Stock count submitted:', id);
    res.json({ message: 'Stock count submitted successfully' });
  } catch (error) {
    console.error('❌ submitStockCount error:', error);
    res.status(500).json({ error: 'Failed to submit stock count', code: 'SUBMIT_ERROR' });
  }
}

async function approveStockCount(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const userId = req.user!.id;
    const supabase = getDb();

    const { data: stores } = await supabase
      .from('stores').select('id').eq('company_id', companyId);
    const storeIds = stores?.map((s: { id: string }) => s.id) || [];

    const { data: stockCount } = await supabase
      .from('stock_counts').select('status').eq('id', id).in('store_id', storeIds).single();

    if (!stockCount) {
      res.status(404).json({ error: 'Stock count not found', code: 'NOT_FOUND' });
      return;
    }
    if (stockCount.status !== 'submitted') {
      res.status(400).json({ error: 'Stock count must be submitted before approving', code: 'NOT_SUBMITTED' });
      return;
    }

    const { error } = await supabase
      .from('stock_counts')
      .update({
        status: 'approved',
        approved_by: userId,
        approved_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', id);
    if (error) throw error;

    console.log('✅ Stock count approved:', id);
    res.json({ message: 'Stock count approved' });
  } catch (error) {
    console.error('❌ approveStockCount error:', error);
    res.status(500).json({ error: 'Failed to approve stock count', code: 'APPROVE_ERROR' });
  }
}

export {
  getStockCounts,
  getStockCount,
  createStockCount,
  updateStockCountItems,
  submitStockCount,
  approveStockCount,
};
