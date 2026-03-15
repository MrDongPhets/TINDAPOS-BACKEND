import { Request, Response } from 'express';
import { getDb } from '../../config/database';

// Generate transfer number
function generateTransferNumber(): string {
  const timestamp = Date.now().toString().slice(-8);
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `TRF-${timestamp}-${random}`;
}

// Create transfer request
async function createTransferRequest(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const userId = req.user!.id;
    const supabase = getDb();

    const { from_store_id, to_store_id, product_id, quantity, reason, notes } = req.body;

    // Validation
    if (!from_store_id || !to_store_id || !product_id || !quantity) {
      res.status(400).json({
        error: 'Missing required fields',
        code: 'VALIDATION_ERROR'
      });
      return;
    }

    if (from_store_id === to_store_id) {
      res.status(400).json({
        error: 'Cannot transfer to the same store',
        code: 'SAME_STORE_ERROR'
      });
      return;
    }

    // Check if product exists in source store with enough stock
    const { data: product, error: productError } = await supabase
      .from('products')
      .select('id, name, stock_quantity, store_id')
      .eq('id', product_id)
      .eq('store_id', from_store_id)
      .single();

    if (productError || !product) {
      res.status(404).json({
        error: 'Product not found in source store',
        code: 'PRODUCT_NOT_FOUND'
      });
      return;
    }

    if (product.stock_quantity < quantity) {
      res.status(400).json({
        error: `Insufficient stock. Available: ${product.stock_quantity}`,
        code: 'INSUFFICIENT_STOCK'
      });
      return;
    }

    // Create transfer request
    const transfer_number = generateTransferNumber();

    const { data: transfer, error } = await supabase
      .from('inventory_transfers')
      .insert({
        company_id: companyId,
        transfer_number,
        from_store_id,
        to_store_id,
        product_id,
        quantity,
        reason,
        notes,
        status: 'pending',
        requested_by: userId
      })
      .select(`
        *,
        from_store:stores!from_store_id(id, name),
        to_store:stores!to_store_id(id, name),
        product:products(id, name, sku)
      `)
      .single();

    if (error) throw error;

    console.log('✅ Transfer request created:', transfer_number);

    res.status(201).json({
      message: 'Transfer request created successfully',
      transfer
    });

  } catch (error) {
    console.error('Create transfer error:', error);
    res.status(500).json({
      error: 'Failed to create transfer request',
      code: 'CREATE_ERROR'
    });
  }
}

// Get all transfers
async function getTransfers(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { status, store_id, product_id } = req.query; // Add product_id
    const supabase = getDb();

    let query = supabase
      .from('inventory_transfers')
      .select(`
        *,
        from_store:stores!from_store_id(id, name),
        to_store:stores!to_store_id(id, name),
        product:products(id, name, sku, image_url),
        requested_by_user:users!requested_by(name, email)
      `)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });

    if (status) {
      query = query.eq('status', status);
    }

    if (store_id) {
      query = query.or(`from_store_id.eq.${store_id},to_store_id.eq.${store_id}`);
    }

    // Add product filter
    if (product_id) {
      query = query.eq('product_id', product_id);
    }

    const { data: transfers, error } = await query;

    if (error) throw error;

    res.json({ transfers, count: transfers.length });

  } catch (error) {
    console.error('Get transfers error:', error);
    res.status(500).json({
      error: 'Failed to fetch transfers',
      code: 'FETCH_ERROR'
    });
  }
}

