import { Request, Response } from 'express';
import { getDb } from '../../config/database';

// Get inventory summary
async function getInventoryReports(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id } = req.query;
    const supabase = getDb();

    console.log('📊 Getting inventory reports for company:', companyId);

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
      res.json({ summary: {}, products: [], timestamp: new Date().toISOString() });
      return;
    }

    // Get products with stock (use default_price instead of cost_price)
    const { data: products, error } = await supabase
      .from('products')
      .select(`
        id,
        name,
        sku,
        stock_quantity,
        min_stock_level,
        max_stock_level,
        default_price,
        category_id,
        categories!fk_products_category(name, color)
      `)
      .in('store_id', storeIds)
      .eq('is_active', true);

    if (error) throw error;

    type ProductRow = {
      id: string;
      name: string;
      sku: string;
      stock_quantity: number;
      min_stock_level: number;
      max_stock_level: number;
      default_price: number;
      category_id: string;
      categories?: { name?: string; color?: string };
    };

    const typedProducts = products as ProductRow[];

    // Calculate summary (use default_price for both cost and retail)
    const summary = {
      total_products: typedProducts.length,
      total_stock_quantity: typedProducts.reduce((sum, p) => sum + (p.stock_quantity || 0), 0),
      low_stock_count: typedProducts.filter(p => p.stock_quantity <= p.min_stock_level).length,
      out_of_stock_count: typedProducts.filter(p => p.stock_quantity === 0).length,
      total_stock_value: typedProducts.reduce((sum, p) =>
        sum + ((p.default_price || 0) * (p.stock_quantity || 0)), 0
      ),
      total_retail_value: typedProducts.reduce((sum, p) =>
        sum + ((p.default_price || 0) * (p.stock_quantity || 0)), 0
      )
    };

    console.log('✅ Inventory summary calculated');

    res.json({
      summary,
      products: typedProducts.map(p => ({
        ...p,
        category_name: p.categories?.name,
        category_color: p.categories?.color,
        stock_value: (p.default_price || 0) * (p.stock_quantity || 0),
        retail_value: (p.default_price || 0) * (p.stock_quantity || 0),
        stock_status: p.stock_quantity === 0 ? 'out_of_stock'
          : p.stock_quantity <= p.min_stock_level ? 'low_stock'
          : 'in_stock'
      })),
      filters: { store_id },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Inventory reports error:', error);
    res.status(500).json({
      error: 'Failed to fetch inventory reports',
      code: 'INVENTORY_REPORTS_ERROR'
    });
  }
}

// Get stock value by category
async function getStockValue(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id } = req.query;
    const supabase = getDb();

    console.log('📊 Getting stock value breakdown');

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
      res.json({ categories: [], total: 0, timestamp: new Date().toISOString() });
      return;
    }

    // Get products with category (use default_price)
    const { data: products, error } = await supabase
      .from('products')
      .select(`
        id,
        name,
        stock_quantity,
        default_price,
        category_id,
        categories!fk_products_category(id, name, color)
      `)
      .in('store_id', storeIds)
      .eq('is_active', true);

    if (error) throw error;

    // Group by category
    const categoryStats: Record<string, {
      category_id: string;
      category_name: string;
      category_color: string;
      total_products: number;
      total_quantity: number;
      cost_value: number;
      retail_value: number;
    }> = {};

    (products as Array<{
      id: string;
      name: string;
      stock_quantity: number;
      default_price: number;
      category_id: string | null;
      categories?: { name?: string; color?: string };
    }>).forEach(product => {
      const categoryId = product.category_id || 'uncategorized';
      const categoryName = product.categories?.name || 'Uncategorized';
      const categoryColor = product.categories?.color || '#gray';

      if (!categoryStats[categoryId]) {
        categoryStats[categoryId] = {
          category_id: categoryId,
          category_name: categoryName,
          category_color: categoryColor,
          total_products: 0,
          total_quantity: 0,
          cost_value: 0,
          retail_value: 0
        };
      }

      const quantity = product.stock_quantity || 0;
      const price = product.default_price || 0;

      categoryStats[categoryId].total_products += 1;
      categoryStats[categoryId].total_quantity += quantity;
      categoryStats[categoryId].cost_value += price * quantity;
      categoryStats[categoryId].retail_value += price * quantity;
    });

    const categories = Object.values(categoryStats)
      .map(cat => ({
        ...cat,
        potential_profit: cat.retail_value - cat.cost_value,
        profit_margin: cat.cost_value > 0
          ? ((cat.retail_value - cat.cost_value) / cat.cost_value) * 100
          : 0
      }))
      .sort((a, b) => b.retail_value - a.retail_value);

    const total = {
      cost_value: categories.reduce((sum, c) => sum + c.cost_value, 0),
      retail_value: categories.reduce((sum, c) => sum + c.retail_value, 0),
      potential_profit: categories.reduce((sum, c) => sum + c.potential_profit, 0)
    };

    console.log('✅ Stock value calculated');

    res.json({
      categories,
      total,
      filters: { store_id },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Stock value error:', error);
    res.status(500).json({
      error: 'Failed to fetch stock value',
      code: 'STOCK_VALUE_ERROR'
    });
  }
}

