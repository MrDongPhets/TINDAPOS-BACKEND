import { Request, Response } from 'express';
import { getDb } from '../../config/database';
import { depleteBatchesFIFO } from '../../services/fifoService';

// Create sale transaction
async function createSale(req: Request, res: Response): Promise<void> {
  try {
    const {
      store_id,
      items,
      payment_method,
      subtotal,
      discount_amount,
      discount_type,
      total_amount,
      customer_name,
      customer_phone,
      customer_id,
      notes
    } = req.body;

    const companyId = req.user!.company_id;
    const userId = req.user!.id;
    const isStaff = req.user!.userType === 'staff';
    const supabase = getDb();

    console.log('💳 Creating sale:', {
      store_id,
      items: items?.length,
      total_amount,
      companyId,
      userId
    });

    // Validate required fields
    if (!store_id || !items || items.length === 0 || !total_amount) {
      console.error('❌ Missing required fields:', { store_id, items: items?.length, total_amount });
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Generate receipt number (internal reference)
    const receipt_number = `RCP-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;

    // Generate OR number (sequential, BIR-compliant)
    const { data: storeData } = await supabase
      .from('stores')
      .select('or_counter, or_prefix, grand_total_accumulator')
      .eq('id', store_id)
      .single();

    const newCounter = (storeData?.or_counter || 0) + 1;
    const orPrefix = storeData?.or_prefix || 'OR';
    const or_number = `${orPrefix}-${String(newCounter).padStart(8, '0')}`;

    // Fetch vat_type per product for VAT computation
    const productIds = (items as Array<{ product_id: string }>).map(i => i.product_id);
    const { data: productVatData } = await supabase
      .from('products')
      .select('id, vat_type')
      .in('id', productIds);

    const vatTypeMap = new Map((productVatData || []).map((p: { id: string; vat_type: string }) => [p.id, p.vat_type || 'vatable']));

    // Compute VAT breakdown (VAT-inclusive: price already includes 12% VAT)
    let vatableAmount = 0;
    let vatExemptAmount = 0;
    let zeroRatedAmount = 0;

    for (const item of items as Array<{ product_id: string; quantity: number; price: number; discount_amount?: number }>) {
      const itemTotal = (item.price * item.quantity) - (item.discount_amount || 0);
      const vatType = vatTypeMap.get(item.product_id) || 'vatable';
      if (vatType === 'vat_exempt') vatExemptAmount += itemTotal;
      else if (vatType === 'zero_rated') zeroRatedAmount += itemTotal;
      else vatableAmount += itemTotal;
    }

    // VAT = vatable * 12/112 (VAT-inclusive computation)
    const vatAmount = parseFloat((vatableAmount * 12 / 112).toFixed(2));

    console.log('📝 Creating sale record...');

    // Start transaction - Create sale
    const { data: sale, error: saleError } = await supabase
      .from('sales')
      .insert({
        company_id: companyId,
        store_id,
        staff_id: isStaff ? userId : null,
        total_amount,
        subtotal: subtotal || total_amount,
        discount_amount: discount_amount || 0,
        discount_type: discount_type || null,
        tax_amount: vatAmount,
        payment_method: payment_method || 'cash',
        customer_name: customer_name || null,
        customer_phone: customer_phone || null,
        receipt_number,
        or_number,
        vatable_amount: parseFloat(vatableAmount.toFixed(2)),
        vat_exempt_amount: parseFloat(vatExemptAmount.toFixed(2)),
        zero_rated_amount: parseFloat(zeroRatedAmount.toFixed(2)),
        items_count: (items as Array<{ quantity: number }>).reduce((sum, item) => sum + item.quantity, 0),
        notes: notes || null,
        created_by: isStaff ? null : userId
      })
      .select()
      .single();

    if (saleError) {
      console.error('❌ Sale creation error:', saleError);
      throw saleError;
    }

    console.log('✅ Sale created:', sale.id);
    console.log('📦 Computing FIFO costs and inserting sale items...');

    // Compute FIFO weighted average cost per item (also depletes batch qty_remaining)
    type SaleItem = { product_id: string; quantity: number; price: number; discount_amount?: number; discount_percent?: number; barcode?: string };
    const typedItems = items as SaleItem[];

    const costMap = new Map<string, number>();
    await Promise.all(
      typedItems.map(async (item) => {
        const cost = await depleteBatchesFIFO(supabase, {
          product_id: item.product_id,
          store_id,
          qty_sold: item.quantity
        });
        costMap.set(item.product_id, cost);
      })
    );

    // Insert sales items with FIFO cost_price
    const salesItems = typedItems.map((item) => ({
      sales_id: sale.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.price,
      discount_amount: item.discount_amount || 0,
      discount_percent: item.discount_percent || 0,
      total_price: (item.price * item.quantity) - (item.discount_amount || 0),
      barcode: item.barcode || null,
      cost_price: costMap.get(item.product_id) || 0
    }));

    const { error: itemsError } = await supabase
      .from('sales_items')
      .insert(salesItems);

    if (itemsError) {
      console.error('❌ Sales items error:', itemsError);
      throw itemsError;
    }

    console.log('✅ Sales items inserted');
    console.log('📊 Updating inventory...');

    // Update inventory for each item
    for (const item of items as Array<{ product_id: string; quantity: number }>) {
      // Get current stock
      const { data: product, error: productError } = await supabase
        .from('products')
        .select('stock_quantity')
        .eq('id', item.product_id)
        .single();

      if (productError) {
        console.error('❌ Product fetch error:', productError);
        throw productError;
      }

      const previous_stock = product.stock_quantity;
      const new_stock = previous_stock - item.quantity;

      console.log(`📦 Updating product ${item.product_id}: ${previous_stock} -> ${new_stock}`);

      // Update product stock
      const { error: updateError } = await supabase
        .from('products')
        .update({ stock_quantity: new_stock })
        .eq('id', item.product_id);

      if (updateError) {
        console.error('❌ Product update error:', updateError);
        throw updateError;
      }

      // Record inventory movement
      const { error: movementError } = await supabase
        .from('inventory_movements')
        .insert({
          product_id: item.product_id,
          store_id,
          movement_type: 'out',
          quantity: item.quantity,
          previous_stock,
          new_stock,
          reference_type: 'sale',
          reference_id: sale.id,
          notes: `Sale ${receipt_number}`,
          created_by: isStaff ? null : userId
        });

      if (movementError) {
        console.error('❌ Inventory movement error:', movementError);
        // Don't throw here, inventory movement is not critical
      }
    }

    // If payment method is credit, record a charge in credit_ledger
    if (payment_method === 'credit' && customer_id) {
      const { error: ledgerError } = await supabase
        .from('credit_ledger')
        .insert({
          company_id: companyId,
          customer_id,
          sale_id: sale.id,
          type: 'charge',
          amount: total_amount,
          notes: `Sale ${receipt_number}`,
          created_by: isStaff ? null : userId
        });

      if (ledgerError) {
        console.error('❌ Credit ledger error (non-critical):', ledgerError);
      } else {
        console.log('✅ Credit charge recorded for customer:', customer_id);
      }
    }

    // Update store OR counter and grand total accumulator
    const newGrandTotal = parseFloat(String(storeData?.grand_total_accumulator || 0)) + parseFloat(String(total_amount));
    await supabase
      .from('stores')
      .update({ or_counter: newCounter, grand_total_accumulator: newGrandTotal })
      .eq('id', store_id);

    console.log('✅ Sale completed:', or_number);

    res.status(201).json({
      sale: { ...sale, or_number, vatable_amount: vatableAmount, vat_exempt_amount: vatExemptAmount, zero_rated_amount: zeroRatedAmount, tax_amount: vatAmount },
      receipt_number,
      or_number,
      message: 'Sale completed successfully'
    });

  } catch (error) {
    const err = error as Error & { code?: string };
    console.error('💥 Create sale error:', err);
    res.status(500).json({
      error: 'Failed to create sale',
      details: err.message,
      code: err.code
    });
  }
}

// Get sale by receipt number
async function getSaleByReceipt(req: Request, res: Response): Promise<void> {
  try {
    const { receipt_number } = req.params;
    const companyId = req.user!.company_id;
    const supabase = getDb();

    const { data: sale, error } = await supabase
      .from('sales')
      .select(`
        *,
        sales_items(
          *,
          products(name, sku, image_url)
        )
      `)
      .eq('company_id', companyId)
      .eq('receipt_number', receipt_number)
      .single();

    if (error || !sale) {
      res.status(404).json({ error: 'Sale not found' });
      return;
    }

    res.json({ sale });
  } catch (error) {
    console.error('Get sale error:', error);
    res.status(500).json({ error: 'Failed to fetch sale' });
  }
}

// Get today's sales
async function getTodaySales(req: Request, res: Response): Promise<void> {
  try {
    const { store_id } = req.query;
    const companyId = req.user!.company_id;
    const supabase = getDb();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const { data: sales, error } = await supabase
      .from('sales')
      .select('*')
      .eq('company_id', companyId)
      .eq('store_id', store_id)
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: false });

    if (error) throw error;

    const total = sales?.reduce((sum: number, sale: { total_amount: string | number }) => sum + parseFloat(String(sale.total_amount)), 0) || 0;

    res.json({
      sales: sales || [],
      count: sales?.length || 0,
      total
    });
  } catch (error) {
    console.error('Get today sales error:', error);
    res.status(500).json({ error: 'Failed to fetch sales' });
  }
}

// Get Z-Reading data for a store (today's summary)
async function getZReading(req: Request, res: Response): Promise<void> {
  try {
    const { store_id } = req.query;
    const companyId = req.user!.company_id;
    const supabase = getDb();

    if (!store_id) {
      res.status(400).json({ error: 'store_id is required' });
      return;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    // Get today's sales
    const { data: sales, error } = await supabase
      .from('sales')
      .select('total_amount, tax_amount, vatable_amount, vat_exempt_amount, zero_rated_amount, or_number, payment_method')
      .eq('company_id', companyId)
      .eq('store_id', store_id)
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Get store grand total accumulator
    const { data: store } = await supabase
      .from('stores')
      .select('grand_total_accumulator, or_counter, or_prefix, name, address, phone')
      .eq('id', store_id)
      .single();

    // Get company TIN
    const { data: company } = await supabase
      .from('companies')
      .select('name, tax_id, address')
      .eq('id', companyId)
      .single();

    type SaleRow = { total_amount: string | number; tax_amount: string | number; vatable_amount: string | number; vat_exempt_amount: string | number; zero_rated_amount: string | number; or_number: string; payment_method: string };
    const typedSales = (sales || []) as SaleRow[];

    const summary = typedSales.reduce((acc, s) => ({
      total_sales: acc.total_sales + parseFloat(String(s.total_amount || 0)),
      vat_amount: acc.vat_amount + parseFloat(String(s.tax_amount || 0)),
      vatable_sales: acc.vatable_sales + parseFloat(String(s.vatable_amount || 0)),
      vat_exempt_sales: acc.vat_exempt_sales + parseFloat(String(s.vat_exempt_amount || 0)),
      zero_rated_sales: acc.zero_rated_sales + parseFloat(String(s.zero_rated_amount || 0)),
    }), { total_sales: 0, vat_amount: 0, vatable_sales: 0, vat_exempt_sales: 0, zero_rated_sales: 0 });

    const paymentBreakdown = typedSales.reduce((acc, s) => {
      const method = s.payment_method || 'cash';
      acc[method] = (acc[method] || 0) + parseFloat(String(s.total_amount || 0));
      return acc;
    }, {} as Record<string, number>);

    const orNumbers = typedSales.map(s => s.or_number).filter(Boolean);

    res.json({
      date: todayStr,
      store,
      company,
      transaction_count: typedSales.length,
      or_from: orNumbers[0] || null,
      or_to: orNumbers[orNumbers.length - 1] || null,
      ...summary,
      payment_breakdown: paymentBreakdown,
      grand_total_accumulator: parseFloat(String(store?.grand_total_accumulator || 0)),
    });

  } catch (error) {
    console.error('Get Z-Reading error:', error);
    res.status(500).json({ error: 'Failed to fetch Z-reading data' });
  }
}

// Save Z-Reading (end of day close)
async function createZReading(req: Request, res: Response): Promise<void> {
  try {
    const { store_id } = req.body;
    const companyId = req.user!.company_id;
    const userId = req.user!.id;
    const supabase = getDb();

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split('T')[0];

    const { data: sales } = await supabase
      .from('sales')
      .select('total_amount, tax_amount, vatable_amount, vat_exempt_amount, zero_rated_amount, or_number')
      .eq('company_id', companyId)
      .eq('store_id', store_id)
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: true });

    const { data: store } = await supabase
      .from('stores')
      .select('grand_total_accumulator')
      .eq('id', store_id)
      .single();

    type SaleRow = { total_amount: string | number; tax_amount: string | number; vatable_amount: string | number; vat_exempt_amount: string | number; zero_rated_amount: string | number; or_number: string };
    const typedSales = (sales || []) as SaleRow[];

    const summary = typedSales.reduce((acc, s) => ({
      total_sales: acc.total_sales + parseFloat(String(s.total_amount || 0)),
      vat_amount: acc.vat_amount + parseFloat(String(s.tax_amount || 0)),
      vatable_sales: acc.vatable_sales + parseFloat(String(s.vatable_amount || 0)),
      vat_exempt_sales: acc.vat_exempt_sales + parseFloat(String(s.vat_exempt_amount || 0)),
      zero_rated_sales: acc.zero_rated_sales + parseFloat(String(s.zero_rated_amount || 0)),
    }), { total_sales: 0, vat_amount: 0, vatable_sales: 0, vat_exempt_sales: 0, zero_rated_sales: 0 });

    const orNumbers = typedSales.map(s => s.or_number).filter(Boolean);

    const { data: zReading, error } = await supabase
      .from('z_readings')
      .upsert({
        store_id,
        company_id: companyId,
        reading_date: todayStr,
        transaction_count: typedSales.length,
        vatable_sales: parseFloat(summary.vatable_sales.toFixed(2)),
        vat_exempt_sales: parseFloat(summary.vat_exempt_sales.toFixed(2)),
        zero_rated_sales: parseFloat(summary.zero_rated_sales.toFixed(2)),
        vat_amount: parseFloat(summary.vat_amount.toFixed(2)),
        total_sales: parseFloat(summary.total_sales.toFixed(2)),
        grand_total_accumulator: parseFloat(String(store?.grand_total_accumulator || 0)),
        or_from: orNumbers[0] || null,
        or_to: orNumbers[orNumbers.length - 1] || null,
        closed_at: new Date().toISOString(),
        created_by: userId,
      }, { onConflict: 'store_id,reading_date' })
      .select()
      .single();

    if (error) throw error;

    console.log('✅ Z-Reading saved for:', todayStr);
    res.status(201).json({ zReading, message: 'Z-Reading saved successfully' });

  } catch (error) {
    console.error('Create Z-Reading error:', error);
    res.status(500).json({ error: 'Failed to save Z-reading' });
  }
}

// Get Z-Reading history for a store
async function getZReadingHistory(req: Request, res: Response): Promise<void> {
  try {
    const { store_id, limit = '30' } = req.query;
    const companyId = req.user!.company_id;
    const supabase = getDb();

    if (!store_id) {
      res.status(400).json({ error: 'store_id is required' });
      return;
    }

    const { data, error } = await supabase
      .from('z_readings')
      .select('*')
      .eq('store_id', store_id)
      .eq('company_id', companyId)
      .order('reading_date', { ascending: false })
      .limit(parseInt(String(limit)));

    if (error) throw error;

    res.json({ z_readings: data || [] });
  } catch (error) {
    console.error('Get Z-Reading history error:', error);
    res.status(500).json({ error: 'Failed to fetch Z-reading history' });
  }
}

export {
  createSale,
  getSaleByReceipt,
  getTodaySales,
  getZReading,
  createZReading,
  getZReadingHistory
};
