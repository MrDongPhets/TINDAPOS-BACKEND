import { Request, Response } from 'express';
import { getDb } from '../../config/database';
import { depleteBatchesFIFO } from '../../services/fifoService';
import { reserveOrNumber, addToGrandTotal } from '../../services/receiptCounterService';
import { getInvoiceSeller } from '../../services/invoiceSellerService';
import { issueSaleEinvoice } from '../../services/eis/eisIssuer';
import { computeSaleVat, normalizeVatStatus, type ProductVatType } from '../../services/vatService';

// SC/PWD beneficiary: same ID characters TaxTrail accepts (letters, digits, dashes, slashes, spaces)
const BENEFICIARY_ID = /^[A-Za-z0-9-/ ]{3,50}$/;
export function specialDiscountBeneficiary(discountType: unknown, name: unknown, idNumber: unknown): { required: boolean; value: { name: string; idNumber: string } | null; error?: string } {
  const required = discountType === 'senior_citizen' || discountType === 'pwd';
  if (!required) return { required, value: null };
  const n = typeof name === 'string' ? name.trim() : '';
  const id = typeof idNumber === 'string' ? idNumber.trim() : '';
  if (!n && !id) return { required, value: null };
  if (n.length < 2 || n.length > 200) return { required, value: null, error: 'Enter the name as printed on the senior citizen / PWD ID' };
  if (!BENEFICIARY_ID.test(id)) return { required, value: null, error: 'Enter the senior citizen / PWD ID number as printed on the card' };
  return { required, value: { name: n, idNumber: id } };
}

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
      notes,
      sc_pwd_name,
      sc_pwd_id_no
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
    const receipt_number = `RCP-${Date.now()}-${Math.random().toString(36).slice(2, 11).toUpperCase()}`;

    // Product VAT types + the company's BIR VAT status (non-VAT stores record no VAT)
    const productIds = (items as Array<{ product_id: string }>).map(i => i.product_id);
    const [{ data: productVatData }, { data: companyVat }, { data: storeRows }] = await Promise.all([
      supabase.from('products').select('id, vat_type').in('id', productIds),
      supabase.from('companies').select('vat_status').eq('id', companyId).limit(1),
      supabase.from('stores').select('invoicing_mode').eq('id', store_id).eq('company_id', companyId).limit(1),
    ]);

    // Senior citizen / PWD beneficiary (printed on the invoice; required to issue an e-invoice through TaxTrail)
    const beneficiary = specialDiscountBeneficiary(discount_type, sc_pwd_name, sc_pwd_id_no);
    if (beneficiary.error) {
      res.status(400).json({ error: beneficiary.error, code: 'SC_PWD_DETAILS_INVALID' });
      return;
    }
    if (beneficiary.required && storeRows?.[0]?.invoicing_mode === 'eis' && !beneficiary.value) {
      res.status(400).json({ error: 'Senior citizen / PWD sale: enter the name and ID number (needed for the e-invoice)', code: 'SC_PWD_DETAILS_REQUIRED' });
      return;
    }
    const vatStatus = normalizeVatStatus(companyVat?.[0]?.vat_status);
    const vatTypeMap = new Map((productVatData || []).map((p: { id: string; vat_type: string }) => [p.id, p.vat_type || 'vatable']));

    const saleVat = computeSaleVat({
      items: (items as Array<{ product_id: string; quantity: number; price: number; discount_amount?: number }>).map(item => ({
        total: (item.price * item.quantity) - (item.discount_amount || 0),
        vatType: (vatTypeMap.get(item.product_id) || 'vatable') as ProductVatType,
      })),
      discountType: discount_type,
      totalAmount: parseFloat(String(total_amount)),
      vatStatus,
    });
    const vatableAmount = saleVat.vatable_amount;
    const vatExemptAmount = saleVat.vat_exempt_amount;
    const zeroRatedAmount = saleVat.zero_rated_amount;
    const vatAmount = saleVat.tax_amount;

    // Reserve the OR number atomically (BIR: unique + sequential per store), right before the insert
    const or_number = await reserveOrNumber(supabase, store_id);

    console.log('📝 Creating sale record...', or_number);

    // Start transaction - Create sale
    const saleRow: Record<string, unknown> = {
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
        created_by: isStaff ? null : userId,
        ...(beneficiary.value ? { sc_pwd_name: beneficiary.value.name, sc_pwd_id_no: beneficiary.value.idNumber } : {})
    };
    let { data: sale, error: saleError } = await supabase.from('sales').insert(saleRow).select().single();
    // sales_special_discount.sql not run yet → save the sale without the beneficiary rather than fail the checkout
    if (saleError && beneficiary.value && /sc_pwd_/.test(String((saleError as { message?: string }).message))) {
      console.warn('⚠️ sales.sc_pwd_* columns missing — run sales_special_discount.sql. Saving the sale without the beneficiary.');
      const { sc_pwd_name: _n, sc_pwd_id_no: _i, ...withoutBeneficiary } = saleRow;
      ({ data: sale, error: saleError } = await supabase.from('sales').insert(withoutBeneficiary).select().single());
    }

    if (saleError) {
      // The reserved OR number is now unused — log it so the gap in the sequence is traceable
      console.error(`❌ Sale creation error — OR ${or_number} reserved but not used:`, saleError);
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

    // Expand bundle items into their components for stock deduction
    const { data: productTypes } = await supabase
      .from('products')
      .select('id, product_type')
      .in('id', productIds);

    const bundleIds = (productTypes || [])
      .filter((p: { id: string; product_type: string }) => p.product_type === 'bundle')
      .map((p: { id: string }) => p.id);

    // Build effective inventory items: simple products keep as-is, bundles expand to components
    type InventoryItem = { product_id: string; quantity: number };
    const inventoryItems: InventoryItem[] = (items as InventoryItem[]).filter(i => !bundleIds.includes(i.product_id));

    if (bundleIds.length > 0) {
      const { data: bundleItemsData } = await supabase
        .from('bundle_items')
        .select('bundle_id, product_id, quantity')
        .in('bundle_id', bundleIds);

      for (const bundleId of bundleIds) {
        const soldQty = (items as InventoryItem[]).find(i => i.product_id === bundleId)?.quantity ?? 0;
        const components = (bundleItemsData || []).filter((bi: any) => bi.bundle_id === bundleId);
        for (const comp of components as Array<{ product_id: string; quantity: number }>) {
          const needed = comp.quantity * soldQty;
          const existing = inventoryItems.find(i => i.product_id === comp.product_id);
          if (existing) existing.quantity += needed;
          else inventoryItems.push({ product_id: comp.product_id, quantity: needed });
        }
      }
    }

    const inventoryProductIds = inventoryItems.map(i => i.product_id);

    // Fetch all current stock levels in one query
    const { data: productStocks, error: stockFetchError } = await supabase
      .from('products')
      .select('id, stock_quantity')
      .in('id', inventoryProductIds);

    if (stockFetchError) throw stockFetchError;

    const stockMap = new Map<string, number>(
      (productStocks || []).map((p: { id: string; stock_quantity: number }) => [p.id, p.stock_quantity] as [string, number])
    );

    // Update all product stocks in parallel + collect movement records
    const movementRecords: object[] = [];

    await Promise.all(
      inventoryItems.map(async (item) => {
        const previous_stock = stockMap.get(item.product_id) ?? 0;
        const new_stock = previous_stock - item.quantity;

        const { error: updateError } = await supabase
          .from('products')
          .update({ stock_quantity: new_stock })
          .eq('id', item.product_id);

        if (updateError) throw updateError;

        movementRecords.push({
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
      })
    );

    // Bulk insert all inventory movements in one call
    const { error: movementError } = await supabase
      .from('inventory_movements')
      .insert(movementRecords);

    if (movementError) {
      console.error('❌ Inventory movement error (non-critical):', movementError);
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

    // Add to store's non-resettable grand total accumulator (atomic)
    try {
      await addToGrandTotal(supabase, store_id, parseFloat(String(total_amount)));
    } catch (accumulatorError) {
      // Sale is already saved — don't fail the checkout, but this must be investigated (BIR figure)
      console.error(`❌ Grand total accumulator update failed for ${or_number}:`, accumulatorError);
    }

    console.log('✅ Sale completed:', or_number);

    // BIR seller details for the invoice (null → the app falls back to cached company/store data)
    const seller = await getInvoiceSeller(supabase, companyId as string, store_id);

    // E-invoice store: TaxTrail issues the invoice now (short wait); if it can't, it stays pending and the
    // retry worker issues it later. Never fails the checkout — the sale is already saved.
    const einvoice = storeRows?.[0]?.invoicing_mode === 'eis' ? await issueSaleEinvoice(sale.id) : null;

    res.status(201).json({
      sale: { ...sale, or_number, vatable_amount: vatableAmount, vat_exempt_amount: vatExemptAmount, zero_rated_amount: zeroRatedAmount, tax_amount: vatAmount },
      seller,
      einvoice,
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

// Get X-Reading data (current shift running total — read-only, no save)
async function getXReading(req: Request, res: Response): Promise<void> {
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

    const { data: sales, error } = await supabase
      .from('sales')
      .select('total_amount, tax_amount, vatable_amount, vat_exempt_amount, zero_rated_amount, or_number, payment_method, created_at')
      .eq('company_id', companyId)
      .eq('store_id', store_id)
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: true });

    if (error) throw error;

    const { data: store } = await supabase
      .from('stores')
      .select('grand_total_accumulator, or_counter, or_prefix, name, address, phone')
      .eq('id', store_id)
      .single();

    const { data: company } = await supabase
      .from('companies')
      .select('name, tax_id, address')
      .eq('id', companyId)
      .single();

    type SaleRow = { total_amount: string | number; tax_amount: string | number; vatable_amount: string | number; vat_exempt_amount: string | number; zero_rated_amount: string | number; or_number: string; payment_method: string; created_at: string };
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
    const shiftStart = typedSales.length > 0 ? typedSales[0].created_at : null;

    res.json({
      date: todayStr,
      as_of: new Date().toISOString(),
      shift_start: shiftStart,
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
    console.error('Get X-Reading error:', error);
    res.status(500).json({ error: 'Failed to fetch X-reading data' });
  }
}

export {
  createSale,
  getSaleByReceipt,
  getTodaySales,
  getZReading,
  createZReading,
  getZReadingHistory,
  getXReading
};
