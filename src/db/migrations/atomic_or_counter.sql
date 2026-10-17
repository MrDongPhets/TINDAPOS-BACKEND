-- Atomic OR (Official Receipt) counter + grand total accumulator (BIR)
-- Run this in Supabase SQL editor
--
-- Problem: createSale used to read stores.or_counter / grand_total_accumulator, then write
-- counter+1 / total+amount back at the end. Two simultaneous sales at one store could get the
-- SAME OR number and one sale's amount could be lost from the accumulator.
-- Fix: increment inside a single UPDATE ... RETURNING (row-locked, atomic).

-- 1. Reserve the next OR number for a store. Returns no row if the store doesn't exist.
CREATE OR REPLACE FUNCTION public.reserve_or_number(p_store_id varchar)
RETURNS TABLE(counter integer, prefix varchar)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.stores
     SET or_counter = COALESCE(or_counter, 0) + 1
   WHERE id = p_store_id
  RETURNING or_counter, COALESCE(or_prefix, 'OR')::varchar;
$$;

-- 2. Add a completed sale's amount to the store's non-resettable grand total. Returns the new total.
CREATE OR REPLACE FUNCTION public.add_to_grand_total(p_store_id varchar, p_amount numeric)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.stores
     SET grand_total_accumulator = COALESCE(grand_total_accumulator, 0) + p_amount
   WHERE id = p_store_id
  RETURNING grand_total_accumulator;
$$;

-- Only the backend (service_role) may call these
REVOKE ALL ON FUNCTION public.reserve_or_number(varchar) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_to_grand_total(varchar, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_or_number(varchar) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_to_grand_total(varchar, numeric) TO service_role;

-- 3. Safety net: the database itself rejects a duplicate OR number per store
CREATE UNIQUE INDEX IF NOT EXISTS sales_store_or_number_uidx
  ON public.sales (store_id, or_number)
  WHERE or_number IS NOT NULL;
