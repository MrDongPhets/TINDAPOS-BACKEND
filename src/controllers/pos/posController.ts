import { Request, Response } from 'express';
import { getDb } from '../../config/database';

// Search products (with barcode support)
async function searchProducts(req: Request, res: Response): Promise<void> {
  try {
    const { query, store_id } = req.query;
    const supabase = getDb();

    const { data: products, error } = await supabase
      .from('products')
      .select(`
        *,
        categories(id, name, color, icon)
      `)
      .eq('store_id', store_id)
      .eq('is_active', true)
      .or(`name.ilike.%${query}%,sku.ilike.%${query}%,barcode.eq.${query}`)
      .gt('stock_quantity', 0)
      .limit(20);

    if (error) throw error;

    res.json({ products: products || [] });
  } catch (error) {
    console.error('Search products error:', error);
    res.status(500).json({ error: 'Failed to search products' });
  }
}

// Get products by category
async function getProductsByCategory(req: Request, res: Response): Promise<void> {
  try {
    const { category_id, store_id } = req.query;
    const supabase = getDb();

    let query = supabase
      .from('products')
      .select('*, categories(id, name, color, icon)')
      .eq('store_id', store_id)
      .eq('is_active', true);

    if (category_id && category_id !== 'all') {
      query = query.eq('category_id', category_id);
    }

    const { data: allProducts, error } = await query.order('name');
    if (error) throw error;

    const all = allProducts || [];
    const simpleProducts = all.filter((p: any) => p.product_type !== 'bundle' && p.stock_quantity > 0);
    const bundleProducts = all.filter((p: any) => p.product_type === 'bundle');

    if (bundleProducts.length === 0) {
      res.json({ products: simpleProducts });
      return;
    }

    // Compute effective bundle stock from components
    const bundleIds = bundleProducts.map((b: any) => b.id);
    const { data: bundleItems } = await supabase
      .from('bundle_items')
      .select('bundle_id, quantity, component:product_id(stock_quantity)')
      .in('bundle_id', bundleIds);

    const effectiveStockMap = new Map<string, number>();
    for (const bundle of bundleProducts) {
      const items = (bundleItems || []).filter((bi: any) => bi.bundle_id === bundle.id);
      const stock = items.length === 0 ? 0 : Math.min(
        ...items.map((i: any) => Math.floor(((i.component as any)?.stock_quantity ?? 0) / i.quantity))
      );
      effectiveStockMap.set(bundle.id, stock);
    }

    const bundlesWithStock = bundleProducts
      .map((b: any) => ({ ...b, stock_quantity: effectiveStockMap.get(b.id) ?? 0 }))
      .filter((b: any) => b.stock_quantity > 0);

    res.json({ products: [...simpleProducts, ...bundlesWithStock] });
  } catch (error) {
    console.error('Get products by category error:', error);
    res.status(500).json({ error: 'Failed to fetch products' });
  }
}

// Calculate pricing with discounts
async function calculatePrice(req: Request, res: Response): Promise<void> {
  try {
    const { items, discount_type, discount_value } = req.body;

    let subtotal = (items as Array<{ price: number; quantity: number }>).reduce((sum, item) => sum + (item.price * item.quantity), 0);
    let discount_amount = 0;

    if (discount_type === 'percentage') {
      discount_amount = (subtotal * discount_value) / 100;
    } else if (discount_type === 'fixed') {
      discount_amount = discount_value;
    }

    const total = subtotal - discount_amount;

    res.json({
      subtotal,
      discount_amount,
      total,
      items_count: (items as Array<{ quantity: number }>).reduce((sum, item) => sum + item.quantity, 0)
    });
  } catch (error) {
    console.error('Calculate price error:', error);
    res.status(500).json({ error: 'Failed to calculate price' });
  }
}

async function checkProductAvailability(req: Request, res: Response): Promise<void> {
  try {
    const { product_id, quantity } = req.query;
    const supabase = getDb();

    const { data: product } = await supabase
      .from('products')
      .select('id, name, is_composite, stock_quantity')
      .eq('id', product_id)
      .single();

    if (!product) {
      res.status(404).json({ error: 'Product not found' });
      return;
    }

    // Simple product - check stock
    if (!product.is_composite) {
      const available = product.stock_quantity >= parseInt(quantity as string);
      res.json({
        available,
        type: 'simple',
        stock: product.stock_quantity
      });
      return;
    }

    // Composite product - check ingredients
    const { data: recipe } = await supabase
      .from('product_recipes')
      .select(`
        *,
        ingredients(id, name, stock_quantity, unit)
      `)
      .eq('product_id', product_id);

    if (!recipe || recipe.length === 0) {
      res.json({
        available: false,
        type: 'composite',
        message: 'No recipe defined'
      });
      return;
    }

    const qty = parseInt(quantity as string);
    const insufficient: { name: string; needed: number; available: number; unit: string }[] = [];

    for (const item of recipe as Array<{ quantity_needed: number; unit: string; ingredients?: { name: string; stock_quantity: number } }>) {
      const needed = item.quantity_needed * qty;
      const available = item.ingredients?.stock_quantity || 0;

      if (available < needed) {
        insufficient.push({
          name: item.ingredients?.name || 'Unknown',
          needed,
          available,
          unit: item.unit
        });
      }
    }

    res.json({
      available: insufficient.length === 0,
      type: 'composite',
      insufficient_ingredients: insufficient
    });

  } catch (error) {
    console.error('Check availability error:', error);
    res.status(500).json({ error: 'Failed to check availability' });
  }
}

export {
  searchProducts,
  getProductsByCategory,
  calculatePrice,
  checkProductAvailability
};
