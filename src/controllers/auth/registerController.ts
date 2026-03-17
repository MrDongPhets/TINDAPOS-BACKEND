import bcrypt from 'bcryptjs';
import { Request, Response } from 'express';
import { getDb } from '../../config/database';
import { BCRYPT_ROUNDS } from '../../config/constants';
import { validateEmail } from '../../utils/emailValidation';

async function registerCompany(req: Request, res: Response): Promise<void> {
  try {
    const { company, user, subscription } = req.body;

    console.log(`🏢 Company registration: ${company?.name}`);

    if (!company?.name || !company?.email || !user?.name || !user?.email || !user?.password) {
      res.status(400).json({
        error: 'Company name, email, user name, email and password are required',
        code: 'MISSING_FIELDS'
      });
      return;
    }

    // Validate company email
    const companyEmailCheck = await validateEmail(company.email);
    if (!companyEmailCheck.valid) {
      res.status(400).json({ error: companyEmailCheck.reason, code: 'INVALID_EMAIL' });
      return;
    }

    // Validate user email (only if different from company email)
    if (user.email.toLowerCase() !== company.email.toLowerCase()) {
      const userEmailCheck = await validateEmail(user.email);
      if (!userEmailCheck.valid) {
        res.status(400).json({ error: userEmailCheck.reason, code: 'INVALID_EMAIL' });
        return;
      }
    }

    const supabase = getDb();

    // Check existing company
    const { data: existingCompany } = await supabase
      .from('companies')
      .select('id')
      .eq('contact_email', company.email.toLowerCase())
      .single();

    if (existingCompany) {
      res.status(409).json({
        error: 'Company with this email already exists',
        code: 'COMPANY_EXISTS'
      });
      return;
    }

    // Check existing user
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', user.email.toLowerCase())
      .single();

    if (existingUser) {
      res.status(409).json({
        error: 'User with this email already exists',
        code: 'USER_EXISTS'
      });
      return;
    }

    const hashedPassword = await bcrypt.hash(user.password, BCRYPT_ROUNDS);

    const trialEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    // Create company
    const { data: newCompany, error: companyError } = await supabase
      .from('companies')
      .insert([{
        name: company.name.trim(),
        description: company.description || `Business using POS system`,
        contact_email: company.email.toLowerCase().trim(),
        contact_phone: company.phone || null,
        address: company.address || null,
        website: company.website || null,
        is_active: true,
        settings: {},
        company_code: Math.random().toString(36).substring(2, 8).toUpperCase(),
        subscription_status: 'trial',
        trial_end_date: trialEndDate,
        subscription_plan: subscription?.plan || 'basic'
      }])
      .select()
      .single();

    if (companyError) {
      console.error('Failed to create company:', companyError.message);
      res.status(400).json({
        error: 'Failed to create company: ' + companyError.message,
        code: 'COMPANY_CREATE_ERROR'
      });
      return;
    }

    // Create user
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert([{
        email: user.email.toLowerCase().trim(),
        password: hashedPassword,
        name: user.name.trim(),
        role: 'manager',
        phone: user.phone || null,
        company_id: newCompany.id,
        is_active: true
      }])
      .select('id, email, name, role, phone, company_id, is_active, created_at')
      .single();

    if (userError) {
      console.error('Failed to create user:', userError.message);
      res.status(400).json({
        error: 'Failed to create user account: ' + userError.message,
        code: 'USER_CREATE_ERROR'
      });
      return;
    }

    console.log(`✅ Company registered: ${newCompany.name} with user: ${newUser.email}`);

    res.status(201).json({
      success: true,
      message: 'Company registered successfully',
      company: newCompany,
      user: newUser
    });

  } catch (error) {
    const err = error as Error;
    console.error('❌ Company registration error:', err.message);
    res.status(500).json({
      error: 'Internal server error during registration',
      code: 'INTERNAL_ERROR'
    });
  }
}

export { registerCompany };
