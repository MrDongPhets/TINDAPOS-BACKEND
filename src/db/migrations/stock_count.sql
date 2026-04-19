-- Stock Count / Physical Inventory Audit
-- Run in Supabase SQL editor

CREATE TABLE IF NOT EXISTS public.stock_counts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  store_id CHARACTER VARYING REFERENCES public.stores(id) ON DELETE CASCADE,
  company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
  created_by UUID REFERENCES public.users(id),
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved')),
  notes TEXT,
  submitted_at TIMESTAMP WITH TIME ZONE,
  approved_by UUID REFERENCES public.users(id),
  approved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.stock_count_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  stock_count_id UUID REFERENCES public.stock_counts(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  expected_qty NUMERIC DEFAULT 0,
  actual_qty NUMERIC,
  variance NUMERIC,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- RLS
ALTER TABLE public.stock_counts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.stock_counts FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "No direct client access" ON public.stock_counts FOR ALL TO anon, authenticated USING (false);

ALTER TABLE public.stock_count_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.stock_count_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "No direct client access" ON public.stock_count_items FOR ALL TO anon, authenticated USING (false);
