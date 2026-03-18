import { Request, Response } from 'express';
import { getDb } from '../../config/database';
import { generateToken } from '../../services/tokenService';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

function getRedirectUri(): string {
  return process.env.GOOGLE_REDIRECT_URI
    || (process.env.NODE_ENV === 'production'
      ? 'https://tindaposapp.mustarddigitals.com/auth/google/callback'
      : 'http://localhost:3001/auth/google/callback');
}

function getFrontendUrl(): string {
  return process.env.FRONTEND_URL || 'http://localhost:3000';
}

export function googleRedirect(_req: Request, res: Response): void {
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: 'openid email profile',
    access_type: 'offline',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
}

export async function googleCallback(req: Request, res: Response): Promise<void> {
  const { code, error } = req.query;
  const frontendUrl = getFrontendUrl();

  if (error || !code) {
    res.redirect(`${frontendUrl}/login?error=google_cancelled`);
    return;
  }

  try {
    // Exchange code for access token
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: getRedirectUri(),
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json() as { access_token?: string; error?: string };

    if (!tokenData.access_token) {
      console.error('❌ Google token exchange failed:', tokenData);
      res.redirect(`${frontendUrl}/login?error=google_token_failed`);
      return;
    }

    // Get Google user info
    const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser = await userRes.json() as { email: string; name: string };

    console.log(`🔐 Google login attempt: ${googleUser.email}`);

    const supabase = getDb();

    // Find existing user by email
    const { data: user } = await supabase
      .from('users')
      .select('*, companies!inner(*)')
      .eq('email', googleUser.email.toLowerCase())
      .eq('is_active', true)
      .single();

    if (!user) {
      // No account found — send to register with pre-filled info
      console.log(`❌ No account for Google user: ${googleUser.email}`);
      const params = new URLSearchParams({
        google: 'true',
        email: googleUser.email,
        name: googleUser.name,
      });
      res.redirect(`${frontendUrl}/register?${params}`);
      return;
    }

    // Update last login
    await supabase.from('users').update({ last_login: new Date().toISOString() }).eq('id', user.id);

    const token = generateToken(user, 'client');
    console.log(`✅ Google login successful: ${user.email}`);

    res.redirect(`${frontendUrl}/login?token=${encodeURIComponent(token)}`);
  } catch (err) {
    console.error('❌ Google OAuth callback error:', err);
    res.redirect(`${frontendUrl}/login?error=google_error`);
  }
}
