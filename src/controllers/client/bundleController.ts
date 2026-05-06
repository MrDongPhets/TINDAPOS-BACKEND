import { Request, Response } from 'express';
import { getDb } from '../../config/database';

async function getBundles(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id } = req.query;
    const supabase = getDb();

    // Products have no company_id — filter through stores
    let storeFilter: string[] = [];
    if (store_id) {
      storeFilter = [store_id as string];
    } else {
      const { data: stores } = await supabase
        .from('stores')
        .select('id')
        .eq('company_id', companyId);
      storeFilter = (stores || []).map((s: { id: string }) => s.id);
    }

    if (storeFilter.length === 0) {
      res.json({ bundles: [] });
      return;
    }

    const { data, error } = await supabase
      .from('products')
      .select(`
        id, name, description, default_price, image_url, is_active, store_id, category_id,
        bundle_items!bundle_items_bundle_id_fkey(
          id, quantity,
          component:product_id(id, name, default_price, stock_quantity, image_url)
        )
      `)
      .in('store_id', storeFilter)
      .eq('product_type', 'bundle')
      .eq('is_active', true)
      .order('name');
    if (error) throw error;

    // Compute effective stock per bundle (min of floor(component_stock / required_qty))
    const bundles = (data || []).map((b: any) => {
      const items: any[] = b.bundle_items || [];
      const effectiveStock = items.length === 0 ? 0 : Math.min(
        ...items.map((i: any) => Math.floor((i.component?.stock_quantity ?? 0) / i.quantity))
      );
      return { ...b, effective_stock: effectiveStock };
    });

    res.json({ bundles });
  } catch (error) {
    const err = error as Error;
    console.error('❌ Get bundles error:', err);
    res.status(500).json({ error: 'Failed to fetch bundles' });
  }
}

async function createBundle(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { name, description, default_price, store_id, category_id, image_url, items } = req.body;
    const supabase = getDb();

    if (!name || !default_price || !store_id || !items?.length) {
      res.status(400).json({ error: 'name, default_price, store_id, and items are required' });
      return;
    }

    const { data: bundle, error: bundleError } = await supabase
      .from('products')
      .insert({
        store_id,
        name,
        description: description || null,
        default_price: parseFloat(default_price),
        category_id: category_id || null,
        image_url: image_url || null,
        product_type: 'bundle',
        stock_quantity: 0,
        is_active: true,
        created_by: req.user!.id,
      })
      .select()
      .single();

    if (bundleError) throw bundleError;

    const bundleItems = (items as Array<{ product_id: string; quantity: number }>).map(item => ({
      bundle_id: bundle.id,
      product_id: item.product_id,
      quantity: item.quantity,
      company_id: companyId,
    }));

    const { error: itemsError } = await supabase.from('bundle_items').insert(bundleItems);
    if (itemsError) throw itemsError;

    console.log('✅ Bundle created:', bundle.id);
    res.status(201).json({ bundle, message: 'Bundle created successfully' });
  } catch (error) {
    const err = error as Error;
    console.error('❌ Create bundle error:', err);
    res.status(500).json({ error: 'Failed to create bundle' });
  }
}

async function updateBundle(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const { name, description, default_price, category_id, image_url, items } = req.body;
    const supabase = getDb();

    // Verify ownership through stores (products have no company_id)
    const { data: stores } = await supabase
      .from('stores').select('id').eq('company_id', companyId);
    const storeIds = (stores || []).map((s: { id: string }) => s.id);
    if (storeIds.length === 0) { res.status(403).json({ error: 'Not authorized' }); return; }

    const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (default_price !== undefined) updateData.default_price = parseFloat(default_price);
    if (category_id !== undefined) updateData.category_id = category_id;
    if (image_url !== undefined) updateData.image_url = image_url;

    const { error: updateError } = await supabase
      .from('products')
      .update(updateData)
      .eq('id', id)
      .in('store_id', storeIds)
      .eq('product_type', 'bundle');

    if (updateError) throw updateError;

    if (items?.length) {
      await supabase.from('bundle_items').delete().eq('bundle_id', id);
      const bundleItems = (items as Array<{ product_id: string; quantity: number }>).map(item => ({
        bundle_id: id,
        product_id: item.product_id,
        quantity: item.quantity,
        company_id: companyId,
      }));
      const { error: itemsError } = await supabase.from('bundle_items').insert(bundleItems);
      if (itemsError) throw itemsError;
    }

    res.json({ message: 'Bundle updated successfully' });
  } catch (error) {
    const err = error as Error;
    console.error('❌ Update bundle error:', err);
    res.status(500).json({ error: 'Failed to update bundle' });
  }
}

async function deleteBundle(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const supabase = getDb();

    // Verify ownership through stores (products have no company_id)
    const { data: stores } = await supabase
      .from('stores').select('id').eq('company_id', companyId);
    const storeIds = (stores || []).map((s: { id: string }) => s.id);
    if (storeIds.length === 0) { res.status(403).json({ error: 'Not authorized' }); return; }

    const { error } = await supabase
      .from('products')
      .update({ is_active: false })
      .eq('id', id)
      .in('store_id', storeIds)
      .eq('product_type', 'bundle');

    if (error) throw error;

    res.json({ message: 'Bundle deleted successfully' });
  } catch (error) {
    const err = error as Error;
    console.error('❌ Delete bundle error:', err);
    res.status(500).json({ error: 'Failed to delete bundle' });
  }
}

export { getBundles, createBundle, updateBundle, deleteBundle };
