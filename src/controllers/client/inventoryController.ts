import { Request, Response } from 'express';
import { getDb } from '../../config/database';
import { createBatch } from '../../services/fifoService';

async function getMovements(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const supabase = getDb();

    console.log('📊 Getting inventory movements for company:', companyId);

    // Get store IDs for this company
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    const storeIds = stores?.map((store: { id: string }) => store.id) || [];

    if (storeIds.length === 0) {
      res.json({ movements: [], count: 0 });
      return;
    }

    // Get movements with product details
    const { data: movements, error, count } = await supabase
      .from('inventory_movements')
      .select(`
        *,
        products!fk_inventory_product(name, sku)
      `, { count: 'exact' })
      .in('store_id', storeIds)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    // Transform data to include product name
    const transformedMovements = movements?.map((movement: Record<string, unknown> & { products?: { name: string; sku: string } }) => ({
      ...movement,
      product_name: movement.products?.name || 'Unknown Product',
      product_sku: movement.products?.sku
    })) || [];

    console.log('✅ Movements found:', transformedMovements.length);

    res.json({
      movements: transformedMovements,
      count: count || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get movements error:', error);
    res.status(500).json({
      error: 'Failed to fetch inventory movements',
      code: 'MOVEMENTS_ERROR'
    });
  }
}

async function createStockAdjustment(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const userId = req.user!.id;
    const supabase = getDb();

    const {
      product_id,
      adjustment_type,
      quantity,
      cost_price,
      selling_price,
      reason,
      notes
    } = req.body;

    console.log('📦 Creating stock adjustment for product:', product_id);

    // Validate required fields
    if (!product_id || !adjustment_type || !quantity) {
      res.status(400).json({
        error: 'Product ID, adjustment type, and quantity are required',
        code: 'VALIDATION_ERROR'
      });
      return;
    }

    // Get store IDs for this company
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    const storeIds = stores?.map((store: { id: string }) => store.id) || [];

    // Get current product stock
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('stock_quantity, name, store_id, cost_price, default_price')
      .eq('id', product_id)
      .in('store_id', storeIds)
      .single();

    if (productError || !product) {
      res.status(404).json({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND'
      });
      return;
    }

    const currentStock = product.stock_quantity || 0;
    const adjustmentQty = parseInt(quantity);

    let newStock: number;
    let movementType: string;

    if (adjustment_type === 'increase') {
      newStock = currentStock + adjustmentQty;
      movementType = 'in';
    } else if (adjustment_type === 'decrease') {
      newStock = Math.max(0, currentStock - adjustmentQty); // Don't go below 0
      movementType = 'out';
    } else {
      res.status(400).json({
        error: 'Invalid adjustment type. Must be "increase" or "decrease"',
        code: 'INVALID_ADJUSTMENT_TYPE'
      });
      return;
    }

    // Start transaction
    const { data: movement, error: movementError } = await supabase
      .from('inventory_movements')
      .insert([{
        product_id: product_id,
        store_id: product.store_id,
        movement_type: 'adjustment',
        quantity: adjustmentQty,
        previous_stock: currentStock,
        new_stock: newStock,
        reference_type: 'manual_adjustment',
        notes: notes || `${adjustment_type} by ${adjustmentQty} - ${reason || 'Manual adjustment'}`,
        created_by: userId
      }])
      .select()
      .single();

    if (movementError) {
      throw movementError;
    }

    // Update product stock
    const { error: updateError } = await supabase
      .from('products')
      .update({
        stock_quantity: newStock,
        updated_at: new Date().toISOString()
      })
      .eq('id', product_id);

    if (updateError) {
      throw updateError;
    }

    // FIFO batch handling for stock increases
    const parsedCost = cost_price != null && cost_price !== '' ? parseFloat(cost_price) : null;
    const existingCost = product.cost_price != null ? parseFloat(String(product.cost_price)) : null;

    if (adjustment_type === 'increase') {
      const isNewPrice = parsedCost != null && !isNaN(parsedCost) && parsedCost !== existingCost;

      if (isNewPrice) {
        // New price → create a new batch
        const newSell = selling_price != null && selling_price !== '' ? parseFloat(selling_price) : null;
        await createBatch(supabase, {
          product_id,
          store_id: product.store_id,
          cost_price: parsedCost as number,
          selling_price: newSell ?? product.default_price ?? undefined,
          qty: adjustmentQty,
          note: notes || reason || 'Stock adjustment',
          created_by: userId
        });
        await supabase.from('products').update({ cost_price: parsedCost }).eq('id', product_id);
      } else {
        // No new price → add qty to the latest existing batch (keep FIFO tracking accurate)
        const { data: latestBatch } = await supabase
          .from('product_batches')
          .select('id, qty_received, qty_remaining')
          .eq('product_id', product_id)
          .eq('store_id', product.store_id)
          .order('received_at', { ascending: false })
          .limit(1)
          .single();

        if (latestBatch) {
          await supabase
            .from('product_batches')
            .update({
              qty_received: latestBatch.qty_received + adjustmentQty,
              qty_remaining: latestBatch.qty_remaining + adjustmentQty
            })
            .eq('id', latestBatch.id);
        }
        // If no batches exist: leave as legacy (untracked)
      }
    }

    console.log('✅ Stock adjustment completed:', {
      product: product.name,
      from: currentStock,
      to: newStock,
      adjustment: adjustmentQty
    });

    res.status(201).json({
      message: 'Stock adjustment completed successfully',
      movement: {
        ...movement,
        product_name: product.name
      },
      new_stock: newStock
    });

  } catch (error) {
    console.error('Stock adjustment error:', error);
    res.status(500).json({
      error: 'Failed to create stock adjustment',
      code: 'ADJUSTMENT_ERROR'
    });
  }
}

