import { Request, Response } from 'express';
import { getDb } from '../../config/database';

// Cost per unit sold, most accurate first:
//   1. sales_items.cost_price — actual FIFO cost recorded at sale time
//   2. products.cost_price    — current cost (older sales recorded before FIFO)
//   3. 70% of unit price      — last-resort estimate (counted so the UI can flag it)
const FALLBACK_COST_RATIO = 0.7;

function unitCost(item: { cost_price?: number | string | null; unit_price: number | string; products?: { cost_price?: number | null } | null }) {
  const saleCost = Number(item.cost_price);
  if (saleCost > 0) return { cost: saleCost, estimated: false };
  const productCost = Number(item.products?.cost_price);
  if (productCost > 0) return { cost: productCost, estimated: false };
  return { cost: Number(item.unit_price) * FALLBACK_COST_RATIO, estimated: true };
}

// Missing-table errors (gcash_expenses.sql not run yet) → treat as zero instead of failing the report
const isMissingTable = (error: { code?: string } | null) => !!error && ['42P01', 'PGRST205', 'SQLITE_ERROR'].includes(error.code || '');

// Sum of manual expenses + GCash fee income for the report period.
// No store filter = whole company (includes company-wide expenses with store_id NULL).
async function getExpensesAndGcashFees(
  db: ReturnType<typeof getDb>,
  companyId: string,
  storeId?: string,
  startDate?: string,
  endDate?: string
): Promise<{ operatingExpenses: number; gcashFeeIncome: number }> {
  let expensesQuery = db.from('expenses').select('amount').eq('company_id', companyId);
  if (storeId) expensesQuery = expensesQuery.eq('store_id', storeId);
  if (startDate) expensesQuery = expensesQuery.gte('expense_date', startDate.slice(0, 10));
  if (endDate) expensesQuery = expensesQuery.lte('expense_date', endDate.slice(0, 10));

  let gcashQuery = db.from('gcash_transactions').select('fee').eq('company_id', companyId);
  if (storeId) gcashQuery = gcashQuery.eq('store_id', storeId);
  if (startDate) gcashQuery = gcashQuery.gte('created_at', startDate);
  if (endDate) gcashQuery = gcashQuery.lte('created_at', endDate);

  const [expensesResult, gcashResult] = await Promise.all([expensesQuery, gcashQuery]);
  if (expensesResult.error && !isMissingTable(expensesResult.error)) throw expensesResult.error;
  if (gcashResult.error && !isMissingTable(gcashResult.error)) throw gcashResult.error;

  return {
    operatingExpenses: (expensesResult.data || []).reduce((s: number, e: { amount: number | string }) => s + Number(e.amount || 0), 0),
    gcashFeeIncome: (gcashResult.data || []).reduce((s: number, g: { fee: number | string }) => s + Number(g.fee || 0), 0),
  };
}

// Get financial summary
async function getFinancialReports(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id, start_date, end_date } = req.query;
    const supabase = getDb();

    console.log('📊 Getting financial reports for company:', companyId);

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
      res.json({ summary: {}, timestamp: new Date().toISOString() });
      return;
    }

    // Get sales with filters
    let salesQuery = supabase
      .from('sales')
      .select('id, total_amount, subtotal, discount_amount, tax_amount, created_at')
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

    // COGS from actual recorded costs (see unitCost)
    let cogs = 0;
    let cogsEstimatedItems = 0;
    if (salesIds.length > 0) {
      const { data: salesItems, error: itemsError } = await supabase
        .from('sales_items')
        .select('quantity, unit_price, cost_price, products!sales_items_product_id_fkey(cost_price)')
        .in('sales_id', salesIds);

      if (itemsError) throw itemsError;

      for (const item of (salesItems || []) as Array<{ quantity: number | string; unit_price: number | string; cost_price?: number | string | null; products?: { cost_price?: number | null } | null }>) {
        const { cost, estimated } = unitCost(item);
        cogs += cost * Number(item.quantity);
        if (estimated) cogsEstimatedItems++;
      }
    }

    // Calculate financial metrics
    const typedSales = sales as Array<{
      total_amount?: string | number;
      discount_amount?: string | number;
      tax_amount?: string | number;
    }>;

    const totalRevenue = typedSales.reduce((sum, s) => sum + parseFloat(String(s.total_amount || 0)), 0);
    const totalDiscount = typedSales.reduce((sum, s) => sum + parseFloat(String(s.discount_amount || 0)), 0);
    const totalTax = typedSales.reduce((sum, s) => sum + parseFloat(String(s.tax_amount || 0)), 0);
    const grossProfit = totalRevenue - cogs;

    // Operating expenses (rent, electricity, ...) and GCash cash-in/out fee income
    const { operatingExpenses, gcashFeeIncome } = await getExpensesAndGcashFees(
      supabase, companyId as string, store_id as string | undefined, start_date as string | undefined, end_date as string | undefined
    );

    // total_amount is already after discounts — don't subtract them again
    const netProfit = grossProfit - operatingExpenses + gcashFeeIncome;

    const summary = {
      total_revenue: parseFloat(totalRevenue.toFixed(2)),
      total_cogs: parseFloat(cogs.toFixed(2)),
      cogs_estimated_items: cogsEstimatedItems,
      gross_profit: parseFloat(grossProfit.toFixed(2)),
      gross_margin: totalRevenue > 0 ? parseFloat(((grossProfit / totalRevenue) * 100).toFixed(2)) : 0,
      total_discount: parseFloat(totalDiscount.toFixed(2)),
      total_tax: parseFloat(totalTax.toFixed(2)),
      operating_expenses: parseFloat(operatingExpenses.toFixed(2)),
      gcash_fee_income: parseFloat(gcashFeeIncome.toFixed(2)),
      net_profit: parseFloat(netProfit.toFixed(2)),
      net_margin: totalRevenue > 0 ? parseFloat(((netProfit / totalRevenue) * 100).toFixed(2)) : 0,
      total_transactions: sales.length
    };

    console.log('✅ Financial summary calculated');

    res.json({
      summary,
      filters: { store_id, start_date, end_date },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Financial reports error:', error);
    res.status(500).json({
      error: 'Failed to fetch financial reports',
      code: 'FINANCIAL_REPORTS_ERROR'
    });
  }
}

