import { SupabaseClient } from '@supabase/supabase-js';

// Create a new stock batch (called when product is created or restocked)
export async function createBatch(
  supabase: SupabaseClient,
  params: {
    product_id: string;
    store_id: string;
    cost_price: number;
    selling_price?: number;
    qty: number;
    note?: string;
    created_by?: string | null;
  }
): Promise<void> {
  if (params.qty <= 0 || params.cost_price < 0) return;

  const { error } = await supabase
    .from('product_batches')
    .insert({
      product_id: params.product_id,
      store_id: params.store_id,
      cost_price: params.cost_price,
      selling_price: params.selling_price ?? null,
      qty_received: params.qty,
      qty_remaining: params.qty,
      note: params.note || null,
      created_by: params.created_by || null
    });

  if (error) {
    console.error('❌ Failed to create batch:', error);
    throw error;
  }

  console.log(`✅ Batch created: ${params.qty} units @ ₱${params.cost_price} for product ${params.product_id}`);
}

// Deplete batches FIFO for a sale item — returns weighted average cost
export async function depleteBatchesFIFO(
  supabase: SupabaseClient,
  params: {
    product_id: string;
    store_id: string;
    qty_sold: number;
  }
): Promise<number> {
  // Get batches with remaining stock, oldest first (FIFO)
  const { data: batches, error } = await supabase
    .from('product_batches')
    .select('id, cost_price, qty_remaining')
    .eq('product_id', params.product_id)
    .eq('store_id', params.store_id)
    .gt('qty_remaining', 0)
    .order('received_at', { ascending: true });

  if (error || !batches || batches.length === 0) {
    // No batches found — fall back to product current cost_price
    const { data: product } = await supabase
      .from('products')
      .select('cost_price')
      .eq('id', params.product_id)
      .single();
    return product?.cost_price || 0;
  }

  let qtyLeft = params.qty_sold;
  let totalCost = 0;

  for (const batch of batches) {
    if (qtyLeft <= 0) break;

    const take = Math.min(qtyLeft, batch.qty_remaining);
    totalCost += take * batch.cost_price;
    qtyLeft -= take;

    const newRemaining = batch.qty_remaining - take;

    await supabase
      .from('product_batches')
      .update({ qty_remaining: newRemaining })
      .eq('id', batch.id);
  }

  // If still qty left (more sold than batched — edge case), use last known cost
  if (qtyLeft > 0) {
    const lastBatch = batches[batches.length - 1];
    totalCost += qtyLeft * (lastBatch?.cost_price || 0);
  }

  const weightedAvgCost = totalCost / params.qty_sold;
  console.log(`🔍 FIFO cost for ${params.qty_sold} units of product ${params.product_id}: ₱${weightedAvgCost.toFixed(2)}`);
  return weightedAvgCost;
}

// Get batch history for a product
export async function getBatchHistory(
  supabase: SupabaseClient,
  product_id: string,
  store_id: string
) {
  const { data, error } = await supabase
    .from('product_batches')
    .select('*')
    .eq('product_id', product_id)
    .eq('store_id', store_id)
    .order('received_at', { ascending: true });

  if (error) throw error;
  return data || [];
}
