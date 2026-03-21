import { Request, Response } from 'express';
import { getDb } from '../../config/database';

async function getProducts(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id, category_id } = req.query;
    const supabase = getDb();

    console.log('📦 Getting products for company:', companyId);

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

    res.json({
      products: productsWithExpiry,
      count: count || 0,
      timestamp: new Date().toISOString()
    });

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
      finalSku = `${namePrefix}${timestamp}`;
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
      .select()
      .single();

    if (error) throw error;

    console.log('✅ Product created successfully:', product.id);

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

    console.log('✅ Product updated:', product.name);

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
      adjustments: { product_id: string; new_stock: number; reason?: string }[]
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
      .select('id, stock_quantity, name')
      .in('id', productIds)
      .in('store_id', storeIds);

    const ownedIds = new Set(ownedProducts?.map((p: { id: string }) => p.id) || []);
    const validAdjustments = adjustments.filter(a => ownedIds.has(a.product_id));

    if (validAdjustments.length === 0) {
      res.status(403).json({ error: 'No valid products to adjust' });
      return;
    }

    // Update each product stock
    const updates = await Promise.all(
      validAdjustments.map(async (adj) => {
        const { error } = await supabase
          .from('products')
          .update({ stock_quantity: adj.new_stock, updated_at: new Date().toISOString() })
          .eq('id', adj.product_id);
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

export {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getCategories,
  bulkAdjustStock
};