// Get profit margins by product/category
async function getProfitMargins(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id, start_date, end_date, group_by = 'product' } = req.query;
    const supabase = getDb();

    console.log('📊 Getting profit margins grouped by:', group_by);

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
      res.json({ items: [], timestamp: new Date().toISOString() });
      return;
    }

    // Get sales
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
      res.json({ items: [], timestamp: new Date().toISOString() });
      return;
    }

    // Get sales items with product details
    const { data: salesItems, error: itemsError } = await supabase
      .from('sales_items')
      .select(`
        quantity,
        unit_price,
        cost_price,
        total_price,
        discount_amount,
        product_id,
        products!sales_items_product_id_fkey(
          id,
          name,
          sku,
          default_price,
          cost_price,
          category_id,
          categories!fk_products_category(id, name, color)
        )
      `)
      .in('sales_id', salesIds);

    if (itemsError) throw itemsError;

    // Group data
    const grouped: Record<string, {
      id: string;
      name: string;
      total_revenue: number;
      total_cogs: number;
      total_quantity: number;
      total_discount: number;
      color?: string;
      sku?: string;
    }> = {};

    (salesItems as Array<{
      quantity: string | number;
      unit_price: number;
      cost_price?: number | string | null;
      total_price: string | number;
      discount_amount?: string | number;
      product_id: string;
      products?: {
        name?: string;
        sku?: string;
        cost_price?: number;
        category_id?: string;
        categories?: { name?: string; color?: string };
      };
    }>).forEach(item => {
      let key: string;
      let name: string;
      let groupId: string;

      if (group_by === 'category') {
        groupId = item.products?.category_id || 'uncategorized';
        name = item.products?.categories?.name || 'Uncategorized';
        key = groupId;
      } else {
        groupId = item.product_id;
        name = item.products?.name || 'Unknown Product';
        key = groupId;
      }

      if (!grouped[key]) {
        grouped[key] = {
          id: groupId,
          name: name,
          total_revenue: 0,
          total_cogs: 0,
          total_quantity: 0,
          total_discount: 0
        };

        if (group_by === 'category') {
          grouped[key].color = item.products?.categories?.color;
        } else {
          grouped[key].sku = item.products?.sku;
        }
      }

      const quantity = parseInt(String(item.quantity));
      const revenue = parseFloat(String(item.total_price));
      const itemCogs = unitCost(item).cost * quantity;

      grouped[key].total_revenue += revenue;
      grouped[key].total_cogs += itemCogs;
      grouped[key].total_quantity += quantity;
      grouped[key].total_discount += parseFloat(String(item.discount_amount || 0));
    });

    // Calculate margins
    const items = Object.values(grouped).map(item => {
      const grossProfit = item.total_revenue - item.total_cogs;
      const grossMargin = item.total_revenue > 0
        ? (grossProfit / item.total_revenue) * 100
        : 0;

      // total_price is already after the item discount — net = gross at item level
      const netProfit = grossProfit;
      const netMargin = item.total_revenue > 0
        ? (netProfit / item.total_revenue) * 100
        : 0;

      return {
        ...item,
        gross_profit: parseFloat(grossProfit.toFixed(2)),
        gross_margin: parseFloat(grossMargin.toFixed(2)),
        net_profit: parseFloat(netProfit.toFixed(2)),
        net_margin: parseFloat(netMargin.toFixed(2)),
        average_selling_price: item.total_quantity > 0
          ? parseFloat((item.total_revenue / item.total_quantity).toFixed(2))
          : 0
      };
    }).sort((a, b) => b.gross_profit - a.gross_profit);

    console.log('✅ Profit margins calculated');

    res.json({
      items,
      group_by,
      filters: { store_id, start_date, end_date },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Profit margins error:', error);
    res.status(500).json({
      error: 'Failed to calculate profit margins',
      code: 'PROFIT_MARGINS_ERROR'
    });
  }
}

