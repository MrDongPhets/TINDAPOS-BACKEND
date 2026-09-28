-- Admin: permanently delete a company and ALL of its data
-- Run this in Supabase SQL editor
-- Called from the backend via supabase.rpc('admin_delete_company', { p_company_id })
-- Runs as a single transaction: if any delete fails, nothing is deleted.

CREATE OR REPLACE FUNCTION public.admin_delete_company(p_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_store_ids   varchar[];
  v_user_ids    uuid[];
  v_staff_ids   uuid[];
  v_product_ids uuid[];
  v_sale_ids    uuid[];
BEGIN
  IF NOT EXISTS (SELECT 1 FROM companies WHERE id = p_company_id) THEN
    RAISE EXCEPTION 'Company % not found', p_company_id;
  END IF;

  SELECT coalesce(array_agg(id), '{}') INTO v_store_ids   FROM stores   WHERE company_id = p_company_id;
  SELECT coalesce(array_agg(id), '{}') INTO v_user_ids    FROM users    WHERE company_id = p_company_id;
  SELECT coalesce(array_agg(id), '{}') INTO v_staff_ids   FROM staff    WHERE company_id = p_company_id;
  SELECT coalesce(array_agg(id), '{}') INTO v_product_ids FROM products WHERE store_id = ANY(v_store_ids);
  SELECT coalesce(array_agg(id), '{}') INTO v_sale_ids    FROM sales
    WHERE company_id = p_company_id OR store_id = ANY(v_store_ids);

  -- Sales + credit
  DELETE FROM credit_ledger WHERE company_id = p_company_id OR sale_id = ANY(v_sale_ids);
  DELETE FROM sales_items   WHERE sales_id = ANY(v_sale_ids) OR product_id = ANY(v_product_ids);
  DELETE FROM sales         WHERE id = ANY(v_sale_ids);
  DELETE FROM customers     WHERE company_id = p_company_id;
  DELETE FROM z_readings    WHERE company_id = p_company_id OR store_id = ANY(v_store_ids);

  -- Stock counts
  DELETE FROM stock_count_items WHERE product_id = ANY(v_product_ids)
    OR stock_count_id IN (SELECT id FROM stock_counts WHERE company_id = p_company_id OR store_id = ANY(v_store_ids));
  DELETE FROM stock_counts WHERE company_id = p_company_id OR store_id = ANY(v_store_ids);

  -- Products + inventory
  DELETE FROM bundle_items          WHERE company_id = p_company_id OR bundle_id = ANY(v_product_ids) OR product_id = ANY(v_product_ids);
  DELETE FROM product_recipes       WHERE product_id = ANY(v_product_ids)
    OR ingredient_id IN (SELECT id FROM ingredients WHERE store_id = ANY(v_store_ids));
  DELETE FROM ingredient_movements  WHERE store_id = ANY(v_store_ids);
  DELETE FROM ingredients           WHERE store_id = ANY(v_store_ids);
  DELETE FROM product_batches       WHERE product_id = ANY(v_product_ids) OR store_id = ANY(v_store_ids);
  DELETE FROM product_manufacturing WHERE product_id = ANY(v_product_ids) OR store_id = ANY(v_store_ids);
  DELETE FROM inventory_movements   WHERE product_id = ANY(v_product_ids) OR store_id = ANY(v_store_ids);
  DELETE FROM inventory_transfers   WHERE company_id = p_company_id OR product_id = ANY(v_product_ids)
    OR from_store_id = ANY(v_store_ids) OR to_store_id = ANY(v_store_ids);
  DELETE FROM products              WHERE id = ANY(v_product_ids);
  DELETE FROM categories            WHERE store_id = ANY(v_store_ids);

  -- Staff
  DELETE FROM staff_attendance           WHERE company_id = p_company_id OR staff_id = ANY(v_staff_ids);
  DELETE FROM staff_webauthn_credentials WHERE company_id = p_company_id OR staff_id = ANY(v_staff_ids);
  DELETE FROM staff_activity_logs        WHERE company_id = p_company_id OR staff_id = ANY(v_staff_ids);
  DELETE FROM staff                      WHERE id = ANY(v_staff_ids);

  -- Billing + files
  DELETE FROM file_uploads       WHERE company_id = p_company_id;
  DELETE FROM payment_history    WHERE company_id = p_company_id;
  DELETE FROM subscription_usage WHERE company_id = p_company_id;
  DELETE FROM subscriptions      WHERE company_id = p_company_id;

  -- Stores, users, company (break companies.created_by → users cycle first)
  DELETE FROM stores WHERE id = ANY(v_store_ids);
  UPDATE companies SET created_by = NULL WHERE id = p_company_id;
  DELETE FROM users WHERE id = ANY(v_user_ids);
  DELETE FROM companies WHERE id = p_company_id;
END;
$$;

-- Only the backend (service_role) may call this
REVOKE ALL ON FUNCTION public.admin_delete_company(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_company(uuid) TO service_role;
