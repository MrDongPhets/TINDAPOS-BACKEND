import { Request, Response } from 'express';
import { getDb } from '../../config/database';

// Get sales summary
async function getSalesReports(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id, start_date, end_date } = req.query;
    const supabase = getDb();

    console.log('📊 Getting sales reports for company:', companyId);

    // Build query
    let query = supabase
      .from('sales')
      .select('*')
      .eq('company_id', companyId);

    if (store_id) {
      query = query.eq('store_id', store_id);
    }

    if (start_date) {
      query = query.gte('created_at', start_date);
    }

    if (end_date) {
      query = query.lte('created_at', end_date);
    }

    const { data: sales, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    // Calculate summary
    const summary = {
      total_sales: (sales as Array<{ total_amount: string | number }>).reduce((sum, sale) => sum + parseFloat(String(sale.total_amount)), 0),
      total_transactions: sales.length,
      total_items: (sales as Array<{ items_count?: string | number }>).reduce((sum, sale) => sum + parseInt(String(sale.items_count || 0)), 0),
      average_transaction: sales.length > 0
        ? (sales as Array<{ total_amount: string | number }>).reduce((sum, sale) => sum + parseFloat(String(sale.total_amount)), 0) / sales.length
        : 0,
      total_discount: (sales as Array<{ discount_amount?: string | number }>).reduce((sum, sale) => sum + parseFloat(String(sale.discount_amount || 0)), 0),
      total_tax: (sales as Array<{ tax_amount?: string | number }>).reduce((sum, sale) => sum + parseFloat(String(sale.tax_amount || 0)), 0)
    };

    console.log('✅ Sales summary calculated');

    res.json({
      summary,
      sales,
      filters: { store_id, start_date, end_date },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Sales reports error:', error);
    res.status(500).json({
      error: 'Failed to fetch sales reports',
      code: 'SALES_REPORTS_ERROR'
    });
  }
}

// Get sales by period (daily/weekly/monthly)
async function getSalesReportByPeriod(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { period = 'daily', store_id, start_date, end_date } = req.query;
    const supabase = getDb();

    console.log('📊 Getting sales by period:', period);

    // Build base query
    let query = supabase
      .from('sales')
      .select('created_at, total_amount, items_count, discount_amount, tax_amount')
      .eq('company_id', companyId);

    if (store_id) {
      query = query.eq('store_id', store_id);
    }

    if (start_date) {
      query = query.gte('created_at', start_date);
    }

    if (end_date) {
      query = query.lte('created_at', end_date);
    }

    const { data: sales, error } = await query.order('created_at', { ascending: true });

    if (error) throw error;

    // Group by period
    const groupedData: Record<string, {
      period: string;
      total_sales: number;
      total_transactions: number;
      total_items: number;
      total_discount: number;
      total_tax: number;
    }> = {};

    (sales as Array<{
      created_at: string;
      total_amount: string | number;
      items_count?: string | number;
      discount_amount?: string | number;
      tax_amount?: string | number;
    }>).forEach(sale => {
      const date = new Date(sale.created_at);
      let key: string;

      switch (period) {
        case 'daily':
          key = date.toISOString().split('T')[0];
          break;
        case 'weekly': {
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          key = weekStart.toISOString().split('T')[0];
          break;
        }
        case 'monthly':
          key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          break;
        default:
          key = date.toISOString().split('T')[0];
      }

      if (!groupedData[key]) {
        groupedData[key] = {
          period: key,
          total_sales: 0,
          total_transactions: 0,
          total_items: 0,
          total_discount: 0,
          total_tax: 0
        };
      }

      groupedData[key].total_sales += parseFloat(String(sale.total_amount));
      groupedData[key].total_transactions += 1;
      groupedData[key].total_items += parseInt(String(sale.items_count || 0));
      groupedData[key].total_discount += parseFloat(String(sale.discount_amount || 0));
      groupedData[key].total_tax += parseFloat(String(sale.tax_amount || 0));
    });

    const result = Object.values(groupedData).map(item => ({
      ...item,
      average_transaction: item.total_transactions > 0
        ? item.total_sales / item.total_transactions
        : 0
    }));

    console.log('✅ Sales grouped by period:', period);

    res.json({
      period,
      data: result,
      filters: { store_id, start_date, end_date },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Sales period report error:', error);
    res.status(500).json({
      error: 'Failed to fetch sales by period',
      code: 'SALES_PERIOD_ERROR'
    });
  }
}

// Get top selling products
async function getTopProducts(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id, start_date, end_date, limit = 10 } = req.query;
    const supabase = getDb();

    console.log('📊 Getting top products');

    // Get stores for company
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    const storeIds = stores?.map((s: { id: string }) => s.id) || [];

    if (storeIds.length === 0) {
      res.json({ products: [], timestamp: new Date().toISOString() });
      return;
    }

    // Build sales items query
    let salesQuery = supabase
      .from('sales')
      .select('id, created_at')
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

    const { data: sales, error: salesError } = await salesQuery;

    if (salesError) throw salesError;

    const salesIds = (sales as Array<{ id: string }>).map(s => s.id);

    if (salesIds.length === 0) {
      res.json({ products: [], timestamp: new Date().toISOString() });
      return;
    }

    // Get sales items with product details
    const { data: salesItems, error: itemsError } = await supabase
      .from('sales_items')
      .select(`
        product_id,
        quantity,
        unit_price,
        total_price,
        discount_amount,
        products!sales_items_product_id_fkey(id, name, sku, image_url, category_id)
      `)
      .in('sales_id', salesIds);

    if (itemsError) throw itemsError;

    // Group by product
    const productStats: Record<string, {
      product_id: string;
      product_name: string;
      product_sku: string | undefined;
      product_image: string | undefined;
      category_id: string | undefined;
      total_quantity: number;
      total_sales: number;
      total_discount: number;
      transaction_count: number;
    }> = {};

    (salesItems as Array<{
      product_id: string;
      quantity: string | number;
      unit_price: string | number;
      total_price: string | number;
      discount_amount?: string | number;
      products?: { name?: string; sku?: string; image_url?: string; category_id?: string };
    }>).forEach(item => {
      const productId = item.product_id;

      if (!productStats[productId]) {
        productStats[productId] = {
          product_id: productId,
          product_name: item.products?.name || 'Unknown',
          product_sku: item.products?.sku,
          product_image: item.products?.image_url,
          category_id: item.products?.category_id,
          total_quantity: 0,
          total_sales: 0,
          total_discount: 0,
          transaction_count: 0
        };
      }

      productStats[productId].total_quantity += parseInt(String(item.quantity));
      productStats[productId].total_sales += parseFloat(String(item.total_price));
      productStats[productId].total_discount += parseFloat(String(item.discount_amount || 0));
      productStats[productId].transaction_count += 1;
    });

    // Convert to array and sort by quantity sold
    const topProducts = Object.values(productStats)
      .sort((a, b) => b.total_quantity - a.total_quantity)
      .slice(0, parseInt(String(limit)));

    console.log('✅ Top products calculated:', topProducts.length);

    res.json({
      products: topProducts,
      filters: { store_id, start_date, end_date, limit },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Top products error:', error);
    res.status(500).json({
      error: 'Failed to fetch top products',
      code: 'TOP_PRODUCTS_ERROR'
    });
  }
}

// Get staff performance
async function getStaffPerformance(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id, start_date, end_date } = req.query;
    const supabase = getDb();

    console.log('📊 Getting staff performance');

    // Build query
    let query = supabase
      .from('sales')
      .select(`
        staff_id,
        total_amount,
        items_count,
        discount_amount,
        created_at,
        staff!sales_staff_id_fkey(id, name, staff_id, role, image_url)
      `)
      .eq('company_id', companyId)
      .not('staff_id', 'is', null);

    if (store_id) {
      query = query.eq('store_id', store_id);
    }

    if (start_date) {
      query = query.gte('created_at', start_date);
    }

    if (end_date) {
      query = query.lte('created_at', end_date);
    }

    const { data: sales, error } = await query;

    if (error) throw error;

    // Group by staff
    const staffStats: Record<string, {
      staff_id: string;
      staff_name: string;
      staff_code: string | undefined;
      staff_role: string | undefined;
      staff_image: string | undefined;
      total_sales: number;
      total_transactions: number;
      total_items: number;
      total_discount: number;
      average_transaction: number;
    }> = {};

    (sales as Array<{
      staff_id: string;
      total_amount: string | number;
      items_count?: string | number;
      discount_amount?: string | number;
      staff?: { name?: string; staff_id?: string; role?: string; image_url?: string };
    }>).forEach(sale => {
      const staffId = sale.staff_id;

      if (!staffStats[staffId]) {
        staffStats[staffId] = {
          staff_id: staffId,
          staff_name: sale.staff?.name || 'Unknown',
          staff_code: sale.staff?.staff_id,
          staff_role: sale.staff?.role,
          staff_image: sale.staff?.image_url,
          total_sales: 0,
          total_transactions: 0,
          total_items: 0,
          total_discount: 0,
          average_transaction: 0
        };
      }

      staffStats[staffId].total_sales += parseFloat(String(sale.total_amount));
      staffStats[staffId].total_transactions += 1;
      staffStats[staffId].total_items += parseInt(String(sale.items_count || 0));
      staffStats[staffId].total_discount += parseFloat(String(sale.discount_amount || 0));
    });

    // Calculate averages and sort
    const performance = Object.values(staffStats)
      .map(staff => ({
        ...staff,
        average_transaction: staff.total_transactions > 0
          ? staff.total_sales / staff.total_transactions
          : 0,
        items_per_transaction: staff.total_transactions > 0
          ? staff.total_items / staff.total_transactions
          : 0
      }))
      .sort((a, b) => b.total_sales - a.total_sales);

    console.log('✅ Staff performance calculated:', performance.length);

    res.json({
      performance,
      filters: { store_id, start_date, end_date },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Staff performance error:', error);
    res.status(500).json({
      error: 'Failed to fetch staff performance',
      code: 'STAFF_PERFORMANCE_ERROR'
    });
  }
}

// Compare sales across periods
async function getSalesComparison(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const {
      period1_start,
      period1_end,
      period2_start,
      period2_end,
      store_id
    } = req.query;
    const supabase = getDb();

    console.log('📊 Comparing sales periods');

    if (!period1_start || !period1_end || !period2_start || !period2_end) {
      res.status(400).json({
        error: 'All period dates are required',
        code: 'VALIDATION_ERROR'
      });
      return;
    }

    // Get period 1 sales
    let query1 = supabase
      .from('sales')
      .select('total_amount, items_count, discount_amount')
      .eq('company_id', companyId)
      .gte('created_at', period1_start)
      .lte('created_at', period1_end);

    if (store_id) query1 = query1.eq('store_id', store_id);

    const { data: period1Sales, error: error1 } = await query1;

    if (error1) throw error1;

    // Get period 2 sales
    let query2 = supabase
      .from('sales')
      .select('total_amount, items_count, discount_amount')
      .eq('company_id', companyId)
      .gte('created_at', period2_start)
      .lte('created_at', period2_end);

    if (store_id) query2 = query2.eq('store_id', store_id);

    const { data: period2Sales, error: error2 } = await query2;

    if (error2) throw error2;

    // Calculate stats for both periods
    const calculateStats = (sales: Array<{ total_amount: string | number; items_count?: string | number; discount_amount?: string | number }>) => ({
      total_sales: sales.reduce((sum, s) => sum + parseFloat(String(s.total_amount)), 0),
      total_transactions: sales.length,
      total_items: sales.reduce((sum, s) => sum + parseInt(String(s.items_count || 0)), 0),
      total_discount: sales.reduce((sum, s) => sum + parseFloat(String(s.discount_amount || 0)), 0),
      average_transaction: sales.length > 0
        ? sales.reduce((sum, s) => sum + parseFloat(String(s.total_amount)), 0) / sales.length
        : 0
    });

    const period1Stats = calculateStats(period1Sales as Array<{ total_amount: string | number; items_count?: string | number; discount_amount?: string | number }>);
    const period2Stats = calculateStats(period2Sales as Array<{ total_amount: string | number; items_count?: string | number; discount_amount?: string | number }>);

    // Calculate growth
    const growth = {
      sales_growth: period1Stats.total_sales > 0
        ? ((period2Stats.total_sales - period1Stats.total_sales) / period1Stats.total_sales) * 100
        : 0,
      transactions_growth: period1Stats.total_transactions > 0
        ? ((period2Stats.total_transactions - period1Stats.total_transactions) / period1Stats.total_transactions) * 100
        : 0,
      items_growth: period1Stats.total_items > 0
        ? ((period2Stats.total_items - period1Stats.total_items) / period1Stats.total_items) * 100
        : 0
    };

    console.log('✅ Sales comparison calculated');

    res.json({
      period1: {
        range: { start: period1_start, end: period1_end },
        stats: period1Stats
      },
      period2: {
        range: { start: period2_start, end: period2_end },
        stats: period2Stats
      },
      growth,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Sales comparison error:', error);
    res.status(500).json({
      error: 'Failed to compare sales periods',
      code: 'SALES_COMPARISON_ERROR'
    });
  }
}

export {
  getSalesReports,
  getSalesReportByPeriod,
  getTopProducts,
  getStaffPerformance,
  getSalesComparison
};
