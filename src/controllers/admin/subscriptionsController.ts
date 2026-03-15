// src/controllers/admin/subscriptionsController.ts
import { Request, Response } from 'express';
import { getDb } from '../../config/database';

// List all companies with subscription info
async function getSubscriptions(req: Request, res: Response): Promise<void> {
  try {
    const supabase = getDb();

    const { data: companies, error } = await supabase
      .from('companies')
      .select('id, name, contact_email, subscription_status, trial_end_date, subscription_end_date, is_active, created_at')
      .order('created_at', { ascending: false });

    if (error) throw error;

    const now = new Date();
    const enriched = (companies || []).map((c: any) => {
      let daysLeft: number | null = null;
      const endDate = c.subscription_status === 'active'
        ? c.subscription_end_date
        : c.trial_end_date;
      if (endDate) {
        daysLeft = Math.ceil((new Date(endDate).getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      }
      return { ...c, days_left: daysLeft };
    });

    res.json({ companies: enriched, count: enriched.length });
  } catch (error) {
    console.error('Get subscriptions error:', error);
    res.status(500).json({ error: 'Failed to fetch subscriptions', code: 'SUBSCRIPTIONS_ERROR' });
  }
}

// Activate subscription for a company (set active + end date)
async function activateSubscription(req: Request, res: Response): Promise<void> {
  try {
    const { company_id, months = 1, plan = 'basic' } = req.body;
    if (!company_id) {
      res.status(400).json({ error: 'company_id is required', code: 'MISSING_FIELDS' });
      return;
    }

    const supabase = getDb();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + Number(months));

    const { error } = await supabase
      .from('companies')
      .update({
        subscription_status: 'active',
        subscription_end_date: endDate.toISOString(),
        subscription_plan: plan,
        updated_at: new Date().toISOString()
      })
      .eq('id', company_id);

    if (error) throw error;

    console.log(`✅ Subscription activated for company ${company_id} (${plan}) until ${endDate.toISOString()}`);
    res.json({
      message: 'Subscription activated successfully',
      subscription_end_date: endDate.toISOString(),
      months_added: months,
      plan
    });
  } catch (error) {
    console.error('Activate subscription error:', error);
    res.status(500).json({ error: 'Failed to activate subscription', code: 'ACTIVATE_ERROR' });
  }
}

// Deactivate (expire) subscription for a company
async function deactivateSubscription(req: Request, res: Response): Promise<void> {
  try {
    const { company_id } = req.body;
    if (!company_id) {
      res.status(400).json({ error: 'company_id is required', code: 'MISSING_FIELDS' });
      return;
    }

    const supabase = getDb();
    const { error } = await supabase
      .from('companies')
      .update({
        subscription_status: 'expired',
        updated_at: new Date().toISOString()
      })
      .eq('id', company_id);

    if (error) throw error;

    console.log(`✅ Subscription deactivated for company ${company_id}`);
    res.json({ message: 'Subscription deactivated successfully' });
  } catch (error) {
    console.error('Deactivate subscription error:', error);
    res.status(500).json({ error: 'Failed to deactivate subscription', code: 'DEACTIVATE_ERROR' });
  }
}

// Extend trial for a company
async function extendTrial(req: Request, res: Response): Promise<void> {
  try {
    const { company_id, days = 30 } = req.body;
    if (!company_id) {
      res.status(400).json({ error: 'company_id is required', code: 'MISSING_FIELDS' });
      return;
    }

    const supabase = getDb();
    const { data: company } = await supabase
      .from('companies')
      .select('trial_end_date')
      .eq('id', company_id)
      .single();

    const baseDate = company?.trial_end_date && new Date(company.trial_end_date) > new Date()
      ? new Date(company.trial_end_date)
      : new Date();

    baseDate.setDate(baseDate.getDate() + Number(days));

    const { error } = await supabase
      .from('companies')
      .update({
        subscription_status: 'trial',
        trial_end_date: baseDate.toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', company_id);

    if (error) throw error;

    console.log(`✅ Trial extended for company ${company_id} until ${baseDate.toISOString()}`);
    res.json({ message: 'Trial extended successfully', trial_end_date: baseDate.toISOString() });
  } catch (error) {
    console.error('Extend trial error:', error);
    res.status(500).json({ error: 'Failed to extend trial', code: 'EXTEND_TRIAL_ERROR' });
  }
}

export { getSubscriptions, activateSubscription, deactivateSubscription, extendTrial };
