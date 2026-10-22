-- BIR status of e-invoices, from TaxTrail webhooks + polling (Invoicing plan P2-6)
-- Run this in the Supabase SQL editor after eis_invoices.sql. Safe to run more than once.
-- Then re-run admin_delete_company.sql (it deletes eis_webhook_events rows too).

-- TaxTrail transmission (to BIR) per e-invoice
ALTER TABLE public.eis_invoices ADD COLUMN IF NOT EXISTS esp_submission_id character varying;
ALTER TABLE public.eis_invoices ADD COLUMN IF NOT EXISTS bir_ack_no character varying;
ALTER TABLE public.eis_invoices ADD COLUMN IF NOT EXISTS rejection_code character varying;
ALTER TABLE public.eis_invoices ADD COLUMN IF NOT EXISTS rejection_class character varying;
-- Highest webhook `resource.sequence` applied for the transmission (older events are ignored)
ALTER TABLE public.eis_invoices ADD COLUMN IF NOT EXISTS last_event_seq bigint;
-- Polling fallback: when Tindapo last asked TaxTrail for the BIR status
ALTER TABLE public.eis_invoices ADD COLUMN IF NOT EXISTS status_checked_at timestamp with time zone;
CREATE INDEX IF NOT EXISTS idx_eis_invoices_esp_invoice ON public.eis_invoices(company_id, esp_invoice_id);
CREATE INDEX IF NOT EXISTS idx_eis_invoices_awaiting_bir ON public.eis_invoices(status_checked_at) WHERE status = 'issued';

-- The webhook Tindapo registered on TaxTrail for this company (its signing secret is in webhook_secret_enc)
ALTER TABLE public.eis_connections ADD COLUMN IF NOT EXISTS webhook_id character varying;

-- Webhook deliveries already handled (TaxTrail delivers at least once; same event id on every retry)
CREATE TABLE IF NOT EXISTS public.eis_webhook_events (
  event_id character varying NOT NULL,
  company_id uuid NOT NULL,
  event_type character varying NOT NULL,
  received_at timestamp with time zone DEFAULT now(),
  CONSTRAINT eis_webhook_events_pkey PRIMARY KEY (event_id),
  CONSTRAINT eis_webhook_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);
CREATE INDEX IF NOT EXISTS idx_eis_webhook_events_company ON public.eis_webhook_events(company_id, received_at DESC);
