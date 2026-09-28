// src/controllers/admin/subscriptionsController.ts
import { Request, Response } from 'express';
import { getDb } from '../../config/database';
import { syncSubscription, expireSubscription, PLAN_CONFIG } from '../../services/subscriptionService';

// List all companies with subscription info
async function getSubscriptions(req: Request, res: Response): Promise<void> {
  try {
    const supabase = getDb();

    const { data: companies, error } = await supabase
      .from('companies')
      .select('id, name, contact_email, subscription_status, subscription_plan, trial_end_date, subscription_end_date, is_active, created_at')
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
      // Stored status only flips to 'expired' on the company's next request (requireActiveSubscription),
      // so show the effective status here to keep the list and stats accurate
      const isLapsed = (c.subscription_status === 'active' || c.subscription_status === 'trial')
        && !!endDate && new Date(endDate) <= now;
      return { ...c, subscription_status: isLapsed ? 'expired' : c.subscription_status, days_left: daysLeft };
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

    await syncSubscription(company_id, plan, endDate);

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

    await expireSubscription(company_id);

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

    await syncSubscription(company_id, 'trial', baseDate);

    console.log(`✅ Trial extended for company ${company_id} until ${baseDate.toISOString()}`);
    res.json({ message: 'Trial extended successfully', trial_end_date: baseDate.toISOString() });
  } catch (error) {
    console.error('Extend trial error:', error);
    res.status(500).json({ error: 'Failed to extend trial', code: 'EXTEND_TRIAL_ERROR' });
  }
}

const EDITABLE_STATUSES = ['trial', 'active', 'expired', 'suspended'];

// Edit plan, status, and end dates directly
async function updateSubscription(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const { plan, status, trial_end_date, subscription_end_date } = req.body;

    if (!plan || !PLAN_CONFIG[plan] || plan === 'trial') {
      res.status(400).json({ error: 'Invalid plan', code: 'VALIDATION_ERROR' });
      return;
    }
    if (!EDITABLE_STATUSES.includes(status)) {
      res.status(400).json({ error: 'Invalid status', code: 'VALIDATION_ERROR' });
      return;
    }

    const trialEnd = trial_end_date ? new Date(trial_end_date) : null;
    const subEnd = subscription_end_date ? new Date(subscription_end_date) : null;
    if ((trialEnd && isNaN(trialEnd.getTime())) || (subEnd && isNaN(subEnd.getTime()))) {
      res.status(400).json({ error: 'Invalid date', code: 'VALIDATION_ERROR' });
      return;
    }
    if (status === 'trial' && !trialEnd) {
      res.status(400).json({ error: 'Trial end date is required for trial status', code: 'VALIDATION_ERROR' });
      return;
    }
    if (status === 'active' && !subEnd) {
      res.status(400).json({ error: 'Subscription end date is required for active status', code: 'VALIDATION_ERROR' });
      return;
    }

    const supabase = getDb();
    const { data: updated, error } = await supabase
      .from('companies')
      .update({
        subscription_plan: plan,
        subscription_status: status,
        trial_end_date: trialEnd ? trialEnd.toISOString() : null,
        subscription_end_date: subEnd ? subEnd.toISOString() : null,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select('id');

    if (error) throw error;
    if (!updated || updated.length === 0) {
      res.status(404).json({ error: 'Company not found', code: 'NOT_FOUND' });
      return;
    }

    if (status === 'active') await syncSubscription(id, plan, subEnd!);
    else if (status === 'trial') await syncSubscription(id, 'trial', trialEnd!);
    else await expireSubscription(id);

    console.log(`✅ Subscription updated for company ${id}: ${plan} / ${status}`);
    res.json({ message: 'Subscription updated successfully' });
  } catch (error) {
    console.error('❌ Update subscription error:', error);
    res.status(500).json({ error: 'Failed to update subscription', code: 'UPDATE_ERROR' });
  }
}

// Soft delete — hides the company and blocks login, keeps all data (restorable)
async function deleteCompany(req: Request, res: Response): Promise<void> {
  await setCompanyActive(req, res, false);
}

async function restoreCompany(req: Request, res: Response): Promise<void> {
  await setCompanyActive(req, res, true);
}

async function setCompanyActive(req: Request, res: Response, isActive: boolean): Promise<void> {
  const action = isActive ? 'restore' : 'delete';
  try {
    const id = req.params.id as string;
    const supabase = getDb();

    const { data: updated, error } = await supabase
      .from('companies')
      .update({ is_active: isActive, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, name');

    if (error) throw error;
    if (!updated || updated.length === 0) {
      res.status(404).json({ error: 'Company not found', code: 'NOT_FOUND' });
      return;
    }

    console.log(`✅ Company ${isActive ? 'restored' : 'soft-deleted'}: ${updated[0].name} (${id})`);
    res.json({ message: `Company ${isActive ? 'restored' : 'deleted'} successfully` });
  } catch (error) {
    console.error(`❌ ${action} company error:`, error);
    res.status(500).json({ error: `Failed to ${action} company`, code: `${action.toUpperCase()}_ERROR` });
  }
}

// Permanent delete — removes the company and ALL its data. Requires typing the exact company name.
async function permanentlyDeleteCompany(req: Request, res: Response): Promise<void> {
  try {
    const id = req.params.id as string;
    const { confirm_name } = req.body;
    const supabase = getDb();

    const { data: company, error: findError } = await supabase
      .from('companies')
      .select('id, name')
      .eq('id', id)
      .single();

    if (findError || !company) {
      res.status(404).json({ error: 'Company not found', code: 'NOT_FOUND' });
      return;
    }
    if (confirm_name !== company.name) {
      res.status(400).json({ error: 'Company name does not match', code: 'CONFIRMATION_MISMATCH' });
      return;
    }

    const { error } = await supabase.rpc('admin_delete_company', { p_company_id: id });
    if (error?.code === 'PGRST202') {
      console.error('❌ admin_delete_company function missing — run src/db/migrations/admin_delete_company.sql');
      res.status(500).json({
        error: 'Delete function not installed. Run the admin_delete_company.sql migration in Supabase.',
        code: 'MIGRATION_MISSING'
      });
      return;
    }
    if (error) throw error;

    console.log(`⚠️ Company PERMANENTLY deleted: ${company.name} (${id}) by admin ${req.user!.id}`);
    res.json({ message: 'Company permanently deleted' });
  } catch (error) {
    console.error('❌ Permanent delete company error:', error);
    res.status(500).json({ error: 'Failed to permanently delete company', code: 'PERMANENT_DELETE_ERROR' });
  }
}

export {
  getSubscriptions,
  activateSubscription,
  deactivateSubscription,
  extendTrial,
  updateSubscription,
  deleteCompany,
  restoreCompany,
  permanentlyDeleteCompany,
};