async function getLowStockAlerts(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const supabase = getDb();

    console.log('🚨 Getting low stock alerts for company:', companyId);

    // Get store IDs for this company
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    const storeIds = stores?.map((store: { id: string }) => store.id) || [];

    if (storeIds.length === 0) {
      res.json({ alerts: [], count: 0 });
      return;
    }

    // Get products with low stock (stock_quantity <= min_stock_level)
    const { data: lowStockProducts, error } = await supabase
      .from('products')
      .select(`
        id,
        name,
        sku,
        stock_quantity,
        min_stock_level,
        categories(name)
      `)
      .in('store_id', storeIds)
      .eq('is_active', true)
      .not('min_stock_level', 'is', null)
      .filter('stock_quantity', 'lte', 'min_stock_level');

    if (error) {
      throw error;
    }

    // Also get out of stock products
    const { data: outOfStockProducts, error: outError } = await supabase
      .from('products')
      .select(`
        id,
        name,
        sku,
        stock_quantity,
        min_stock_level,
        categories(name)
      `)
      .in('store_id', storeIds)
      .eq('is_active', true)
      .eq('stock_quantity', 0);

    if (outError) {
      throw outError;
    }

    const alerts = [
      ...(lowStockProducts || []).map((product: { stock_quantity: number; min_stock_level: number; [key: string]: unknown }) => ({
        ...product,
        alert_type: 'low_stock',
        severity: 'warning',
        message: `Only ${product.stock_quantity} units left (Min: ${product.min_stock_level})`
      })),
      ...(outOfStockProducts || []).map((product: Record<string, unknown>) => ({
        ...product,
        alert_type: 'out_of_stock',
        severity: 'critical',
        message: 'Product is out of stock'
      }))
    ];

    console.log('✅ Alerts found:', alerts.length);

    res.json({
      alerts,
      count: alerts.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get alerts error:', error);
    res.status(500).json({
      error: 'Failed to fetch low stock alerts',
      code: 'ALERTS_ERROR'
    });
  }
}

export {
  getMovements,
  createStockAdjustment,
  getLowStockAlerts
};
