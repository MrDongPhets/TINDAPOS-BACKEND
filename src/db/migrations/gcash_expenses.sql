-- GCash cash-in / cash-out tracking + daily expenses
-- Run this in Supabase SQL editor
-- Then re-run admin_delete_company.sql (it now also deletes these tables)

-- 1. GCash transactions (store acts as a GCash cash-in / cash-out outlet)
--    cash_in : customer gives cash (amount + fee) → store sends `amount` from its GCash wallet
--    cash_out: customer sends `amount` to the store's GCash → store gives cash (amount − fee, or amount if fee paid separately)
--    The store's income is the `fee`.
CREATE TABLE IF NOT EXISTS public.gcash_transactions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  store_id character varying,
  type character varying NOT NULL CHECK (type IN ('cash_in', 'cash_out')),
  amount numeric NOT NULL CHECK (amount > 0),
  fee numeric NOT NULL DEFAULT 0 CHECK (fee >= 0),
  customer_name character varying,
  reference_number character varying,
  notes text,
  created_by uuid,           -- owner (users.id)
  staff_id uuid,             -- staff (staff.id)
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT gcash_transactions_pkey PRIMARY KEY (id),
  CONSTRAINT gcash_transactions_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
  CONSTRAINT gcash_transactions_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id),
  CONSTRAINT gcash_transactions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id),
  CONSTRAINT gcash_transactions_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id)
);

CREATE INDEX IF NOT EXISTS idx_gcash_company_created ON public.gcash_transactions(company_id, created_at DESC);

-- 2. Expenses (rent, electricity, salary, ice, delivery, ...)
CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  store_id character varying,          -- NULL = company-wide (e.g. shared rent)
  category character varying NOT NULL DEFAULT 'other'
    CHECK (category IN ('rent', 'electricity', 'water', 'internet', 'salary', 'supplies', 'transportation', 'maintenance', 'taxes', 'other')),
  description text,
  amount numeric NOT NULL CHECK (amount > 0),
  expense_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method character varying NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'gcash', 'bank', 'other')),
  created_by uuid,
  staff_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT expenses_pkey PRIMARY KEY (id),
  CONSTRAINT expenses_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id),
  CONSTRAINT expenses_store_id_fkey FOREIGN KEY (store_id) REFERENCES public.stores(id),
  CONSTRAINT expenses_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.users(id),
  CONSTRAINT expenses_staff_id_fkey FOREIGN KEY (staff_id) REFERENCES public.staff(id)
);

CREATE INDEX IF NOT EXISTS idx_expenses_company_date ON public.expenses(company_id, expense_date DESC);

-- 3. Row Level Security — all access goes through the Express backend (service_role)
ALTER TABLE public.gcash_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access" ON public.gcash_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "No direct client access" ON public.gcash_transactions FOR ALL TO anon, authenticated USING (false);
CREATE POLICY "Service role full access" ON public.expenses FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "No direct client access" ON public.expenses FOR ALL TO anon, authenticated USING (false);
