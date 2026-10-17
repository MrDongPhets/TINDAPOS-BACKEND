// src/services/receiptCounterService.ts
// BIR OR (Official Receipt) numbering + grand total accumulator per store.
// Supabase: atomic Postgres functions (see src/db/migrations/atomic_or_counter.sql).
// SQLite (desktop, single device) and Supabase-without-migration: read-then-write fallback.
import { SupabaseClient } from '@supabase/supabase-js';

type Db = SupabaseClient;

const MISSING_FUNCTION = 'PGRST202';

function formatOrNumber(prefix: string, counter: number): string {
  return `${prefix}-${String(counter).padStart(8, '0')}`;
}

// Reserve the next OR number for a store. Call right before inserting the sale.
async function reserveOrNumber(db: Db, storeId: string): Promise<string> {
  if (process.env.DB_MODE !== 'sqlite') {
    const { data, error } = await db.rpc('reserve_or_number', { p_store_id: storeId });

    if (!error) {
      const row = Array.isArray(data) ? data[0] : data;
      if (!row) throw new Error(`Store ${storeId} not found`);
      return formatOrNumber(row.prefix, row.counter);
    }
    if (error.code !== MISSING_FUNCTION) throw error;
    console.warn('⚠️ reserve_or_number() missing — run atomic_or_counter.sql. Using non-atomic fallback.');
  }

  const { data: store, error } = await db
    .from('stores')
    .select('or_counter, or_prefix')
    .eq('id', storeId)
    .single();
  if (error || !store) throw error || new Error(`Store ${storeId} not found`);

  const counter = (store.or_counter || 0) + 1;
  const { error: updateError } = await db.from('stores').update({ or_counter: counter }).eq('id', storeId);
  if (updateError) throw updateError;

  return formatOrNumber(store.or_prefix || 'OR', counter);
}

// Add a completed sale to the store's non-resettable grand total.
async function addToGrandTotal(db: Db, storeId: string, amount: number): Promise<void> {
  if (process.env.DB_MODE !== 'sqlite') {
    const { error } = await db.rpc('add_to_grand_total', { p_store_id: storeId, p_amount: amount });
    if (!error) return;
    if (error.code !== MISSING_FUNCTION) throw error;
    console.warn('⚠️ add_to_grand_total() missing — run atomic_or_counter.sql. Using non-atomic fallback.');
  }

  const { data: store, error } = await db
    .from('stores')
    .select('grand_total_accumulator')
    .eq('id', storeId)
    .single();
  if (error || !store) throw error || new Error(`Store ${storeId} not found`);

  const total = parseFloat(String(store.grand_total_accumulator || 0)) + amount;
  const { error: updateError } = await db.from('stores').update({ grand_total_accumulator: total }).eq('id', storeId);
  if (updateError) throw updateError;
}

export { reserveOrNumber, addToGrandTotal, formatOrNumber };
