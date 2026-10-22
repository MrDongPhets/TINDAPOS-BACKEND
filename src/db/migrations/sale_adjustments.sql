-- Voids and returns as their own numbered documents (Invoicing plan P0-6)
-- Run this in the Supabase SQL editor. Safe to run more than once.
-- Then re-run admin_delete_company.sql (it deletes sale_adjustments rows too).
--
-- BIR: an issued invoice is never deleted or edited. A void / return is a separate adjustment
-- (ADJ-00000001 …, sequential per store) pointing to the original sale. The grand total is NOT changed.

ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS adj_counter integer DEFAULT 0;

-- Sale-level summary (for list badges and to stop returning more than was sold)
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS adjustment_status character varying
  CHECK (adjustment_status IN ('voided', 'returned', 'partially_returned'));
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS refunded_amount numeric(12,2) DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.sale_adjustments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  store_id character varying NOT NULL,
  original_sale_id uuid NOT NULL,
  adjustment_no character varying NOT NULL,
  kind character varying NOT NULL CHECK (kind IN ('void', 'return')),
  -- 01 error · 04 cancellation (full return, no replacement) · 05 return for replacement · 09 others
  correction_code character varying(2) NOT NULL CHECK (correction_code IN ('01', '04', '05', '09')),
  -- Amounts given back (positive numbers; the adjustment itself means "minus")
  total_amount numeric(12,2) NOT NULL,
  vatable_amount numeric(12,2) NOT NULL DEFAULT 0,
  vat_exempt_amount numeric(12,2) NOT NULL DEFAULT 0,
  zero_rated_amount numeric(12,2) NOT NULL DEFAULT 0,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  -- [{sales_item_id, product_id, name, quantity, unit_price, amount}]
  items jsonb NOT NULL,
  reason text NOT NULL,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT sale_adjustments_pkey PRIMARY KEY (id),
  CONSTRAINT sale_adjustments_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
  CONSTRAINT sale_adjustments_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id),
  CONSTRAINT sale_adjustments_original_sale_id_fkey FOREIGN KEY (original_sale_id) REFERENCES public.sales(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS sale_adjustments_store_no_uidx ON public.sale_adjustments(store_id, adjustment_no);
CREATE INDEX IF NOT EXISTS idx_sale_adjustments_sale ON public.sale_adjustments(original_sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_adjustments_company_created ON public.sale_adjustments(company_id, created_at DESC);

-- Atomic next adjustment number for a store (same pattern as reserve_or_number)
CREATE OR REPLACE FUNCTION public.reserve_adjustment_number(p_store_id varchar)
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.stores SET adj_counter = COALESCE(adj_counter, 0) + 1 WHERE id = p_store_id RETURNING adj_counter;
$$;
REVOKE ALL ON FUNCTION public.reserve_adjustment_number(varchar) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reserve_adjustment_number(varchar) TO service_role;
