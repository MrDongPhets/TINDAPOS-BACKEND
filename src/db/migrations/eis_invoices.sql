-- E-invoicing through an ESP (ITBS TaxTrail) — Invoicing plan P2-1
-- Run this in the Supabase SQL editor. Safe to run more than once.
-- Then re-run admin_delete_company.sql (it deletes these tables' rows too).
--
-- For stores in e-invoice mode, TaxTrail ISSUES the invoice: Tindapo sends the sale's items and keeps the
-- returned TaxTrail invoice id + number here. One row per sale (and later per correction).

-- 1. Per-company connection to the ESP. The API key is stored ENCRYPTED (AES-256-GCM, server key in env),
--    never returned to the browser; only its last 4 characters are kept readable for display.
CREATE TABLE IF NOT EXISTS public.eis_connections (
  company_id uuid NOT NULL,
  provider character varying NOT NULL DEFAULT 'taxtrail' CHECK (provider IN ('taxtrail')),
  base_url character varying NOT NULL,
  api_key_enc text NOT NULL,
  api_key_last4 character varying(4),
  webhook_secret_enc text,
  last_checked_at timestamp with time zone,
  last_check_ok boolean,
  last_check_message text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT eis_connections_pkey PRIMARY KEY (company_id),
  CONSTRAINT eis_connections_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id)
);

-- 2. Sale ↔ ESP invoice link, status and retry state
CREATE TABLE IF NOT EXISTS public.eis_invoices (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  store_id character varying NOT NULL,
  sale_id uuid NOT NULL,
  -- 'invoice' = the sale itself; corrections (credit memo / cancellation) come later (P2-7)
  kind character varying NOT NULL DEFAULT 'invoice' CHECK (kind IN ('invoice', 'credit_memo', 'cancellation', 'additional_invoice')),
  -- Never regenerated: a retry with the same key returns the same ESP invoice instead of a duplicate
  idempotency_key character varying NOT NULL,
  request_body jsonb NOT NULL,
  status character varying NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'issued', 'accepted', 'rejected', 'dead_letter', 'invalid', 'config_error')),
  esp_invoice_id character varying,
  esp_invoice_no character varying,
  esp_totals jsonb,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamp with time zone DEFAULT now(),
  last_error text,
  last_http_status integer,
  issued_at timestamp with time zone,
  status_changed_at timestamp with time zone DEFAULT now(),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT eis_invoices_pkey PRIMARY KEY (id),
  CONSTRAINT eis_invoices_idempotency_key_key UNIQUE (idempotency_key),
  CONSTRAINT eis_invoices_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
  CONSTRAINT eis_invoices_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id),
  CONSTRAINT eis_invoices_sale_id_fkey FOREIGN KEY (sale_id) REFERENCES public.sales(id)
);

-- One ESP invoice per sale
CREATE UNIQUE INDEX IF NOT EXISTS eis_invoices_one_invoice_per_sale ON public.eis_invoices(sale_id) WHERE kind = 'invoice';
-- The retry worker's queue: rows still waiting to be issued, oldest first
CREATE INDEX IF NOT EXISTS idx_eis_invoices_due ON public.eis_invoices(next_attempt_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_eis_invoices_company_created ON public.eis_invoices(company_id, created_at DESC);
