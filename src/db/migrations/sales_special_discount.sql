-- Senior citizen / PWD beneficiary on the sale (Invoicing plan P2-5)
-- Run this in the Supabase SQL editor. Safe to run more than once.
-- BIR: an SC/PWD invoice shows the beneficiary's name and ID number; TaxTrail requires them to issue the e-invoice.
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS sc_pwd_name  VARCHAR(200);
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS sc_pwd_id_no VARCHAR(50);
