-- BIR Compliance Migration
-- Run this in Supabase SQL editor

-- 1. VAT type per product
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS vat_type VARCHAR(20) DEFAULT 'vatable';
-- values: 'vatable', 'vat_exempt', 'zero_rated'

-- 2. OR (Official Receipt) counter per store - never resets
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS or_counter INTEGER DEFAULT 0;
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS or_prefix VARCHAR(10) DEFAULT 'OR';

-- 3. Grand Total Accumulator per store - non-resettable lifetime total
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS grand_total_accumulator NUMERIC DEFAULT 0;

-- 4. VAT breakdown columns on sales
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS or_number VARCHAR(50);
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS vatable_amount NUMERIC DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS vat_exempt_amount NUMERIC DEFAULT 0;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS zero_rated_amount NUMERIC DEFAULT 0;
-- tax_amount already exists — used for VAT amount (12%)

-- 5. Z-Readings table (BIR end-of-day report)
CREATE TABLE IF NOT EXISTS public.z_readings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id VARCHAR NOT NULL,
  company_id uuid NOT NULL,
  reading_date DATE NOT NULL,
  transaction_count INTEGER DEFAULT 0,
  vatable_sales NUMERIC DEFAULT 0,
  vat_exempt_sales NUMERIC DEFAULT 0,
  zero_rated_sales NUMERIC DEFAULT 0,
  vat_amount NUMERIC DEFAULT 0,
  total_sales NUMERIC DEFAULT 0,
  grand_total_accumulator NUMERIC DEFAULT 0,
  or_from VARCHAR(50),
  or_to VARCHAR(50),
  created_by uuid,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE(store_id, reading_date)
);

-- closed_at: updated every time Close Day is pressed (upsert updates this, created_at does not)
ALTER TABLE public.z_readings ADD COLUMN IF NOT EXISTS closed_at TIMESTAMP WITH TIME ZONE;

-- 6. Unique index on z_readings store+date
CREATE UNIQUE INDEX IF NOT EXISTS z_readings_store_date_idx ON public.z_readings(store_id, reading_date);

-- 7. Row Level Security for z_readings
ALTER TABLE public.z_readings ENABLE ROW LEVEL SECURITY;

-- Allow full access via service_role (backend uses service role key — bypasses RLS already, but explicit is better)
CREATE POLICY "Service role full access" ON public.z_readings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Deny all direct anon/authenticated access — all reads/writes go through the Express backend
CREATE POLICY "No direct client access" ON public.z_readings
  FOR ALL
  TO anon, authenticated
  USING (false);

-- NOTE: product_batches table also needs RLS — run these separately if not already done:
-- ALTER TABLE public.product_batches ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "Service role full access" ON public.product_batches FOR ALL TO service_role USING (true) WITH CHECK (true);
-- CREATE POLICY "No direct client access" ON public.product_batches FOR ALL TO anon, authenticated USING (false);
