-- BIR registration data + invoicing mode (Invoicing plan P0-1)
-- Run this in the Supabase SQL editor. Safe to run more than once.
--
-- Company = the taxpayer (BIR registration). Store = a branch / POS terminal.
-- Field lengths follow BIR's EIS e-invoice JSON format (Annex B v2.1).

-- 1. Company (taxpayer) BIR registration
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS bir_registered_name    VARCHAR(200);
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS bir_trade_name         VARCHAR(200);
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS bir_registered_address VARCHAR(300);
-- 9-digit TIN, digits only (the branch part lives on stores.branch_code). tax_id stays as the legacy free-text field.
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS tin VARCHAR(9)
  CONSTRAINT companies_tin_format CHECK (tin ~ '^[0-9]{9}$');
-- vat = VAT-registered, non_vat = Non-VAT (most sari-sari stores), rbe = Registered Business Enterprise.
-- Default 'vat' keeps today's receipts unchanged until the owner sets it (P0-5).
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS vat_status VARCHAR(10) NOT NULL DEFAULT 'vat'
  CONSTRAINT companies_vat_status_values CHECK (vat_status IN ('vat', 'non_vat', 'rbe'));

-- Backfill tin from the legacy tax_id when it holds at least 9 digits (e.g. "123-456-789-000" → 123456789)
UPDATE public.companies
   SET tin = substring(regexp_replace(tax_id, '[^0-9]', '', 'g') FROM 1 FOR 9)
 WHERE tin IS NULL
   AND tax_id IS NOT NULL
   AND length(regexp_replace(tax_id, '[^0-9]', '', 'g')) >= 9;

-- 2. Store (branch / POS terminal)
-- 5-digit branch code: '00000' = head office; branch '101' is stored as '00101'
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS branch_code VARCHAR(5) NOT NULL DEFAULT '00000'
  CONSTRAINT stores_branch_code_format CHECK (branch_code ~ '^[0-9]{5}$');
-- manual = Tindapo prints the invoice, totals reported by the store; eis = each sale is also sent to the ESP (TaxTrail)
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS invoicing_mode VARCHAR(10) NOT NULL DEFAULT 'manual'
  CONSTRAINT stores_invoicing_mode_values CHECK (invoicing_mode IN ('manual', 'eis'));
-- BIR POS registration: Permit To Use, Machine Identification Number, Machine Serial Number
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS ptu_number VARCHAR(50);
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS min_number VARCHAR(50);
ALTER TABLE public.stores ADD COLUMN IF NOT EXISTS msn_number VARCHAR(50);
