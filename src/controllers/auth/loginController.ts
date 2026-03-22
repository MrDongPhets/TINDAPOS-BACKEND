import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { getDb } from '../../config/database';
import { generateToken } from '../../services/tokenService';

// In-memory rate limiter: email → { attempts, lockedUntil }
const loginAttempts = new Map<string, { attempts: number; lockedUntil: number }>();
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 minutes

function checkRateLimit(email: string): { locked: boolean; minutesLeft?: number } {
  const record = loginAttempts.get(email);
  if (!record) return { locked: false };
  if (record.lockedUntil && Date.now() < record.lockedUntil) {
    const minutesLeft = Math.ceil((record.lockedUntil - Date.now()) / 60000);
    return { locked: true, minutesLeft };
  }
  return { locked: false };
}

function recordFailedAttempt(email: string): void {
  const record = loginAttempts.get(email) || { attempts: 0, lockedUntil: 0 };
  record.attempts += 1;
  if (record.attempts >= MAX_ATTEMPTS) {
    record.lockedUntil = Date.now() + LOCKOUT_MS;
    console.log(`🔐 Account temporarily locked: ${email} (${MAX_ATTEMPTS} failed attempts)`);
  }
  loginAttempts.set(email, record);
}

function clearAttempts(email: string): void {
  loginAttempts.delete(email);
}

async function clientLogin(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;

    console.log(`🔐 Login attempt for: ${email}`);

    if (!email || !password) {
      console.log('❌ Missing credentials');
      res.status(400).json({
        error: 'Email and password are required',
        code: 'MISSING_CREDENTIALS'
      });
      return;
    }

    // Rate limit check
    const rateLimit = checkRateLimit(email.toLowerCase());
    if (rateLimit.locked) {
      res.status(429).json({
        error: `Too many failed attempts. Please try again in ${rateLimit.minutesLeft} minute${rateLimit.minutesLeft === 1 ? '' : 's'}.`,
        code: 'RATE_LIMITED'
      });
      return;
    }

    const supabase = getDb();

    // Find user
    console.log('🔍 Step 1: Finding user...');
    const { data: userCheck, error: userCheckError } = await supabase
      .from('users')
      .select('id, email, password, is_active, company_id, name, role')
      .eq('email', email.toLowerCase())
      .single();

    if (userCheckError || !userCheck) {
      console.log(`❌ User not found: ${email}`);
      recordFailedAttempt(email.toLowerCase());
      res.status(401).json({
        error: 'Invalid email or password',
        code: 'INVALID_CREDENTIALS'
      });
      return;
    }

    console.log('✅ User found:', userCheck.email);

    if (!userCheck.is_active) {
      console.log('❌ User account is inactive');
      res.status(401).json({
        error: 'Account is inactive',
        code: 'ACCOUNT_INACTIVE'
      });
      return;
    }

    // Guard: account has no password (e.g. Google OAuth only)
    if (!userCheck.password) {
      console.log('❌ Account has no password (OAuth-only account)');
      res.status(401).json({
        error: 'This account uses Google login. Please sign in with Google.',
        code: 'NO_PASSWORD'
      });
      return;
    }

    // Verify password
    console.log('🔍 Step 2: Verifying password...');
    const isValidPassword = await bcrypt.compare(password, userCheck.password);

    if (!isValidPassword) {
      console.log('❌ Invalid password');
      recordFailedAttempt(email.toLowerCase());
      const after = loginAttempts.get(email.toLowerCase());
      const remaining = MAX_ATTEMPTS - (after?.attempts || 0);
      res.status(401).json({
        error: remaining > 0
          ? `Invalid email or password. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`
          : `Too many failed attempts. Account locked for 5 minutes.`,
        code: 'INVALID_CREDENTIALS'
      });
      return;
    }

    // Get user with company info
    console.log('🔍 Step 3: Getting user with company...');
    const { data: user, error: userError } = await supabase
      .from('users')
      .select(`
        *,
        companies!inner(*)
      `)
      .eq('email', email.toLowerCase())
      .eq('is_active', true)
      .single();

    if (userError) {
      console.log('❌ Error getting user with company:', userError.message);
      // If company join fails, still allow login but without company data
      const basicUser = { ...userCheck, companies: null };
      const token = generateToken(basicUser, 'client');
      const { password: _, ...userWithoutPassword } = basicUser;

      res.json({
        message: 'Login successful (no company data)',
        user: userWithoutPassword,
        company: null,
        subscription: null,
        token,
        userType: 'client'
      });
      return;
    }

    // Update last login
    await supabase
      .from('users')
      .update({ last_login: new Date().toISOString() })
      .eq('id', user.id);

    // Get subscription
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('company_id', user.company_id)
      .single();

    clearAttempts(email.toLowerCase());
    const token = generateToken(user, 'client');
    const { password: _, ...userWithoutPassword } = user;

    console.log('✅ Login successful for:', user.email);

    res.json({
      message: 'Login successful',
      user: userWithoutPassword,
      company: user.companies,
      subscription: subscription,
      token,
      userType: 'client'
    });

  } catch (error) {
    const err = error as Error;
    console.error('❌ Login error:', err.name, err.message, err.stack);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
}

async function superAdminLogin(req: Request, res: Response): Promise<void> {
  try {
    const { email, password } = req.body;

    console.log(`👑 Super admin login attempt: ${email}`);

    if (!email || !password) {
      res.status(400).json({
        error: 'Email and password are required',
        code: 'MISSING_CREDENTIALS'
      });
      return;
    }

    const supabase = getDb();

    const { data: admin, error } = await supabase
      .from('super_admins')
      .select('*')
      .eq('email', email.toLowerCase())
      .eq('is_active', true)
      .single();

    if (error || !admin) {
      console.log(`❌ Super admin not found: ${email}`);
      res.status(401).json({
        error: 'Invalid admin credentials',
        code: 'INVALID_ADMIN_CREDENTIALS'
      });
      return;
    }

    const isValidPassword = await bcrypt.compare(password, admin.password);
    if (!isValidPassword) {
      console.log(`❌ Invalid password for super admin ${email}`);
      res.status(401).json({
        error: 'Invalid admin credentials',
        code: 'INVALID_ADMIN_CREDENTIALS'
      });
      return;
    }

    await supabase
      .from('super_admins')
      .update({ last_login: new Date().toISOString() })
      .eq('id', admin.id);

    const token = generateToken(admin, 'super_admin');
    const { password: _, ...adminWithoutPassword } = admin;

    console.log(`✅ Super admin logged in: ${admin.email}`);

    res.json({
      message: 'Super admin login successful',
      user: adminWithoutPassword,
      token,
      userType: 'super_admin'
    });

  } catch (error) {
    const err = error as Error;
    console.error('Super admin login error:', err.message);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
}

function logout(_req: Request, res: Response): void {
  console.log('✅ Logout request processed');
  res.json({
    message: 'Logout successful',
    code: 'LOGOUT_SUCCESS'
  });
}

export {
  clientLogin,
  superAdminLogin,
  logout
};
