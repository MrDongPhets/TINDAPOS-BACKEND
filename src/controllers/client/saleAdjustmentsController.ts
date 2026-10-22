// src/controllers/client/saleAdjustmentsController.ts
// POST /client/sales/:id/adjustments  { kind: 'void' | 'return', reason, correction_code?, items?: [{ sales_item_id, quantity }] }
// POST /client/sales/:id/void         { reason }   (same as kind 'void')
// Owner only (client routes). Invoicing plan P0-6 — see services/saleAdjustmentService.ts for the rules.
import { Request, Response } from 'express';
import { getDb } from '../../config/database';
import { createBatch } from '../../services/fifoService';
import { getAdjustmentEinvoices, queueAdjustmentCorrection } from '../../services/eis/eisIssuer';
import { mapAdjustmentToTaxTrail } from '../../services/eis/taxtrailMapper';
import { normalizeVatStatus, type ProductVatType } from '../../services/vatService';
import {
  AdjustmentError, CORRECTION_CODES, formatAdjustmentNo, planAdjustment,
  type AdjustmentKind, type AdjustmentPlan, type CorrectionCode,
} from '../../services/saleAdjustmentService';

type Db = ReturnType<typeof getDb>;
const MISSING_FUNCTION = 'PGRST202';

async function reserveAdjustmentNo(db: Db, storeId: string): Promise<string> {
  if (process.env.DB_MODE !== 'sqlite') {
    const { data, error } = await db.rpc('reserve_adjustment_number', { p_store_id: storeId });
    if (!error) {
      const n = Array.isArray(data) ? data[0] : data;
      if (n == null) throw new Error(`Store ${storeId} not found`);
      return formatAdjustmentNo(Number(typeof n === 'object' ? Object.values(n)[0] : n));
    }
    if (error.code !== MISSING_FUNCTION) throw error;
    console.warn('⚠️ reserve_adjustment_number() missing — run sale_adjustments.sql. Using non-atomic fallback.');
  }
  const { data: store, error } = await db.from('stores').select('adj_counter').eq('id', storeId).single();
  if (error || !store) throw error || new Error(`Store ${storeId} not found`);
  const n = (store.adj_counter || 0) + 1;
  const { error: upErr } = await db.from('stores').update({ adj_counter: n }).eq('id', storeId);
  if (upErr) throw upErr;
  return formatAdjustmentNo(n);
}

// Stock back for the returned items (bundles → their components), logged as inventory movements
async function restock(db: Db, opts: { storeId: string; plan: AdjustmentPlan; adjustmentId: string; adjustmentNo: string; costs: Map<string, number>; userId: string | null }) {
  const productIds = [...new Set(opts.plan.lines.map((l) => l.product_id))];
  const { data: types } = await db.from('products').select('id, product_type').in('id', productIds);
  const bundleIds = new Set((types || []).filter((p: { product_type: string }) => p.product_type === 'bundle').map((p: { id: string }) => p.id));

  const back = new Map<string, number>();
  const add = (id: string, q: number) => back.set(id, (back.get(id) || 0) + q);
  for (const l of opts.plan.lines) if (!bundleIds.has(l.product_id)) add(l.product_id, l.quantity);
  if (bundleIds.size) {
    const { data: comps } = await db.from('bundle_items').select('bundle_id, product_id, quantity').in('bundle_id', [...bundleIds]);
    for (const l of opts.plan.lines.filter((x) => bundleIds.has(x.product_id))) {
      for (const c of (comps || []).filter((c: { bundle_id: string }) => c.bundle_id === l.product_id)) add(c.product_id, c.quantity * l.quantity);
    }
  }

  const { data: stocks, error } = await db.from('products').select('id, stock_quantity').in('id', [...back.keys()]);
  if (error) throw error;
  const movements: object[] = [];
  for (const [productId, qty] of back) {
    const previous = Number((stocks || []).find((p: { id: string }) => p.id === productId)?.stock_quantity ?? 0);
    const { error: upErr } = await db.from('products').update({ stock_quantity: previous + qty }).eq('id', productId);
    if (upErr) throw upErr;
    movements.push({
      product_id: productId, store_id: opts.storeId, movement_type: 'in', quantity: qty, previous_stock: previous, new_stock: previous + qty,
      reference_type: 'adjustment', reference_id: opts.adjustmentId, notes: `${opts.adjustmentNo} (void/return)`, created_by: opts.userId,
    });
    // FIFO: the goods come back at what they cost when sold
    const cost = opts.costs.get(productId);
    if (cost != null && cost >= 0) {
      try { await createBatch(db, { product_id: productId, store_id: opts.storeId, cost_price: cost, qty, note: `Returned — ${opts.adjustmentNo}`, created_by: opts.userId }); }
      catch (e) { console.error(`❌ Return batch for ${productId} failed (non-critical):`, e); }
    }
  }
  const { error: mvErr } = await db.from('inventory_movements').insert(movements);
  if (mvErr) console.error('❌ Adjustment inventory movement error (non-critical):', mvErr);
}