// Get expense tracking (from inventory movements - purchases)
async function getExpenseTracking(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id, start_date, end_date } = req.query;
    const supabase = getDb();

    console.log('📊 Getting expense tracking');

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
      res.json({ expenses: [], summary: {}, timestamp: new Date().toISOString() });
      return;
    }

    // Get inventory movements (purchases = 'in' type)
    let query = supabase
      .from('inventory_movements')
      .select(`
        id,
        movement_type,
        quantity,
        unit_cost,
        total_cost,
        reference_type,
        notes,
        created_at,
        products!fk_inventory_product(id, name, sku, category_id)
      `)
      .in('store_id', storeIds)
      .eq('movement_type', 'in');

    if (start_date) {
      query = query.gte('created_at', start_date);
    }

    if (end_date) {
      query = query.lte('created_at', end_date);
    }

    const { data: movements, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    type MovementRow = {
      id: string;
      movement_type: string;
      quantity: string | number;
      unit_cost?: string | number;
      total_cost?: string | number;
      reference_type?: string;
      notes?: string;
      created_at: string;
      products?: { id?: string; name?: string; sku?: string; category_id?: string };
    };

    const typedMovements = movements as MovementRow[];

    // Calculate summary
    const summary = {
      total_expenses: typedMovements.reduce((sum, m) => sum + parseFloat(String(m.total_cost || 0)), 0),
      total_transactions: typedMovements.length,
      total_items: typedMovements.reduce((sum, m) => sum + parseInt(String(m.quantity || 0)), 0),
      average_cost_per_transaction: typedMovements.length > 0
        ? typedMovements.reduce((sum, m) => sum + parseFloat(String(m.total_cost || 0)), 0) / typedMovements.length
        : 0
    };

    // Group by category for breakdown
    const byCategory: Record<string, { total_cost: number; count: number }> = {};
    typedMovements.forEach(movement => {
      const categoryId = movement.products?.category_id || 'uncategorized';

      if (!byCategory[categoryId]) {
        byCategory[categoryId] = {
          total_cost: 0,
          count: 0
        };
      }

      byCategory[categoryId].total_cost += parseFloat(String(movement.total_cost || 0));
      byCategory[categoryId].count += 1;
    });

    console.log('✅ Expense tracking calculated');

    res.json({
      expenses: typedMovements.map(m => ({
        ...m,
        product_name: m.products?.name,
        product_sku: m.products?.sku
      })),
      summary,
      by_category: byCategory,
      filters: { store_id, start_date, end_date },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Expense tracking error:', error);
    res.status(500).json({
      error: 'Failed to fetch expense tracking',
      code: 'EXPENSE_TRACKING_ERROR'
    });
  }
}

// Get tax reports
async function getTaxReports(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id, start_date, end_date, group_by = 'daily' } = req.query;
    const supabase = getDb();

    console.log('📊 Getting tax reports');

    // Build sales query
    let query = supabase
      .from('sales')
      .select('created_at, total_amount, subtotal, tax_amount, payment_method')
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
    const grouped: Record<string, {
      period: string;
      total_sales: number;
      total_tax: number;
      transaction_count: number;
    }> = {};

    (sales as Array<{
      created_at: string;
      total_amount?: string | number;
      tax_amount?: string | number;
    }>).forEach(sale => {
      const date = new Date(sale.created_at);
      let key: string;

      switch (group_by) {
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

      if (!grouped[key]) {
        grouped[key] = {
          period: key,
          total_sales: 0,
          total_tax: 0,
          transaction_count: 0
        };
      }

      grouped[key].total_sales += parseFloat(String(sale.total_amount || 0));
      grouped[key].total_tax += parseFloat(String(sale.tax_amount || 0));
      grouped[key].transaction_count += 1;
    });

    const taxData = Object.values(grouped);

    const typedSales = sales as Array<{ total_amount?: string | number; tax_amount?: string | number }>;

    // Calculate summary
    const totalSalesAmt = typedSales.reduce((sum, s) => sum + parseFloat(String(s.total_amount || 0)), 0);
    const totalTaxAmt = typedSales.reduce((sum, s) => sum + parseFloat(String(s.tax_amount || 0)), 0);

    const summary = {
      total_sales: totalSalesAmt,
      total_tax_collected: totalTaxAmt,
      total_transactions: sales.length,
      average_tax_per_transaction: sales.length > 0
        ? totalTaxAmt / sales.length
        : 0,
      effective_tax_rate: totalSalesAmt > 0 ? (totalTaxAmt / totalSalesAmt) * 100 : 0
    };

    console.log('✅ Tax reports calculated');

    res.json({
      summary,
      data: taxData,
      group_by,
      filters: { store_id, start_date, end_date },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Tax reports error:', error);
    res.status(500).json({
      error: 'Failed to fetch tax reports',
      code: 'TAX_REPORTS_ERROR'
    });
  }
}

// Get revenue by store
async function getRevenueByStore(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { start_date, end_date } = req.query;
    const supabase = getDb();

    console.log('📊 Getting revenue by store');

    // Get all company stores
    const { data: stores, error: storesError } = await supabase
      .from('stores')
      .select('id, name, address')
      .eq('company_id', companyId)
      .eq('is_active', true);

    if (storesError) throw storesError;

    // Get sales for each store
    let query = supabase
      .from('sales')
      .select('store_id, total_amount, subtotal, discount_amount, tax_amount, items_count')
      .eq('company_id', companyId);

    if (start_date) {
      query = query.gte('created_at', start_date);
    }

    if (end_date) {
      query = query.lte('created_at', end_date);
    }

    const { data: sales, error: salesError } = await query;

    if (salesError) throw salesError;

    type StoreRow = { id: string; name: string; address: string };
    type SaleRow = {
      store_id: string;
      total_amount?: string | number;
      discount_amount?: string | number;
      tax_amount?: string | number;
      items_count?: string | number;
    };

    const typedStores = stores as StoreRow[];
    const typedSales = sales as SaleRow[];

    // Group by store
    const storeRevenue = typedStores.map(store => {
      const storeSales = typedSales.filter(s => s.store_id === store.id);

      const totalRevenue = storeSales.reduce((sum, s) => sum + parseFloat(String(s.total_amount || 0)), 0);
      const totalDiscount = storeSales.reduce((sum, s) => sum + parseFloat(String(s.discount_amount || 0)), 0);
      const totalTax = storeSales.reduce((sum, s) => sum + parseFloat(String(s.tax_amount || 0)), 0);
      const transactionCount = storeSales.length;

      return {
        store_id: store.id,
        store_name: store.name,
        store_address: store.address,
        total_revenue: parseFloat(totalRevenue.toFixed(2)),
        total_discount: parseFloat(totalDiscount.toFixed(2)),
        total_tax: parseFloat(totalTax.toFixed(2)),
        transaction_count: transactionCount,
        average_transaction: transactionCount > 0
          ? parseFloat((totalRevenue / transactionCount).toFixed(2))
          : 0,
        total_items_sold: storeSales.reduce((sum, s) => sum + parseInt(String(s.items_count || 0)), 0)
      };
    }).sort((a, b) => b.total_revenue - a.total_revenue);

    // Calculate company totals
    const companyTotals = {
      total_revenue: storeRevenue.reduce((sum, s) => sum + s.total_revenue, 0),
      total_stores: typedStores.length,
      total_transactions: storeRevenue.reduce((sum, s) => sum + s.transaction_count, 0),
      average_revenue_per_store: typedStores.length > 0
        ? storeRevenue.reduce((sum, s) => sum + s.total_revenue, 0) / typedStores.length
        : 0
    };

    console.log('✅ Revenue by store calculated');

    res.json({
      stores: storeRevenue,
      company_totals: companyTotals,
      filters: { start_date, end_date },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Revenue by store error:', error);
    res.status(500).json({
      error: 'Failed to fetch revenue by store',
      code: 'REVENUE_BY_STORE_ERROR'
    });
  }
}

export {
  getFinancialReports,
  getProfitMargins,
  getExpenseTracking,
  getTaxReports,
  getRevenueByStore
};
