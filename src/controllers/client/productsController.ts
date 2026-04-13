import { Request, Response } from 'express';
import { getDb } from '../../config/database';
import { createBatch, getBatchHistory } from '../../services/fifoService';
import { cacheGet, cacheSet, cacheDel } from '../../config/redis';

async function getProducts(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id, category_id } = req.query;
    const supabase = getDb();

    console.log('📦 Getting products for company:', companyId);

    // Check cache first
    const cacheKey = `products:${companyId}:${store_id || 'all'}:${category_id || 'all'}`;
    const cached = await cacheGet(cacheKey);
    if (cached) {
      console.log('⚡ Products from cache');
      res.json(JSON.parse(cached));
      return;
    }

    // Get store IDs for this company
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    const storeIds = stores?.map((store: { id: string }) => store.id) || [];

    if (storeIds.length === 0) {
      res.json({ products: [], count: 0 });
      return;
    }

    // Build query
    let query = supabase
      .from('products')
      .select(`
        *,
        categories(id, name, color, icon)
      `, { count: 'exact' })
      .in('store_id', storeIds)
      .eq('is_active', true);

    if (store_id) {
      query = query.eq('store_id', store_id);
    }

    if (category_id) {
      query = query.eq('category_id', category_id);
    }

    const { data: products, error, count } = await query.order('name');

    if (error) throw error;

    // For composite products with stock, fetch EARLIEST (not latest) expiry date
    const productsWithExpiry = await Promise.all(
      products.map(async (product: Record<string, unknown>) => {
        if (product.is_composite && (product.stock_quantity as number) > 0) {
          // CHANGED: Order by expiry_date ascending to get EARLIEST
          const { data: earliestBatch } = await supabase
            .from('product_manufacturing')
            .select('expiry_date, batch_number, production_date, quantity_produced')
            .eq('product_id', product.id)
            .not('expiry_date', 'is', null)
            .gte('expiry_date', new Date().toISOString()) // Only future dates
            .order('expiry_date', { ascending: true }) // EARLIEST first
            .limit(1)
            .single();

          // Also get count of total batches
          const { count: batchCount } = await supabase
            .from('product_manufacturing')
            .select('id', { count: 'exact', head: true })
            .eq('product_id', product.id)
            .not('expiry_date', 'is', null);

          return {
            ...product,
            earliest_expiry_date: (earliestBatch as Record<string, unknown> | null)?.expiry_date || null,
            earliest_batch_number: (earliestBatch as Record<string, unknown> | null)?.batch_number || null,
            earliest_production_date: (earliestBatch as Record<string, unknown> | null)?.production_date || null,
            total_batches: batchCount || 0
          };
        }
        return product;
      })
    );

    console.log('✅ Products found:', productsWithExpiry.length);

    const response = {
      products: productsWithExpiry,
      count: count || 0,
      timestamp: new Date().toISOString()
    };

    // Cache for 5 minutes
    await cacheSet(cacheKey, JSON.stringify(response), 300);

    res.json(response);

  } catch (error) {
    console.error('Get products error:', error);
    res.status(500).json({
      error: 'Failed to fetch products',
      code: 'PRODUCTS_ERROR'
    });
  }
}

// Also update getProduct (single product) to show earliest expiry
async function getProduct(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const supabase = getDb();

    // Get store IDs for this company
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    const storeIds = stores?.map((store: { id: string }) => store.id) || [];

    const { data: product, error } = await supabase
      .from('products')
      .select(`
        *,
        categories(id, name, color, icon)
      `)
      .eq('id', id)
      .in('store_id', storeIds)
      .eq('is_active', true)
      .single();

    if (error || !product) {
      res.status(404).json({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND'
      });
      return;
    }

    // If composite with stock, get EARLIEST expiry batch
    if (product.is_composite && product.stock_quantity > 0) {
      const { data: earliestBatch } = await supabase
        .from('product_manufacturing')
        .select('expiry_date, batch_number, production_date, quantity_produced')
        .eq('product_id', product.id)
        .not('expiry_date', 'is', null)
        .gte('expiry_date', new Date().toISOString())
        .order('expiry_date', { ascending: true }) // EARLIEST
        .limit(1)
        .single();

      // Get all batches for detailed view
      const { data: allBatches } = await supabase
        .from('product_manufacturing')
        .select('expiry_date, batch_number, production_date, quantity_produced')
        .eq('product_id', product.id)
        .not('expiry_date', 'is', null)
        .order('expiry_date', { ascending: true });

      product.earliest_expiry_date = (earliestBatch as Record<string, unknown> | null)?.expiry_date || null;
      product.earliest_batch_number = (earliestBatch as Record<string, unknown> | null)?.batch_number || null;
      product.earliest_production_date = (earliestBatch as Record<string, unknown> | null)?.production_date || null;
      product.all_batches = allBatches || [];
      product.total_batches = allBatches?.length || 0;
    }

    res.json({ product });

  } catch (error) {
    console.error('Get product error:', error);
    res.status(500).json({
      error: 'Failed to fetch product',
      code: 'PRODUCT_ERROR'
    });
  }
}