export async function createSaleAdjustment(req: Request, res: Response): Promise<void> {
  const saleId = String(req.params.id);
  const companyId = req.user!.company_id as string;
  const userId = (req.user!.id as string) || null;
  const db = getDb();
  const body = req.body || {};
  const kind: AdjustmentKind = req.path.endsWith('/void') ? 'void' : body.kind;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';

  try {
    if (kind !== 'void' && kind !== 'return') { res.status(400).json({ error: 'kind must be void or return', code: 'VALIDATION_ERROR' }); return; }
    if (reason.length < 3 || reason.length > 500) { res.status(400).json({ error: 'Give a reason (3–500 characters)', code: 'VALIDATION_ERROR' }); return; }
    const correctionCode: CorrectionCode = body.correction_code ?? (kind === 'void' ? '04' : '09');
    if (!CORRECTION_CODES.includes(correctionCode)) { res.status(400).json({ error: 'Unknown correction code', code: 'VALIDATION_ERROR' }); return; }

    const { data: sales, error: saleErr } = await db.from('sales').select('*').eq('id', saleId).eq('company_id', companyId).limit(1);
    if (saleErr) throw saleErr;
    const sale = sales?.[0];
    if (!sale) { res.status(404).json({ error: 'Sale not found', code: 'SALE_NOT_FOUND' }); return; }

    const [{ data: items, error: itemsErr }, { data: previous }, { data: companies }] = await Promise.all([
      db.from('sales_items').select('id, product_id, quantity, unit_price, total_price, cost_price').eq('sales_id', saleId),
      db.from('sale_adjustments').select('items').eq('original_sale_id', saleId),
      db.from('companies').select('vat_status').eq('id', companyId).limit(1),
    ]);
    if (itemsErr) throw itemsErr;
    const productIds = [...new Set((items || []).map((i: { product_id: string }) => i.product_id))];
    const { data: products } = await db.from('products').select('id, name, vat_type').in('id', productIds);
    type ProductInfo = { id: string; name: string; vat_type: string | null };
    const productMap = new Map<string, ProductInfo>(((products || []) as ProductInfo[]).map((p) => [p.id, p]));

    let plan: AdjustmentPlan;
    try {
      plan = planAdjustment({
        kind,
        sale,
        items: (items || []).map((i: { id: string; product_id: string; quantity: number; unit_price: number; total_price: number }) => ({
          ...i, name: productMap.get(i.product_id)?.name || 'Item', vat_type: (productMap.get(i.product_id)?.vat_type || 'vatable') as ProductVatType,
        })),
        previous: (previous || []).map((p: { items: unknown }) => ({ items: typeof p.items === 'string' ? JSON.parse(p.items) : p.items })) as never,
        requested: body.items,
        vatStatus: normalizeVatStatus(companies?.[0]?.vat_status),
      });
    } catch (e) {
      if (e instanceof AdjustmentError) { res.status(e.code === 'ALREADY_VOIDED' || e.code === 'ALREADY_RETURNED' ? 409 : 400).json({ error: e.message, code: e.code }); return; }
      throw e;
    }

    // Claim the sale first: only one adjustment can move it from this exact state (stops double returns)
    let claim = db.from('sales').update({ adjustment_status: plan.sale_status, refunded_amount: plan.refunded_after }).eq('id', saleId);
    claim = sale.adjustment_status == null ? claim.is('adjustment_status', null) : claim.eq('adjustment_status', sale.adjustment_status);
    claim = sale.refunded_amount == null ? claim.is('refunded_amount', null) : claim.eq('refunded_amount', sale.refunded_amount);
    const { data: claimed, error: claimErr } = await claim.select('id');
    if (claimErr) throw claimErr;
    if (!claimed?.length) { res.status(409).json({ error: 'This sale was changed by someone else just now. Open it again and retry.', code: 'SALE_CHANGED' }); return; }

    let adjustment;
    try {
      const adjustmentNo = await reserveAdjustmentNo(db, sale.store_id);
      const { data, error } = await db.from('sale_adjustments').insert({
        company_id: companyId, store_id: sale.store_id, original_sale_id: saleId, adjustment_no: adjustmentNo, kind, correction_code: correctionCode,
        total_amount: plan.total_amount, vatable_amount: plan.vatable_amount, vat_exempt_amount: plan.vat_exempt_amount,
        zero_rated_amount: plan.zero_rated_amount, tax_amount: plan.tax_amount, items: plan.lines, reason, created_by: userId,
      }).select().single();
      if (error) throw error;
      adjustment = data;
    } catch (e) {
      // Give the sale back its previous state so it can be retried
      await db.from('sales').update({ adjustment_status: sale.adjustment_status ?? null, refunded_amount: sale.refunded_amount ?? 0 }).eq('id', saleId);
      throw e;
    }

    // Side effects after the document exists — a failure here is logged, the adjustment stands
    const costs = new Map<string, number>(((items || []) as Array<{ product_id: string; cost_price: number | null }>).map((i) => [i.product_id, Number(i.cost_price ?? 0)]));
    try { await restock(db, { storeId: sale.store_id, plan, adjustmentId: adjustment.id, adjustmentNo: adjustment.adjustment_no, costs, userId }); }
    catch (e) { console.error(`❌ Restock for ${adjustment.adjustment_no} failed:`, e); }

    // Utang sale: the customer owes less
    if (sale.payment_method === 'credit') {
      const { data: charge } = await db.from('credit_ledger').select('customer_id').eq('sale_id', saleId).eq('type', 'charge').limit(1);
      if (charge?.[0]) {
        const { error: ledgerErr } = await db.from('credit_ledger').insert({
          company_id: companyId, customer_id: charge[0].customer_id, sale_id: saleId, type: 'payment', amount: plan.total_amount,
          notes: `${adjustment.adjustment_no} — ${kind === 'void' ? 'void' : 'return'} of ${sale.or_number || sale.receipt_number}`, created_by: userId,
        });
        if (ledgerErr) console.error('❌ Credit ledger reversal failed (non-critical):', ledgerErr);
      }
    }

    // E-invoiced sale: the void / return also goes to TaxTrail (cancellation or credit memo) — P2-7
    let einvoice = null;
    try {
      const vatStatus = normalizeVatStatus(companies?.[0]?.vat_status);
      const mapped = mapAdjustmentToTaxTrail({
        adjustment: {
          id: adjustment.id, adjustment_no: adjustment.adjustment_no, kind, reason,
          lines: plan.lines.map((l) => ({ name: l.name, quantity: l.quantity, amount: l.amount, vat_type: productMap.get(l.product_id)?.vat_type || 'vatable' })),
        },
        vatStatus,
        saleDiscountType: sale.discount_type,
      });
      einvoice = await queueAdjustmentCorrection({
        companyId, storeId: sale.store_id, saleId, adjustmentId: adjustment.id, body: mapped.body, idempotencyKey: mapped.idempotencyKey, total: mapped.total,
      });
    } catch (e) { console.error(`❌ E-invoice correction for ${adjustment.adjustment_no} not sent:`, e); }

    console.log(`✅ ${adjustment.adjustment_no}: ${kind} of ${sale.or_number} — ₱${plan.total_amount}`);
    res.status(201).json({ adjustment: { ...adjustment, einvoice }, sale: { id: saleId, adjustment_status: plan.sale_status, refunded_amount: plan.refunded_after } });
  } catch (error) {
    console.error('❌ Sale adjustment error:', error);
    res.status(500).json({ error: 'Failed to save the void / return', code: 'ADJUSTMENT_ERROR' });
  }
}

// Adjustments of one sale, oldest first (sale detail page)
export async function listSaleAdjustments(db: Db, saleId: string) {
  const { data, error } = await db.from('sale_adjustments').select('*').eq('original_sale_id', saleId).order('created_at', { ascending: true });
  if (error) return []; // table not created yet
  const einvoices = await getAdjustmentEinvoices((data || []).map((a: { id: string }) => a.id));
  return (data || []).map((a: { id: string; items: unknown }) => ({
    ...a, items: typeof a.items === 'string' ? JSON.parse(a.items) : a.items, einvoice: einvoices[a.id] || null,
  }));
}
