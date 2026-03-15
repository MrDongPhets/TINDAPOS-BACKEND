import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import { getDb } from '../../config/database';

const resend = new Resend(process.env.RESEND_API_KEY);
const JWT_SECRET = process.env.JWT_SECRET as string;
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const FROM_EMAIL = process.env.FROM_EMAIL || 'TindaPOS <onboarding@resend.dev>';

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  try {
    const { email } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email is required' });
      return;
    }

    const supabase = getDb();

    // Find user by email
    const { data: user } = await supabase
      .from('users')
      .select('id, email, name')
      .eq('email', email.toLowerCase())
      .eq('is_active', true)
      .single();

    // Always respond with success to prevent email enumeration
    if (!user) {
      console.log(`🔍 Forgot password: no account for ${email}`);
      res.json({ message: 'If an account exists, a reset link has been sent.' });
      return;
    }

    // Generate a 1-hour reset token
    const resetToken = jwt.sign(
      { id: user.id, email: user.email, purpose: 'password_reset' },
      JWT_SECRET,
      { expiresIn: '1h' }
    );

    const resetLink = `${FRONTEND_URL}/reset-password?token=${encodeURIComponent(resetToken)}`;

    console.log(`📧 Sending password reset email to: ${user.email}`);

    await resend.emails.send({
      from: FROM_EMAIL,
      to: user.email,
      subject: 'Reset your TindaPOS password',
      html: `
        <div style="font-family: 'Inter', Arial, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; background: #ffffff;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="font-size: 24px; font-weight: 700; color: #1A1A2E; margin: 0;">TindaPOS</h1>
            <p style="color: #6B7280; margin: 4px 0 0;">Ang POS para sa bawat tindahan.</p>
          </div>

          <h2 style="font-size: 20px; font-weight: 600; color: #1A1A2E; margin: 0 0 8px;">Reset your password</h2>
          <p style="color: #6B7280; margin: 0 0 24px;">
            Hi ${user.name || 'there'}, we received a request to reset your TindaPOS password.
            Click the button below to choose a new password.
          </p>

          <a href="${resetLink}" style="display: inline-block; background: #E8302A; color: #ffffff; text-decoration: none; padding: 12px 28px; border-radius: 8px; font-weight: 600; font-size: 15px;">
            Reset Password
          </a>

          <p style="color: #9CA3AF; font-size: 13px; margin: 24px 0 0;">
            This link expires in <strong>1 hour</strong>. If you didn't request a password reset, you can safely ignore this email.
          </p>

          <hr style="border: none; border-top: 1px solid #F0F0F5; margin: 32px 0 16px;" />
          <p style="color: #9CA3AF; font-size: 12px; margin: 0;">
            © 2026 Mustard Digitals · TindaPOS
          </p>
        </div>
      `,
    });

    console.log(`✅ Reset email sent to: ${user.email}`);
    res.json({ message: 'If an account exists, a reset link has been sent.' });
  } catch (error) {
    console.error('❌ Forgot password error:', error);
    res.status(500).json({ error: 'Failed to send reset email. Please try again.' });
  }
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  try {
    const { token, password } = req.body;

    if (!token || !password) {
      res.status(400).json({ error: 'Token and new password are required' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters' });
      return;
    }

    // Verify the reset token
    let payload: { id: string; email: string; purpose: string };
    try {
      payload = jwt.verify(token, JWT_SECRET) as typeof payload;
    } catch {
      res.status(400).json({ error: 'Reset link is invalid or has expired.' });
      return;
    }

    if (payload.purpose !== 'password_reset') {
      res.status(400).json({ error: 'Invalid reset token.' });
      return;
    }

    const supabase = getDb();

    // Hash new password and update
    const hashedPassword = await bcrypt.hash(password, 10);
    const { error: updateError } = await supabase
      .from('users')
      .update({ password: hashedPassword })
      .eq('id', payload.id)
      .eq('is_active', true);

    if (updateError) {
      console.error('❌ Password update error:', updateError.message);
      res.status(500).json({ error: 'Failed to update password. Please try again.' });
      return;
    }

    console.log(`✅ Password reset successful for user: ${payload.email}`);
    res.json({ message: 'Password updated successfully. You can now log in.' });
  } catch (error) {
    console.error('❌ Reset password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
