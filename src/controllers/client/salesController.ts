// src/controllers/client/salesController.ts - Sales Management Backend
import { Request, Response } from 'express';
import { getDb } from '../../config/database';

// Get all sales with filters and pagination
async function getAllSales(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const {
      store_id,
      start_date,
      end_date,
      staff_id,
      payment_method,
      search,
      page = 1,
      limit = 50,
      sort_by = 'created_at',
      sort_order = 'desc'
    } = req.query;

    const supabase = getDb();

    console.log('📊 Getting all sales for company:', companyId);

    // Get stores for this company
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    const storeIds = stores?.map((s: { id: string }) => s.id) || [];

    if (storeIds.length === 0) {
      res.json({ sales: [], count: 0, page: 1, total_pages: 0 });
      return;
    }

    // Build query
    let query = supabase
      .from('sales')
      .select(`
        id,
        receipt_number,
        total_amount,
        subtotal,
        discount_amount,
        tax_amount,
        payment_method,
        items_count,
        customer_name,
        customer_phone,
        notes,
        created_at,
        staff:staff_id(id, name, staff_id),
        stores:store_id(id, name)
      `, { count: 'exact' })
      .eq('company_id', companyId);

    // Apply filters
    if (store_id) {
      query = query.eq('store_id', store_id);
    } else {
      query = query.in('store_id', storeIds);
    }

    if (staff_id) {
      query = query.eq('staff_id', staff_id);
    }

    if (payment_method) {
      query = query.eq('payment_method', payment_method);
    }

    if (start_date) {
      query = query.gte('created_at', start_date);
    }

    if (end_date) {
      query = query.lte('created_at', end_date);
    }

    if (search) {
      query = query.or(`receipt_number.ilike.%${search}%,customer_name.ilike.%${search}%,customer_phone.ilike.%${search}%`);
    }

    // Apply sorting
    query = query.order(sort_by as string, { ascending: sort_order === 'asc' });

    // Apply pagination
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string);
    query = query.range(offset, offset + parseInt(limit as string) - 1);

    const { data: sales, error, count } = await query;

    if (error) throw error;

    const totalPages = Math.ceil((count || 0) / parseInt(limit as string));

    console.log('✅ Sales fetched:', sales.length);

    res.json({
      sales: sales || [],
      count: count || 0,
      page: parseInt(page as string),
      limit: parseInt(limit as string),
      total_pages: totalPages,
      filters: {
        store_id,
        staff_id,
        payment_method,
        start_date,
        end_date,
        search
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get all sales error:', error);
    res.status(500).json({
      error: 'Failed to fetch sales',
      code: 'SALES_FETCH_ERROR'
    });
  }
}

// Get single sale details with items
async function getSaleDetails(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const supabase = getDb();

    console.log('📄 Getting sale details:', id);

    // Get sale with all relations
    const { data: sale, error } = await supabase
      .from('sales')
      .select(`
        *,
        staff:staff_id(id, name, staff_id, role),
        stores:store_id(id, name, address, phone),
        created_by_user:created_by(id, name, email)
      `)
      .eq('id', id)
      .eq('company_id', companyId)
      .single();

    if (error || !sale) {
      res.status(404).json({
        error: 'Sale not found',
        code: 'SALE_NOT_FOUND'
      });
      return;
    }

    // Get sale items with product details
    const { data: items, error: itemsError } = await supabase
      .from('sales_items')
      .select(`
        *,
        products(id, name, sku, image_url, default_price)
      `)
      .eq('sales_id', id)
      .order('created_at', { ascending: true });

    if (itemsError) throw itemsError;

    console.log('✅ Sale details fetched');

    res.json({
      sale: {
        ...sale,
        items: items || []
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get sale details error:', error);
    res.status(500).json({
      error: 'Failed to fetch sale details',
      code: 'SALE_DETAILS_ERROR'
    });
  }
}

// Get sales summary/statistics
async function getSalesSummary(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id, start_date, end_date } = req.query;
    const supabase = getDb();

    console.log('📊 Getting sales summary');

    // Get stores
    let storesQuery = supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    if (store_id) {
      storesQuery = storesQuery.eq('id', store_id);
    }

    const { data: stores } = await storesQuery;
    const storeIds = stores?.map((s: { id: string }) => s.id) || [];

    if (storeIds.length === 0) {
      res.json({ summary: {} });
      return;
    }

    // Build sales query
    let salesQuery = supabase
      .from('sales')
      .select('total_amount, discount_amount, tax_amount, items_count, payment_method, created_at')
      .eq('company_id', companyId);

    if (store_id) {
      salesQuery = salesQuery.eq('store_id', store_id);
    } else {
      salesQuery = salesQuery.in('store_id', storeIds);
    }

    if (start_date) {
      salesQuery = salesQuery.gte('created_at', start_date);
    }

    if (end_date) {
      salesQuery = salesQuery.lte('created_at', end_date);
    }

    const { data: sales, error } = await salesQuery;

    if (error) throw error;

    // Calculate summary
    const summary: {
      total_sales: number;
      total_transactions: number;
      total_items: number;
      total_discount: number;
      total_tax: number;
      average_transaction: number;
      payment_methods: Record<string, { count: number; total: number }>;
    } = {
      total_sales: sales.reduce((sum: number, s: { total_amount?: string | number }) => sum + parseFloat(String(s.total_amount || 0)), 0),
      total_transactions: sales.length,
      total_items: sales.reduce((sum: number, s: { items_count?: string | number }) => sum + parseInt(String(s.items_count || 0)), 0),
      total_discount: sales.reduce((sum: number, s: { discount_amount?: string | number }) => sum + parseFloat(String(s.discount_amount || 0)), 0),
      total_tax: sales.reduce((sum: number, s: { tax_amount?: string | number }) => sum + parseFloat(String(s.tax_amount || 0)), 0),
      average_transaction: sales.length > 0
        ? sales.reduce((sum: number, s: { total_amount?: string | number }) => sum + parseFloat(String(s.total_amount || 0)), 0) / sales.length
        : 0,
      payment_methods: {}
    };

    // Group by payment method
    sales.forEach((sale: { payment_method?: string; total_amount?: string | number }) => {
      const method = sale.payment_method || 'unknown';
      if (!summary.payment_methods[method]) {
        summary.payment_methods[method] = {
          count: 0,
          total: 0
        };
      }
      summary.payment_methods[method].count += 1;
      summary.payment_methods[method].total += parseFloat(String(sale.total_amount || 0));
    });

    console.log('✅ Sales summary calculated');

    res.json({
      summary,
      filters: { store_id, start_date, end_date },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Sales summary error:', error);
    res.status(500).json({
      error: 'Failed to fetch sales summary',
      code: 'SALES_SUMMARY_ERROR'
    });
  }
}

// Void/Cancel a sale (soft delete or mark as cancelled)
async function voidSale(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const companyId = req.user!.company_id;
    const userId = req.user!.id;
    const supabase = getDb();

    console.log('🚫 Voiding sale:', id);

    // Get sale details first
    const { data: sale, error: saleError } = await supabase
      .from('sales')
      .select('*, sales_items(*)')
      .eq('id', id)
      .eq('company_id', companyId)
      .single();

    if (saleError || !sale) {
      res.status(404).json({
        error: 'Sale not found',
        code: 'SALE_NOT_FOUND'
      });
      return;
    }

    // For now, just add a note (you can add a status column later)
    const voidNote = `VOIDED: ${reason || 'No reason provided'} - By user ${userId} at ${new Date().toISOString()}`;

    const { error: updateError } = await supabase
      .from('sales')
      .update({
        notes: sale.notes ? `${sale.notes}\n${voidNote}` : voidNote
      })
      .eq('id', id);

    if (updateError) throw updateError;

    // Optionally restore inventory
    // (You can implement this based on your business logic)

    console.log('✅ Sale voided');

    res.json({
      message: 'Sale voided successfully',
      sale_id: id,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Void sale error:', error);
    res.status(500).json({
      error: 'Failed to void sale',
      code: 'VOID_SALE_ERROR'
    });
  }
}

// Get recent sales (last 24 hours)
async function getRecentSales(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id, limit = 20 } = req.query;
    const supabase = getDb();

    console.log('⏰ Getting recent sales');

    // Get stores
    let storesQuery = supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    if (store_id) {
      storesQuery = storesQuery.eq('id', store_id);
    }

    const { data: stores } = await storesQuery;
    const storeIds = stores?.map((s: { id: string }) => s.id) || [];

    if (storeIds.length === 0) {
      res.json({ sales: [] });
      return;
    }

    // Get last 24 hours
    const yesterday = new Date();
    yesterday.setHours(yesterday.getHours() - 24);

    let query = supabase
      .from('sales')
      .select(`
        id,
        receipt_number,
        total_amount,
        items_count,
        payment_method,
        created_at,
        staff:staff_id(name),
        stores:store_id(name)
      `)
      .eq('company_id', companyId)
      .gte('created_at', yesterday.toISOString())
      .order('created_at', { ascending: false })
      .limit(parseInt(limit as string));

    if (store_id) {
      query = query.eq('store_id', store_id);
    } else {
      query = query.in('store_id', storeIds);
    }

    const { data: sales, error } = await query;

    if (error) throw error;

    console.log('✅ Recent sales fetched:', sales.length);

    res.json({
      sales: sales || [],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Recent sales error:', error);
    res.status(500).json({
      error: 'Failed to fetch recent sales',
      code: 'RECENT_SALES_ERROR'
    });
  }
}

export {
  getAllSales,
  getSaleDetails,
  getSalesSummary,
  voidSale,
  getRecentSales
};