async function createProduct(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const userId = req.user!.id;
    const supabase = getDb();

    const {
      name,
      description,
      sku,
      barcode,
      category_id,
      store_id,
      default_price,
      manila_price,
      delivery_price,
      wholesale_price,
      cost_price,
      expiry_date,
      stock_quantity,
      min_stock_level,
      max_stock_level,
      unit,
      weight,
      dimensions,
      image_url,
      tags,
      is_composite  // NEW: Check if it's a composite product
    } = req.body;

    console.log('📦 Creating product:', name);

    // Validate required fields
    if (!name || !default_price || !store_id) {
      res.status(400).json({
        error: 'Name, default price, and store are required',
        code: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    // Verify store belongs to company
    const { data: store } = await supabase
      .from('stores')
      .select('id')
      .eq('id', store_id)
      .eq('company_id', companyId)
      .single();

    if (!store) {
      res.status(400).json({
        error: 'Invalid store for this company',
        code: 'INVALID_STORE'
      });
      return;
    }

    // Generate SKU if not provided
    let finalSku = sku;
    if (!finalSku) {
      const timestamp = Date.now().toString().slice(-6);
      const namePrefix = name.substring(0, 3).toUpperCase();
      finalSku = `TP-${namePrefix}${timestamp}`;
    }

    // Check if SKU already exists
    const { data: existingSku } = await supabase
      .from('products')
      .select('id')
      .eq('sku', finalSku)
      .single();

    if (existingSku) {
      res.status(409).json({
        error: 'SKU already exists',
        code: 'SKU_EXISTS'
      });
      return;
    }

    // For composite products, don't track stock, set to NULL
    const productStock = is_composite ? null : parseInt(stock_quantity || 0);

    // Create product
    const { data: product, error } = await supabase
      .from('products')
      .insert([{
        name: name.trim(),
        description: description?.trim() || null,
        sku: finalSku,
        barcode: barcode || null,
        category_id: category_id || null,
        store_id,
        default_price: parseFloat(default_price),
        manila_price: manila_price ? parseFloat(manila_price) : null,
        delivery_price: delivery_price ? parseFloat(delivery_price) : null,
        wholesale_price: wholesale_price ? parseFloat(wholesale_price) : null,
        cost_price: cost_price ? parseFloat(cost_price) : null,
        expiry_date: expiry_date || null,
        stock_quantity: productStock,  // NULL for composite
        min_stock_level: is_composite ? null : parseInt(min_stock_level || 5),
        max_stock_level: is_composite ? null : parseInt(max_stock_level || 100),
        unit: unit || 'pcs',
        weight: weight ? parseFloat(weight) : null,
        dimensions: dimensions || null,
        image_url: image_url || null,
        tags: tags || null,
        is_composite: is_composite || false,
        created_by: userId
      }])
      .select(`
        *,
        categories(id, name, color, icon)
      `)
      .single();

    if (error) throw error;

    // Create initial FIFO batch if product has stock and a cost price
    if (!is_composite && productStock != null && productStock > 0 && cost_price) {
      await createBatch(supabase, {
        product_id: product.id,
        store_id,
        cost_price: parseFloat(cost_price),
        qty: productStock as number,
        note: 'Initial stock',
        created_by: userId
      });
    }

    console.log('✅ Product created successfully:', product.id);
    await cacheDel(`products:${companyId}:*`);

    res.status(201).json({
      message: 'Product created successfully',
      product
    });

  } catch (error) {
    console.error('Create product error:', error);
    res.status(500).json({
      error: 'Failed to create product',
      code: 'CREATE_ERROR'
    });
  }
}

async function updateProduct(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const supabase = getDb();

    console.log('📦 Updating product:', id, 'with data:', req.body);

    // Get store IDs for this company
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    const storeIds = stores?.map((store: { id: string }) => store.id) || [];

    if (storeIds.length === 0) {
      res.status(404).json({
        error: 'No stores found for company',
        code: 'NO_STORES_FOUND'
      });
      return;
    }

    // Check if product exists and belongs to company
    const { data: existingProduct } = await supabase
      .from('products')
      .select('*')
      .eq('id', id)
      .in('store_id', storeIds)
      .eq('is_active', true)
      .single();

    if (!existingProduct) {
      res.status(404).json({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND'
      });
      return;
    }

    const updateData: Record<string, unknown> = { ...req.body };
    delete updateData.id; // Remove id from update data
    delete updateData.created_by; // Don't allow changing creator
    delete updateData.created_at; // Don't allow changing creation date

    // If SKU is being changed, check uniqueness
    if (updateData.sku && updateData.sku !== existingProduct.sku) {
      const { data: existingSku } = await supabase
        .from('products')
        .select('id')
        .eq('sku', updateData.sku)
        .in('store_id', storeIds)
        .neq('id', id)
        .single();

      if (existingSku) {
        res.status(409).json({
          error: 'SKU already exists',
          code: 'SKU_EXISTS'
        });
        return;
      }
    }

    // Convert numeric fields, empty strings → null for optional numeric columns
    if (updateData.default_price !== undefined) updateData.default_price = updateData.default_price !== '' ? parseFloat(updateData.default_price as string) : null;
    if (updateData.manila_price !== undefined) updateData.manila_price = updateData.manila_price !== '' ? parseFloat(updateData.manila_price as string) : null;
    if (updateData.delivery_price !== undefined) updateData.delivery_price = updateData.delivery_price !== '' ? parseFloat(updateData.delivery_price as string) : null;
    if (updateData.wholesale_price !== undefined) updateData.wholesale_price = updateData.wholesale_price !== '' ? parseFloat(updateData.wholesale_price as string) : null;
    if (updateData.cost_price !== undefined) updateData.cost_price = updateData.cost_price !== '' ? parseFloat(updateData.cost_price as string) : null;
    if (updateData.expiry_date !== undefined) updateData.expiry_date = updateData.expiry_date !== '' ? updateData.expiry_date : null;
    if (updateData.stock_quantity !== undefined) updateData.stock_quantity = updateData.stock_quantity !== '' ? parseInt(updateData.stock_quantity as string) : null;
    if (updateData.min_stock_level !== undefined) updateData.min_stock_level = updateData.min_stock_level !== '' ? parseInt(updateData.min_stock_level as string) : null;
    if (updateData.max_stock_level !== undefined) updateData.max_stock_level = updateData.max_stock_level !== '' ? parseInt(updateData.max_stock_level as string) : null;
    if (updateData.weight !== undefined) updateData.weight = updateData.weight !== '' ? parseFloat(updateData.weight as string) : null;
    if (updateData.barcode !== undefined && updateData.barcode === '') updateData.barcode = null;

    updateData.updated_at = new Date().toISOString();

    console.log('📦 Processed update data:', updateData);

    const { data: product, error } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', id)
      .select(`
        *,
        categories(id, name, color, icon)
      `)
      .single();

    if (error) {
      console.error('Supabase update error:', error);
      throw error;
    }

    // FIFO batch logic: if cost_price was changed, create a batch for untracked units
    if (updateData.cost_price !== undefined && updateData.cost_price !== null) {
      const newCost = parseFloat(String(updateData.cost_price));
      if (!isNaN(newCost) && newCost > 0) {
        const { data: batches } = await supabase
          .from('product_batches')
          .select('qty_remaining')
          .eq('product_id', id);

        const trackedQty = (batches || []).reduce((sum: number, b: { qty_remaining: number }) => sum + (b.qty_remaining || 0), 0);
        const untracked = (product.stock_quantity || 0) - trackedQty;

        if (untracked > 0) {
          await createBatch(supabase, {
            product_id: id as string,
            store_id: product.store_id,
            cost_price: newCost,
            qty: untracked,
            note: 'Price updated via Edit Product',
            created_by: undefined
          });
          console.log('✅ FIFO batch created for untracked units:', untracked, 'at cost:', newCost);
        }
      }
    }

    console.log('✅ Product updated:', product.name);
    await cacheDel(`products:${companyId}:*`);

    res.json({
      message: 'Product updated successfully',
      product
    });

  } catch (error) {
    const err = error as Error;
    console.error('Update product error:', err);
    res.status(500).json({
      error: 'Failed to update product',
      code: 'UPDATE_PRODUCT_ERROR',
      details: err.message
    });
  }
}

async function deleteProduct(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const supabase = getDb();

    console.log('📦 Deleting product:', id);

    // Get store IDs for this company
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    const storeIds = stores?.map((store: { id: string }) => store.id) || [];

    // Soft delete - set is_active to false
    const { data: product, error } = await supabase
      .from('products')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .in('store_id', storeIds)
      .select('name')
      .single();

    if (error || !product) {
      res.status(404).json({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND'
      });
      return;
    }

    console.log('✅ Product deleted (soft):', product.name);
    await cacheDel(`products:${companyId}:*`);

    res.json({
      message: 'Product deleted successfully',
      product_name: product.name
    });

  } catch (error) {
    console.error('Delete product error:', error);
    res.status(500).json({
      error: 'Failed to delete product',
      code: 'DELETE_PRODUCT_ERROR'
    });
  }
}

