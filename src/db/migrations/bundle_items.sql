-- Bundle Products
-- Adds product_type column and bundle_items table for fixed bundle/combo products

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS product_type VARCHAR(20) DEFAULT 'simple'
  CHECK (product_type IN ('simple', 'bundle'));

CREATE TABLE IF NOT EXISTS public.bundle_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bundle_id   UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity    INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  company_id  UUID NOT NULL REFERENCES public.companies(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT unique_bundle_product UNIQUE(bundle_id, product_id)
);

-- RLS
ALTER TABLE public.bundle_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access" ON public.bundle_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "No direct client access" ON public.bundle_items FOR ALL TO anon, authenticated USING (false);
