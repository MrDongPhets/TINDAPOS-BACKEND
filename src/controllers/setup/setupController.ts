import bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { Request, Response } from 'express';
import { getDb } from '../../config/database';
import { generateToken } from '../../services/tokenService';

/** Returns whether the app needs first-time setup (SQLite mode + no users) */
async function getSetupStatus(req: Request, res: Response): Promise<void> {
  try {
    const mode = (process.env.DB_MODE || 'supabase').toLowerCase();

    if (mode !== 'sqlite') {
      res.json({ needsSetup: false, mode });
      return;
    }

    const db = getDb();
    const { data: users, error } = await db
      .from('users')
      .select('id', { count: 'exact', head: true })
      .limit(1);

    if (error && error.code !== 'PGRST116') {
      res.json({ needsSetup: true, mode });
      return;
    }

    const { count } = await db
      .from('users')
      .select('id', { count: 'exact', head: true });

    res.json({ needsSetup: (count ?? 0) === 0, mode });
  } catch (err: any) {
    console.error('❌ Setup status error:', err.message);
    res.json({ needsSetup: true, mode: process.env.DB_MODE || 'supabase' });
  }
}

/** Creates the first company + admin user (SQLite only, only if DB is empty) */
async function initializeSetup(req: Request, res: Response): Promise<void> {
  try {
    const mode = (process.env.DB_MODE || 'supabase').toLowerCase();

    if (mode !== 'sqlite') {
      res.status(400).json({ error: 'Setup only available in offline (SQLite) mode', code: 'WRONG_MODE' });
      return;
    }

    const { companyName, adminName, email, password } = req.body;

    if (!companyName || !adminName || !email || !password) {
      res.status(400).json({ error: 'All fields are required', code: 'MISSING_FIELDS' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters', code: 'WEAK_PASSWORD' });
      return;
    }

    const db = getDb();

    // Check DB is actually empty
    const { count } = await db
      .from('users')
      .select('id', { count: 'exact', head: true });

    if ((count ?? 0) > 0) {
      res.status(400).json({ error: 'Setup already completed', code: 'ALREADY_SETUP' });
      return;
    }

    console.log('🚀 Initializing offline setup...');

    const companyId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const storeId = crypto.randomUUID();
    const subscriptionId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Generate short unique company code (6 uppercase alphanumeric chars)
    const companyCode = Math.random().toString(36).substring(2, 8).toUpperCase();

    // 1. Create company
    await db.from('companies').insert({
      id: companyId,
      name: companyName,
      company_code: companyCode,
      is_active: 1,
      created_at: now,
      updated_at: now,
    });

    // 2. Create admin user
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.from('users').insert({
      id: userId,
      email: email.toLowerCase(),
      password: hashedPassword,
      name: adminName,
      role: 'manager',
      company_id: companyId,
      is_active: 1,
      created_at: now,
      updated_at: now,
    });

    // 3. Create default store
    await db.from('stores').insert({
      id: storeId,
      company_id: companyId,
      name: `${companyName} Main Store`,
      is_active: 1,
      created_by: userId,
      created_at: now,
      updated_at: now,
    });

    // 4. Create offline subscription
    await db.from('subscriptions').insert({
      id: subscriptionId,
      company_id: companyId,
      plan: 'offline',
      status: 'active',
      starts_at: now,
      created_at: now,
      updated_at: now,
    });

    console.log('✅ Offline setup complete for:', email);

    // Return token so user is auto-logged in
    const user = { id: userId, email: email.toLowerCase(), name: adminName, role: 'manager', company_id: companyId };
    const company = { id: companyId, name: companyName, company_code: companyCode };
    const token = generateToken(user, 'client');

    res.json({
      message: 'Setup complete',
      token,
      userType: 'client',
      user: { ...user },
      company,
      subscription: { plan: 'offline', status: 'active' },
    });

  } catch (err: any) {
    console.error('❌ Setup error:', err.message);
    res.status(500).json({ error: 'Setup failed: ' + err.message, code: 'SETUP_ERROR' });
  }
}

/** Returns active stores filtered by company_code (public — used by staff login page) */
async function getPublicStores(req: Request, res: Response): Promise<void> {
  try {
    const db = getDb();
    const { company_code } = req.query;

    if (!company_code) {
      res.status(400).json({ error: 'company_code is required', stores: [] });
      return;
    }

    // Look up company by code
    const { data: companies, error: companyError } = await db
      .from('companies')
      .select('id')
      .eq('company_code', company_code)
      .eq('is_active', true)
      .limit(1);

    if (companyError || !companies || companies.length === 0) {
      res.status(404).json({ error: 'Company not found', stores: [] });
      return;
    }

    const companyId = companies[0].id;

    const { data: stores, error } = await db
      .from('stores')
      .select('id, name')
      .eq('company_id', companyId)
      .eq('is_active', true);

    if (error) throw error;
    res.json({ stores: stores || [], company_id: companyId });
  } catch (err: any) {
    console.error('❌ Public stores error:', err.message);
    res.status(500).json({ stores: [] });
  }
}

export { getSetupStatus, initializeSetup, getPublicStores };