async function getCategories(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id } = req.query; // Add store_id filter
    const supabase = getDb();

    console.log('📦 Getting categories for company:', companyId, 'store:', store_id || 'ALL');

    // Get store IDs for this company
    let storesQuery = supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    // If store_id is provided, filter to that specific store
    if (store_id) {
      storesQuery = storesQuery.eq('id', store_id);
    }

    const { data: stores } = await storesQuery;
    const storeIds = stores?.map((store: { id: string }) => store.id) || [];

    if (storeIds.length === 0) {
      res.json({ categories: [] });
      return;
    }

    const { data: categories, error } = await supabase
      .from('categories')
      .select('*')
      .in('store_id', storeIds)
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      throw error;
    }

    res.json({ categories: categories || [] });

  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      error: 'Failed to fetch categories',
      code: 'CATEGORIES_ERROR'
    });
  }
}

async function bulkAdjustStock(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { adjustments } = req.body as {
      adjustments: { product_id: string; add_qty: number }[]
    };
    const supabase = getDb();

    if (!adjustments || adjustments.length === 0) {
      res.status(400).json({ error: 'No adjustments provided' });
      return;
    }

    // Verify all products belong to this company
    const productIds = adjustments.map(a => a.product_id);
    const { data: stores } = await supabase.from('stores').select('id').eq('company_id', companyId);
    const storeIds = stores?.map((s: { id: string }) => s.id) || [];

    const { data: ownedProducts } = await supabase
      .from('products')
      .select('id, stock_quantity, store_id, cost_price, name')
      .in('id', productIds)
      .in('store_id', storeIds);

    type OwnedProduct = { id: string; stock_quantity: number; store_id: string; cost_price: number | null; name: string };
    const ownedMap = new Map<string, OwnedProduct>(
      (ownedProducts as OwnedProduct[] || []).map(p => [p.id, p])
    );
    const validAdjustments = adjustments.filter(a => ownedMap.has(a.product_id));

    if (validAdjustments.length === 0) {
      res.status(403).json({ error: 'No valid products to adjust' });
      return;
    }

    const userId = req.user!.id;

    // Update each product stock, log movement, and update FIFO batches
    const updates = await Promise.all(
      validAdjustments.map(async (adj) => {
        const existing = ownedMap.get(adj.product_id)!;
        const previousStock = existing.stock_quantity || 0;
        const newStock = Math.max(0, previousStock + adj.add_qty);
        const actualDelta = newStock - previousStock; // may differ from add_qty if floored at 0

        const { error } = await supabase
          .from('products')
          .update({ stock_quantity: newStock, updated_at: new Date().toISOString() })
          .eq('id', adj.product_id);

        if (!error) {
          // Log to inventory_movements
          await supabase.from('inventory_movements').insert([{
            product_id: adj.product_id,
            store_id: existing.store_id,
            movement_type: 'adjustment',
            quantity: Math.abs(actualDelta),
            previous_stock: previousStock,
            new_stock: newStock,
            reference_type: 'bulk_adjustment',
            notes: `Bulk adjustment: ${adj.add_qty > 0 ? '+' : ''}${adj.add_qty}`,
            created_by: userId
          }]);

          // FIFO batch handling for stock increases only
          if (adj.add_qty > 0) {
            const { data: latestBatch } = await supabase
              .from('product_batches')
              .select('id, qty_received, qty_remaining')
              .eq('product_id', adj.product_id)
              .eq('store_id', existing.store_id)
              .order('received_at', { ascending: false })
              .limit(1)
              .single();

            if (latestBatch) {
              await supabase
                .from('product_batches')
                .update({
                  qty_received: latestBatch.qty_received + adj.add_qty,
                  qty_remaining: latestBatch.qty_remaining + adj.add_qty
                })
                .eq('id', latestBatch.id);
            }
          }
        }

        return { product_id: adj.product_id, success: !error, error };
      })
    );

    const failed = updates.filter(u => !u.success);
    console.log(`✅ Bulk stock adjusted: ${validAdjustments.length - failed.length} products updated`);

    res.json({
      message: `${validAdjustments.length - failed.length} products updated successfully`,
      updated: validAdjustments.length - failed.length,
      failed: failed.length
    });

  } catch (error) {
    const err = error as Error;
    console.error('❌ Bulk adjust stock error:', err);
    res.status(500).json({ error: 'Failed to adjust stock', code: 'BULK_ADJUST_ERROR' });
  }
}

