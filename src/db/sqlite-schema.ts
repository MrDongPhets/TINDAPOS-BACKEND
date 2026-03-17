/**
 * Creates all SQLite tables mirroring the Supabase/PostgreSQL schema.
 * Run once on startup when DB_MODE=sqlite.
 */
import Database from 'better-sqlite3';

export function initializeSQLiteSchema(db: Database.Database): void {
  console.log('📦 Initializing SQLite schema...');

  db.exec(`
    -- Companies
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      logo_url TEXT,
      website TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      address TEXT,
      tax_id TEXT,
      settings TEXT DEFAULT '{}',
      is_active INTEGER DEFAULT 1,
      created_by TEXT,
      email TEXT UNIQUE,
      phone TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Users
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'manager',
      company_id TEXT,
      is_active INTEGER DEFAULT 1,
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id)
    );

    -- Subscriptions
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'offline',
      status TEXT NOT NULL DEFAULT 'active',
      starts_at TEXT,
      ends_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id)
    );

    -- Stores
    CREATE TABLE IF NOT EXISTS stores (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      name TEXT NOT NULL,
      address TEXT,
      phone TEXT,
      email TEXT,
      is_active INTEGER DEFAULT 1,
      created_by TEXT,
      store_type TEXT DEFAULT 'retail',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id)
    );

    -- Categories
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT DEFAULT '#3b82f6',
      icon TEXT DEFAULT 'cube-outline',
      store_id TEXT NOT NULL,
      company_id TEXT,
      is_active INTEGER DEFAULT 1,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Products
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      sku TEXT,
      barcode TEXT,
      category_id TEXT,
      store_id TEXT NOT NULL,
      company_id TEXT,
      default_price REAL NOT NULL DEFAULT 0,
      manila_price REAL,
      delivery_price REAL,
      wholesale_price REAL,
      cost_price REAL DEFAULT 0,
      stock_quantity INTEGER DEFAULT 0,
      min_stock_level INTEGER DEFAULT 0,
      max_stock_level INTEGER,
      unit TEXT DEFAULT 'pcs',
      weight REAL,
      dimensions TEXT,
      tags TEXT,
      image_url TEXT,
      is_active INTEGER DEFAULT 1,
      is_composite INTEGER DEFAULT 0,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Ingredients
    CREATE TABLE IF NOT EXISTS ingredients (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      sku TEXT UNIQUE,
      store_id TEXT NOT NULL,
      company_id TEXT,
      unit TEXT NOT NULL DEFAULT 'g',
      unit_cost REAL NOT NULL DEFAULT 0,
      stock_quantity REAL DEFAULT 0,
      min_stock_level REAL DEFAULT 10,
      supplier TEXT,
      is_active INTEGER DEFAULT 1,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Product Recipes
    CREATE TABLE IF NOT EXISTS product_recipes (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      ingredient_id TEXT NOT NULL,
      quantity_needed REAL NOT NULL,
      unit TEXT NOT NULL,
      notes TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Sales
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      sale_number TEXT UNIQUE,
      subtotal REAL NOT NULL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      discount_type TEXT,
      discount_value REAL DEFAULT 0,
      tax_amount REAL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      items_count INTEGER DEFAULT 0,
      payment_method TEXT DEFAULT 'cash',
      amount_paid REAL,
      change_amount REAL DEFAULT 0,
      staff_id TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      receipt_number TEXT UNIQUE,
      notes TEXT,
      status TEXT DEFAULT 'completed',
      cashier_name TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Sale Items
    CREATE TABLE IF NOT EXISTS sales_items (
      id TEXT PRIMARY KEY,
      sales_id TEXT NOT NULL,
      sale_id TEXT,
      product_id TEXT NOT NULL,
      product_name TEXT,
      product_sku TEXT,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      discount REAL DEFAULT 0,
      discount_amount REAL DEFAULT 0,
      discount_percent REAL DEFAULT 0,
      total_price REAL NOT NULL,
      barcode TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (sales_id) REFERENCES sales(id) ON DELETE CASCADE
    );

    -- Inventory Movements
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      movement_type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      previous_stock INTEGER NOT NULL DEFAULT 0,
      new_stock INTEGER NOT NULL DEFAULT 0,
      unit_cost REAL,
      total_cost REAL,
      reference_type TEXT,
      reference_id TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Ingredient Movements
    CREATE TABLE IF NOT EXISTS ingredient_movements (
      id TEXT PRIMARY KEY,
      ingredient_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      movement_type TEXT NOT NULL,
      quantity REAL NOT NULL,
      previous_stock REAL NOT NULL DEFAULT 0,
      new_stock REAL NOT NULL DEFAULT 0,
      unit_cost REAL,
      reference_type TEXT,
      reference_id TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Inventory Transfers
    CREATE TABLE IF NOT EXISTS inventory_transfers (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      transfer_number TEXT NOT NULL UNIQUE,
      from_store_id TEXT NOT NULL,
      to_store_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_by TEXT NOT NULL,
      approved_by TEXT,
      received_by TEXT,
      reason TEXT,
      notes TEXT,
      rejection_reason TEXT,
      requested_at TEXT DEFAULT (datetime('now')),
      approved_at TEXT,
      shipped_at TEXT,
      received_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Product Manufacturing
    CREATE TABLE IF NOT EXISTS product_manufacturing (
      id TEXT PRIMARY KEY,
      product_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      quantity_produced INTEGER NOT NULL,
      batch_number TEXT,
      production_date TEXT DEFAULT (datetime('now')),
      expiry_date TEXT,
      notes TEXT,
      status TEXT DEFAULT 'completed',
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Staff
    CREATE TABLE IF NOT EXISTS staff (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      store_id TEXT,
      staff_id TEXT,
      name TEXT NOT NULL,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'cashier',
      pin_hash TEXT,
      passcode TEXT,
      is_active INTEGER DEFAULT 1,
      permissions TEXT DEFAULT '{}',
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Activity Logs
    CREATE TABLE IF NOT EXISTS activity_logs (
      id TEXT PRIMARY KEY,
      company_id TEXT,
      user_id TEXT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      details TEXT,
      ip_address TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Staff Activity Logs
    CREATE TABLE IF NOT EXISTS staff_activity_logs (
      id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      staff_id TEXT,
      company_id TEXT,
      store_id TEXT,
      action_type TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    -- Super Admins (kept for compatibility, unused in offline mode)
    CREATE TABLE IF NOT EXISTS super_admins (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      last_login TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    -- Customers (Utang Tracker)
    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT,
      notes TEXT,
      is_active INTEGER DEFAULT 1,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id)
    );

    -- Credit Ledger (Utang Tracker)
    CREATE TABLE IF NOT EXISTS credit_ledger (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      customer_id TEXT NOT NULL,
      sale_id TEXT,
      type TEXT NOT NULL CHECK (type IN ('charge', 'payment')),
      amount REAL NOT NULL,
      notes TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (company_id) REFERENCES companies(id),
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (sale_id) REFERENCES sales(id)
    );

    -- Store Requests
    CREATE TABLE IF NOT EXISTS store_requests (
      id TEXT PRIMARY KEY,
      company_id TEXT NOT NULL,
      store_name TEXT NOT NULL,
      store_address TEXT,
      store_type TEXT DEFAULT 'retail',
      reason TEXT,
      status TEXT DEFAULT 'pending',
      reviewed_by TEXT,
      reviewed_at TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `);

  // Migrations for existing databases (ALTER TABLE IF column missing)
  try { db.exec('ALTER TABLE sales ADD COLUMN items_count INTEGER DEFAULT 0'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE products ADD COLUMN dimensions TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE products ADD COLUMN tags TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE sales ADD COLUMN staff_id TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE sales ADD COLUMN customer_name TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE sales ADD COLUMN customer_phone TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE sales ADD COLUMN receipt_number TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE sales_items ADD COLUMN sales_id TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE sales_items ADD COLUMN discount_amount REAL DEFAULT 0'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE sales_items ADD COLUMN discount_percent REAL DEFAULT 0'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE sales_items ADD COLUMN barcode TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE staff ADD COLUMN staff_id TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE staff ADD COLUMN passcode TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE companies ADD COLUMN company_code TEXT'); } catch { /* already exists */ }
  try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_company_code ON companies(company_code)'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE products ADD COLUMN cost_price REAL DEFAULT 0'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE products ADD COLUMN recipe_cost REAL DEFAULT 0'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE products ADD COLUMN expiry_date TEXT'); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE companies ADD COLUMN subscription_status TEXT DEFAULT 'trial'"); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE companies ADD COLUMN trial_end_date TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE companies ADD COLUMN subscription_end_date TEXT'); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE companies ADD COLUMN subscription_plan TEXT DEFAULT 'basic'"); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE sales ADD COLUMN customer_id TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE users ADD COLUMN phone TEXT'); } catch { /* already exists */ }

  // Set trial_end_date for existing companies that don't have one (30 days from now)
  const companiesWithoutTrial = db.prepare("SELECT id FROM companies WHERE trial_end_date IS NULL AND subscription_status = 'trial'").all() as { id: string }[];
  const defaultTrialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  for (const company of companiesWithoutTrial) {
    db.prepare('UPDATE companies SET trial_end_date = ? WHERE id = ?').run(defaultTrialEnd, company.id);
  }

  // Auto-generate company_code for existing companies that don't have one
  const companiesWithoutCode = db.prepare('SELECT id FROM companies WHERE company_code IS NULL').all() as { id: string }[];
  for (const company of companiesWithoutCode) {
    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    db.prepare('UPDATE companies SET company_code = ? WHERE id = ?').run(code, company.id);
    console.log(`🔑 Generated company_code ${code} for company ${company.id}`);
  }

  console.log('✅ SQLite schema initialized');
}