// Get inventory turnover rates
async function getTurnoverRates(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id, days = 30 } = req.query;
    const supabase = getDb();

    console.log('📊 Getting turnover rates for', days, 'days');

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
      res.json({ products: [], timestamp: new Date().toISOString() });
      return;
    }

    // Get date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - parseInt(String(days)));

    // Get products with current stock (use default_price)
    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('id, name, sku, stock_quantity, default_price, category_id')
      .in('store_id', storeIds)
      .eq('is_active', true);

    if (productsError) throw productsError;

    // Get sales items for period
    const { data: sales } = await supabase
      .from('sales')
      .select('id')
      .eq('company_id', companyId)
      .gte('created_at', startDate.toISOString())
      .lte('created_at', endDate.toISOString());

    const salesIds = sales?.map((s: { id: string }) => s.id) || [];

    if (salesIds.length === 0) {
      res.json({
        products: (products as Array<{
          id: string;
          name: string;
          sku: string;
          stock_quantity: number;
          default_price: number;
          category_id: string;
        }>).map(p => ({
          ...p,
          quantity_sold: 0,
          turnover_rate: 0,
          days_to_sell: null
        })),
        timestamp: new Date().toISOString()
      });
      return;
    }

    const { data: salesItems, error: itemsError } = await supabase
      .from('sales_items')
      .select('product_id, quantity')
      .in('sales_id', salesIds);

    if (itemsError) throw itemsError;

    // Calculate turnover for each product
    const productSales: Record<string, number> = {};

    (salesItems as Array<{ product_id: string; quantity: string | number }>).forEach(item => {
      if (!productSales[item.product_id]) {
        productSales[item.product_id] = 0;
      }
      productSales[item.product_id] += parseInt(String(item.quantity));
    });

    const daysNum = parseInt(String(days));

    const productsWithTurnover = (products as Array<{
      id: string;
      name: string;
      sku: string;
      stock_quantity: number;
      default_price: number;
      category_id: string;
    }>).map(product => {
      const quantitySold = productSales[product.id] || 0;
      const currentStock = product.stock_quantity || 0;
      const averageStock = (currentStock + quantitySold) / 2;

      // Turnover rate = (Quantity Sold / Average Stock) * (365 / Days)
      const turnoverRate = averageStock > 0
        ? (quantitySold / averageStock) * (365 / daysNum)
        : 0;

      // Days to sell current stock
      const daysToSell = turnoverRate > 0
        ? currentStock / (quantitySold / daysNum)
        : null;

      return {
        product_id: product.id,
        product_name: product.name,
        product_sku: product.sku,
        current_stock: currentStock,
        quantity_sold: quantitySold,
        turnover_rate: parseFloat(turnoverRate.toFixed(2)),
        days_to_sell: daysToSell ? parseFloat(daysToSell.toFixed(1)) : null,
        stock_value: (product.default_price || 0) * currentStock,
        sales_velocity: parseFloat((quantitySold / daysNum).toFixed(2))
      };
    }).sort((a, b) => b.turnover_rate - a.turnover_rate);

    console.log('✅ Turnover rates calculated');

    res.json({
      products: productsWithTurnover,
      period: { days: daysNum, start_date: startDate, end_date: endDate },
      filters: { store_id },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Turnover rates error:', error);
    res.status(500).json({
      error: 'Failed to calculate turnover rates',
      code: 'TURNOVER_RATES_ERROR'
    });
  }
}

