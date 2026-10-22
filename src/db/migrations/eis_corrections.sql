-- Voids / returns sent to TaxTrail as corrections (Invoicing plan P2-7)
-- Run this in the Supabase SQL editor after eis_invoices.sql and sale_adjustments.sql. Safe to run more than once.
-- eis_invoices rows with kind 'cancellation' / 'credit_memo' point to the Tindapo adjustment (ADJ-…) they come from.
ALTER TABLE public.eis_invoices ADD COLUMN IF NOT EXISTS adjustment_id uuid REFERENCES public.sale_adjustments(id);
-- One correction per adjustment
CREATE UNIQUE INDEX IF NOT EXISTS eis_invoices_one_per_adjustment ON public.eis_invoices(adjustment_id) WHERE adjustment_id IS NOT NULL;
