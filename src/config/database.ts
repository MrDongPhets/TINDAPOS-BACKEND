import { createClient, SupabaseClient } from '@supabase/supabase-js';
import path from 'path';
import { SQLiteAdapter } from '../db/sqlite-adapter';
import { initializeSQLiteSchema } from '../db/sqlite-schema';

// Unified DB client — either Supabase or SQLite adapter
let dbClient: SupabaseClient | SQLiteAdapter | null = null;

/**
 * Returns the active database client.
 * Both SupabaseClient and SQLiteAdapter share the .from() query API.
 * Type as `any` to allow controllers to use either transparently.
 */
function getDb(): any {
  if (!dbClient) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return dbClient;
}

/**
 * @deprecated Use getDb() instead. Kept for backward compatibility.
 * Will throw if DB_MODE=sqlite.
 */
function getSupabase(): SupabaseClient {
  if (!dbClient) throw new Error('Database not initialized');
  if (dbClient instanceof SQLiteAdapter) {
    throw new Error('getSupabase() called but DB_MODE=sqlite. Use getDb() instead.');
  }
  return dbClient as SupabaseClient;
}

async function initializeDatabase(): Promise<boolean> {
  const mode = (process.env.DB_MODE || 'supabase').toLowerCase();
  console.log(`🗄️  DB_MODE: ${mode}`);

  if (mode === 'sqlite') {
    return initializeSQLite();
  }
  return initializeSupabase();
}

// ── SQLite ───────────────────────────────────────────────────────────────────

async function initializeSQLite(): Promise<boolean> {
  try {
    console.log('🗄️  Initializing SQLite database...');

    // Default path: next to server.js (works both in dev and packaged)
    const dbPath = process.env.SQLITE_PATH
      || path.join(process.cwd(), 'kitapos.db');

    console.log('📁 SQLite path:', dbPath);

    const adapter = new SQLiteAdapter(dbPath);
    initializeSQLiteSchema(adapter.getDb());
    dbClient = adapter;

    console.log('✅ SQLite database ready');
    return true;
  } catch (err: any) {
    console.error('❌ SQLite init failed:', err.message);
    return false;
  }
}

// ── Supabase ─────────────────────────────────────────────────────────────────

function validateEnvVars(): boolean {
  console.log('🔍 Checking environment variables...');
  console.log('   Environment:', process.env.NODE_ENV || 'development');

  const required: Record<string, string | undefined> = {
    'SUPABASE_URL': process.env.SUPABASE_URL,
    'SUPABASE_SERVICE_ROLE_KEY': process.env.SUPABASE_SERVICE_ROLE_KEY,
    'JWT_SECRET': process.env.JWT_SECRET
  };

  const missing: string[] = [];
  Object.entries(required).forEach(([key, value]) => {
    if (!value) {
      missing.push(key);
      console.log(`   ❌ Missing: ${key}`);
    } else {
      console.log(`   ✅ ${key}: ${value.substring(0, 10)}...`);
    }
  });

  if (missing.length > 0) {
    console.error('   ❌ Missing required environment variables:', missing);
    return false;
  }
  console.log('   ✅ All environment variables validated');
  return true;
}

async function initializeSupabase(): Promise<boolean> {
  try {
    console.log('🔌 Initializing Supabase client...');

    if (!validateEnvVars()) {
      throw new Error('Environment validation failed - missing required variables');
    }

    const supabaseUrl = process.env.SUPABASE_URL as string;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

    console.log('📡 Supabase URL:', supabaseUrl);

    const client = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false }
    });

    // Test connection
    const { error, count } = await client
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .limit(1);

    if (error) {
      console.log('❌ Database connection failed:', error.message);
      throw new Error(`Database connection failed: ${error.message}`);
    }

    console.log(`✅ Database test successful - Found ${count || 0} companies`);
    dbClient = client;
    return true;
  } catch (err: any) {
    console.error('❌ Failed to initialize Supabase:', err.message);
    return false;
  }
}

async function testDatabaseConnection(): Promise<{ success: boolean; error?: string; count?: number | null }> {
  if (!dbClient) return { success: false, error: 'Database not initialized' };

  try {
    console.log('🧪 Testing database connection...');
    const { data, error, count } = await getDb()
      .from('companies')
      .select('id', { count: 'exact', head: true })
      .limit(1);

    if (error) {
      console.error('Database test failed:', error.message);
      return { success: false, error: error.message };
    }

    console.log(`✅ Database test successful - Found ${count || 0} companies`);
    return { success: true, count };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export {
  initializeDatabase,
  getDb,
  getSupabase,
  testDatabaseConnection
};