// Get low stock products
async function getLowStockProducts(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id, threshold_type = 'min' } = req.query;
    const supabase = getDb();

    console.log('📊 Getting low stock products');

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
      res.json({ products: [], timestamp: new Date().toISOString() });
      return;
    }

    // Get products (use default_price)
    const { data: products, error } = await supabase
      .from('products')
      .select(`
        id,
        name,
        sku,
        stock_quantity,
        min_stock_level,
        max_stock_level,
        default_price,
        store_id,
        categories!fk_products_category(name, color)
      `)
      .in('store_id', storeIds)
      .eq('is_active', true);

    if (error) throw error;

    // Filter based on threshold type
    const lowStockProducts = (products as Array<{
      id: string;
      name: string;
      sku: string;
      stock_quantity: number;
      min_stock_level: number;
      max_stock_level: number;
      default_price: number;
      store_id: string;
      categories?: { name?: string; color?: string };
    }>)
      .filter(p => {
        if (threshold_type === 'out') {
          return p.stock_quantity === 0;
        }
        return p.stock_quantity <= p.min_stock_level;
      })
      .map(p => ({
        ...p,
        category_name: p.categories?.name,
        category_color: p.categories?.color,
        stock_status: p.stock_quantity === 0 ? 'out_of_stock' : 'low_stock',
        reorder_quantity: p.max_stock_level - p.stock_quantity,
        stock_value: (p.default_price || 0) * p.stock_quantity
      }))
      .sort((a, b) => a.stock_quantity - b.stock_quantity);

    console.log('✅ Low stock products found:', lowStockProducts.length);

    res.json({
      products: lowStockProducts,
      count: lowStockProducts.length,
      filters: { store_id, threshold_type },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Low stock products error:', error);
    res.status(500).json({
      error: 'Failed to fetch low stock products',
      code: 'LOW_STOCK_ERROR'
    });
  }
}

// Get inventory movement summary
async function getInventoryMovementSummary(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id, start_date, end_date, movement_type } = req.query;
    const supabase = getDb();

    console.log('📊 Getting inventory movement summary');

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
      res.json({ movements: [], summary: {}, timestamp: new Date().toISOString() });
      return;
    }

    // Build movements query
    let query = supabase
      .from('inventory_movements')
      .select(`
        id,
        movement_type,
        quantity,
        previous_stock,
        new_stock,
        total_cost,
        reference_type,
        notes,
        created_at,
        products!fk_inventory_product(id, name, sku)
      `)
      .in('store_id', storeIds);

    if (movement_type) {
      query = query.eq('movement_type', movement_type);
    }

    if (start_date) {
      query = query.gte('created_at', start_date);
    }

    if (end_date) {
      query = query.lte('created_at', end_date);
    }

    const { data: movements, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    // Calculate summary by type
    const summary: {
      total_movements: number;
      by_type: Record<string, { count: number; total_quantity: number; total_cost: number }>;
    } = {
      total_movements: movements.length,
      by_type: {}
    };

    (movements as Array<{
      movement_type: string;
      quantity: number;
      total_cost?: string | number;
    }>).forEach(movement => {
      const type = movement.movement_type;

      if (!summary.by_type[type]) {
        summary.by_type[type] = {
          count: 0,
          total_quantity: 0,
          total_cost: 0
        };
      }

      summary.by_type[type].count += 1;
      summary.by_type[type].total_quantity += Math.abs(movement.quantity);
      summary.by_type[type].total_cost += parseFloat(String(movement.total_cost || 0));
    });

    console.log('✅ Movement summary calculated');

    res.json({
      movements: (movements as Array<Record<string, unknown> & { products?: { name?: string; sku?: string } }>).map(m => ({
        ...m,
        product_name: m.products?.name,
        product_sku: m.products?.sku
      })),
      summary,
      filters: { store_id, start_date, end_date, movement_type },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Movement summary error:', error);
    res.status(500).json({
      error: 'Failed to fetch movement summary',
      code: 'MOVEMENT_SUMMARY_ERROR'
    });
  }
}

export {
  getInventoryReports,
  getStockValue,
  getTurnoverRates,
  getLowStockProducts,
  getInventoryMovementSummary
};
