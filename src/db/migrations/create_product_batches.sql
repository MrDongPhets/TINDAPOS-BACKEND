-- FIFO Batch Costing: product_batches table
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS public.product_batches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL,
  store_id character varying NOT NULL,
  cost_price numeric NOT NULL DEFAULT 0,
  qty_received integer NOT NULL,
  qty_remaining integer NOT NULL,
  selling_price numeric DEFAULT 0,
  received_at timestamp with time zone DEFAULT now(),
  note text,
  created_by uuid,
  CONSTRAINT product_batches_pkey PRIMARY KEY (id),
  CONSTRAINT fk_batch_product FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE,
  CONSTRAINT fk_batch_store FOREIGN KEY (store_id) REFERENCES public.stores(id),
  CONSTRAINT fk_batch_created_by FOREIGN KEY (created_by) REFERENCES public.users(id)
);

CREATE INDEX IF NOT EXISTS idx_batches_product_store ON public.product_batches(product_id, store_id);
CREATE INDEX IF NOT EXISTS idx_batches_received_at ON public.product_batches(received_at);

-- Add cost_price to sales_items to record actual COGS at time of sale
ALTER TABLE public.sales_items ADD COLUMN IF NOT EXISTS cost_price numeric DEFAULT 0;

-- Add selling_price to product_batches (run if table already exists)
ALTER TABLE public.product_batches ADD COLUMN IF NOT EXISTS selling_price numeric DEFAULT 0;