// Approve transfer (Manager only)
async function approveTransfer(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const supabase = getDb();

    // Get transfer details
    const { data: transfer, error: fetchError } = await supabase
      .from('inventory_transfers')
      .select('*, product:products(name, stock_quantity, store_id)')
      .eq('id', id)
      .single();

    if (fetchError || !transfer) {
      res.status(404).json({ error: 'Transfer not found' });
      return;
    }

    if (transfer.status !== 'pending') {
      res.status(400).json({
        error: `Cannot approve transfer with status: ${transfer.status}`
      });
      return;
    }

    // Check stock availability again
    if (transfer.product.stock_quantity < transfer.quantity) {
      res.status(400).json({
        error: 'Insufficient stock in source store'
      });
      return;
    }

    // Update transfer status
    const { error: updateError } = await supabase
      .from('inventory_transfers')
      .update({
        status: 'approved',
        approved_by: userId,
        approved_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    res.json({ message: 'Transfer approved successfully' });

  } catch (error) {
    console.error('Approve transfer error:', error);
    res.status(500).json({ error: 'Failed to approve transfer' });
  }
}

// Complete transfer (executes the stock movement)
async function completeTransfer(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const supabase = getDb();

    console.log('🔄 Starting transfer completion for:', id);

    // Get transfer with full details
    const { data: transfer, error: fetchError } = await supabase
      .from('inventory_transfers')
      .select(`
        *,
        from_store:stores!from_store_id(id, name),
        to_store:stores!to_store_id(id, name),
        product:products(*)
      `)
      .eq('id', id)
      .single();

    if (fetchError || !transfer) {
      console.error('❌ Transfer not found:', fetchError);
      res.status(404).json({ error: 'Transfer not found' });
      return;
    }

    console.log('📦 Transfer details:', {
      number: transfer.transfer_number,
      product: transfer.product.name,
      from: transfer.from_store.name,
      to: transfer.to_store.name,
      quantity: transfer.quantity,
      status: transfer.status
    });

    if (transfer.status !== 'approved') {
      res.status(400).json({
        error: `Transfer must be approved first. Current status: ${transfer.status}`
      });
      return;
    }

    // Get source product with full details
    const { data: sourceProduct, error: sourceError } = await supabase
      .from('products')
      .select('*')
      .eq('id', transfer.product_id)
      .eq('store_id', transfer.from_store_id)
      .single();

    if (sourceError || !sourceProduct) {
      console.error('❌ Source product not found:', sourceError);
      res.status(404).json({ error: 'Source product not found' });
      return;
    }

    console.log('📊 Source product stock:', {
      current: sourceProduct.stock_quantity,
      transfer: transfer.quantity
    });

    if (sourceProduct.stock_quantity < transfer.quantity) {
      res.status(400).json({
        error: `Insufficient stock. Available: ${sourceProduct.stock_quantity}, Requested: ${transfer.quantity}`
      });
      return;
    }

    // 1. Deduct from source store
    const newSourceStock = sourceProduct.stock_quantity - transfer.quantity;

    console.log('⬇️ Deducting from source store:', {
      product: sourceProduct.name,
      from: sourceProduct.stock_quantity,
      to: newSourceStock
    });

    const { error: updateSourceError } = await supabase
      .from('products')
      .update({
        stock_quantity: newSourceStock,
        updated_at: new Date().toISOString()
      })
      .eq('id', transfer.product_id)
      .eq('store_id', transfer.from_store_id);

    if (updateSourceError) {
      console.error('❌ Failed to update source stock:', updateSourceError);
      throw updateSourceError;
    }

    // 2. Record source movement
    await supabase.from('inventory_movements').insert({
      product_id: transfer.product_id,
      store_id: transfer.from_store_id,
      movement_type: 'transfer',
      quantity: transfer.quantity,
      previous_stock: sourceProduct.stock_quantity,
      new_stock: newSourceStock,
      reference_type: 'transfer_out',
      reference_id: transfer.id,
      notes: `Transfer to ${transfer.to_store.name} - ${transfer.transfer_number}`,
      created_by: userId
    });

    console.log('✅ Source stock updated and movement recorded');

    // 3. Check if same SKU exists in destination store
    const { data: destProducts, error: destSearchError } = await supabase
      .from('products')
      .select('*')
      .eq('sku', sourceProduct.sku)
      .eq('store_id', transfer.to_store_id);

    console.log('🔍 Checking destination store for SKU:', sourceProduct.sku);
    console.log('Found existing products:', destProducts?.length || 0);

    let destProductId: string;
    let isNewProduct = false;

    if (destProducts && destProducts.length > 0) {
      // Product exists - update stock
      const destProduct = destProducts[0];
      const newDestStock = destProduct.stock_quantity + transfer.quantity;

      console.log('⬆️ Updating existing product in destination:', {
        product: destProduct.name,
        from: destProduct.stock_quantity,
        to: newDestStock
      });

      const { error: updateDestError } = await supabase
        .from('products')
        .update({
          stock_quantity: newDestStock,
          updated_at: new Date().toISOString()
        })
        .eq('id', destProduct.id);

      if (updateDestError) {
        console.error('❌ Failed to update destination stock:', updateDestError);
        throw updateDestError;
      }

      destProductId = destProduct.id;

      // Record destination movement
      await supabase.from('inventory_movements').insert({
        product_id: destProduct.id,
        store_id: transfer.to_store_id,
        movement_type: 'transfer',
        quantity: transfer.quantity,
        previous_stock: destProduct.stock_quantity,
        new_stock: newDestStock,
        reference_type: 'transfer_in',
        reference_id: transfer.id,
        notes: `Transfer from ${transfer.from_store.name} - ${transfer.transfer_number}`,
        created_by: userId
      });

      console.log('✅ Destination stock updated');
    } else {
      // Product doesn't exist - create new
      console.log('➕ Creating new product in destination store');

      isNewProduct = true;

      const newProductData = {
        name: sourceProduct.name,
        description: sourceProduct.description,
        sku: sourceProduct.sku,
        barcode: sourceProduct.barcode,
        category_id: sourceProduct.category_id,
        store_id: transfer.to_store_id,
        default_price: sourceProduct.default_price,
        manila_price: sourceProduct.manila_price,
        delivery_price: sourceProduct.delivery_price,
        wholesale_price: sourceProduct.wholesale_price,
        stock_quantity: transfer.quantity,
        min_stock_level: sourceProduct.min_stock_level,
        max_stock_level: sourceProduct.max_stock_level,
        unit: sourceProduct.unit,
        weight: sourceProduct.weight,
        dimensions: sourceProduct.dimensions,
        image_url: sourceProduct.image_url,
        images: sourceProduct.images,
        is_active: true,
        is_featured: sourceProduct.is_featured,
        tags: sourceProduct.tags,
        created_by: userId
      };

      console.log('📝 New product data:', {
        name: newProductData.name,
        sku: newProductData.sku,
        store: transfer.to_store_id,
        quantity: newProductData.stock_quantity
      });

      const { data: newProduct, error: createError } = await supabase
        .from('products')
        .insert(newProductData)
        .select()
        .single();

      if (createError) {
        console.error('❌ Failed to create product:', createError);
        throw createError;
      }

      console.log('✅ New product created with ID:', newProduct.id);

      destProductId = newProduct.id;

      // Record destination movement
      await supabase.from('inventory_movements').insert({
        product_id: newProduct.id,
        store_id: transfer.to_store_id,
        movement_type: 'transfer',
        quantity: transfer.quantity,
        previous_stock: 0,
        new_stock: transfer.quantity,
        reference_type: 'transfer_in',
        reference_id: transfer.id,
        notes: `Transfer from ${transfer.from_store.name} - ${transfer.transfer_number} (New product)`,
        created_by: userId
      });

      console.log('✅ Movement recorded for new product');
    }

    // 4. Mark transfer as completed
    const { error: completeError } = await supabase
      .from('inventory_transfers')
      .update({
        status: 'completed',
        received_by: userId,
        received_at: new Date().toISOString()
      })
      .eq('id', id);

    if (completeError) {
      console.error('❌ Failed to mark transfer as completed:', completeError);
      throw completeError;
    }

    console.log('✅✅✅ Transfer completed successfully!');
    console.log('Summary:', {
      transfer_number: transfer.transfer_number,
      product: sourceProduct.name,
      quantity: transfer.quantity,
      from_store: transfer.from_store.name,
      to_store: transfer.to_store.name,
      destination_product_id: destProductId!,
      is_new_product: isNewProduct
    });

    res.json({
      message: 'Transfer completed successfully',
      transfer_number: transfer.transfer_number,
      destination_product_id: destProductId!,
      is_new_product: isNewProduct,
      details: {
        product_name: sourceProduct.name,
        quantity_transferred: transfer.quantity,
        from_store: transfer.from_store.name,
        to_store: transfer.to_store.name
      }
    });

  } catch (error) {
    const err = error as Error;
    console.error('💥 Complete transfer error:', err);
    res.status(500).json({
      error: 'Failed to complete transfer',
      details: err.message,
      code: 'TRANSFER_COMPLETE_ERROR'
    });
  }
}

// Reject transfer
async function rejectTransfer(req: Request, res: Response): Promise<void> {
  try {
    const userId = req.user!.id;
    const { id } = req.params;
    const { rejection_reason } = req.body;
    const supabase = getDb();

    const { error } = await supabase
      .from('inventory_transfers')
      .update({
        status: 'rejected',
        approved_by: userId,
        rejection_reason,
        approved_at: new Date().toISOString()
      })
      .eq('id', id)
      .eq('status', 'pending');

    if (error) throw error;

    res.json({ message: 'Transfer rejected' });

  } catch (error) {
    res.status(500).json({ error: 'Failed to reject transfer' });
  }
}

export {
  createTransferRequest,
  getTransfers,
  approveTransfer,
  completeTransfer,
  rejectTransfer
};