async function getProductBatches(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const companyId = req.user!.company_id;
    const supabase = getDb();

    const { data: stores } = await supabase.from('stores').select('id').eq('company_id', companyId);
    const storeIds = stores?.map((s: { id: string }) => s.id) || [];

    const { data: product } = await supabase
      .from('products')
      .select('id, store_id')
      .eq('id', id)
      .in('store_id', storeIds)
      .single();

    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    const batches = await getBatchHistory(supabase, id, product.store_id);
    res.json({ batches });
  } catch (error) {
    console.error('❌ Get batches error:', error);
    res.status(500).json({ error: 'Failed to fetch batch history' });
  }
}

async function restockProduct(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const companyId = req.user!.company_id;
    const userId = req.user!.id;
    const { qty, cost_price, selling_price, note } = req.body as { qty: number; cost_price: number; selling_price?: number; note?: string };
    const supabase = getDb();

    if (!qty || qty <= 0) {
      res.status(400).json({ error: 'Quantity must be greater than 0' });
      return;
    }
    if (cost_price == null || cost_price < 0) {
      res.status(400).json({ error: 'Cost price is required' });
      return;
    }

    // Verify product belongs to this company
    const { data: stores } = await supabase.from('stores').select('id').eq('company_id', companyId);
    const storeIds = stores?.map((s: { id: string }) => s.id) || [];

    const { data: product } = await supabase
      .from('products')
      .select('id, stock_quantity, store_id, name')
      .eq('id', id)
      .in('store_id', storeIds)
      .eq('is_active', true)
      .single();

    if (!product) {
      res.status(404).json({ error: 'Product not found', code: 'PRODUCT_NOT_FOUND' });
      return;
    }

    const newStock = (product.stock_quantity || 0) + qty;

    // Update stock_quantity and cost_price on the product
    const updatePayload: Record<string, unknown> = { stock_quantity: newStock, cost_price, updated_at: new Date().toISOString() };
    if (selling_price != null) updatePayload.default_price = selling_price;

    const { data: updated, error: updateError } = await supabase
      .from('products')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;

    // Create FIFO batch for this restock
    await createBatch(supabase, {
      product_id: id,
      store_id: product.store_id,
      cost_price,
      selling_price: selling_price ?? undefined,
      qty,
      note: note || 'Restock',
      created_by: userId
    });

    console.log(`✅ Restocked ${product.name}: +${qty} units @ ₱${cost_price} (total: ${newStock})`);

    res.json({
      message: 'Product restocked successfully',
      product: updated,
      batch: { qty_added: qty, cost_price, new_total_stock: newStock }
    });

  } catch (error) {
    const err = error as Error;
    console.error('❌ Restock error:', err);
    res.status(500).json({ error: 'Failed to restock product', code: 'RESTOCK_ERROR' });
  }
}

export {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getCategories,
  bulkAdjustStock,
  restockProduct,
  getProductBatches
};
