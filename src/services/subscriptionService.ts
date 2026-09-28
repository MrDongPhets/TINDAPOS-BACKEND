// src/services/subscriptionService.ts
// Keeps the `subscriptions` row (read by feature gating: plan_name + features)
// in sync with `companies.subscription_plan` (written by admin activation + PayMongo webhook).
import { getDb } from '../config/database';

interface PlanConfig {
  max_stores: number;
  price_amount: number;
  features: { pos: boolean; reports: boolean; inventory: boolean; multi_store: boolean };
}

const PLAN_CONFIG: Record<string, PlanConfig> = {
  negosyo: {
    max_stores: 1,
    price_amount: 299,
    features: { pos: true, reports: false, inventory: true, multi_store: false },
  },
  'laking-negosyo': {
    max_stores: 5,
    price_amount: 599,
    features: { pos: true, reports: true, inventory: true, multi_store: true },
  },
  // Legacy plan IDs (backward compat)
  basic: {
    max_stores: 1,
    price_amount: 0,
    features: { pos: true, reports: false, inventory: true, multi_store: false },
  },
  standard: {
    max_stores: 3,
    price_amount: 0,
    features: { pos: true, reports: true, inventory: true, multi_store: true },
  },
  trial: {
    max_stores: 1,
    price_amount: 0,
    features: { pos: true, reports: true, inventory: true, multi_store: false },
  },
};

async function syncSubscription(
  companyId: string,
  planName: string,
  periodEnd: Date,
  status: 'active' | 'expired' = 'active'
): Promise<void> {
  const supabase = getDb();
  const config = PLAN_CONFIG[planName] ?? PLAN_CONFIG.basic;
  const now = new Date().toISOString();

  const row = {
    plan_name: planName,
    status,
    price_amount: config.price_amount,
    currency: 'PHP',
    max_stores: config.max_stores,
    features: config.features,
    current_period_start: now,
    current_period_end: periodEnd.toISOString(),
    trial_ends_at: planName === 'trial' ? periodEnd.toISOString() : null,
    updated_at: now,
  };

  // No unique constraint on company_id — update the existing row(s), insert if none
  const { data: existing, error: findError } = await supabase
    .from('subscriptions')
    .select('id')
    .eq('company_id', companyId)
    .limit(1);

  if (findError) throw findError;

  const { error } = existing && existing.length > 0
    ? await supabase.from('subscriptions').update(row).eq('company_id', companyId)
    : await supabase.from('subscriptions').insert([{ company_id: companyId, plan_type: 'monthly', ...row }]);

  if (error) throw error;

  console.log(`✅ Subscription row synced: company=${companyId} plan=${planName} status=${status}`);
}

async function expireSubscription(companyId: string): Promise<void> {
  const supabase = getDb();
  const { error } = await supabase
    .from('subscriptions')
    .update({ status: 'expired', updated_at: new Date().toISOString() })
    .eq('company_id', companyId);

  if (error) throw error;
}

// Effective subscription derived from `companies` (the source of truth for plan + status).
// Returned in the same shape as a `subscriptions` row so login / auth/me / plan gating stay unchanged.
// Many companies have no `subscriptions` row at all, so never rely on that table alone.
async function getEffectiveSubscription(companyId: string): Promise<Record<string, any> | null> {
  const supabase = getDb();

  const { data: existing } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('company_id', companyId)
    .limit(1);
  const row = existing?.[0] ?? null;

  // Desktop/offline mode keeps its own subscriptions row (plan: 'offline')
  if (process.env.DB_MODE === 'sqlite') return row;

  const { data: company } = await supabase
    .from('companies')
    .select('subscription_plan, subscription_status, trial_end_date, subscription_end_date')
    .eq('id', companyId)
    .single();

  if (!company) return row;

  const isTrial = company.subscription_status === 'trial';
  const planName = isTrial ? 'trial' : (company.subscription_plan || 'basic');
  const config = PLAN_CONFIG[planName] ?? PLAN_CONFIG.basic;

  return {
    ...(row || {}),
    company_id: companyId,
    plan_name: planName,
    status: company.subscription_status === 'active' || isTrial ? 'active' : 'expired',
    max_stores: config.max_stores,
    features: config.features,
    trial_ends_at: company.trial_end_date,
    current_period_end: isTrial ? company.trial_end_date : company.subscription_end_date,
  };
}

export { PLAN_CONFIG, syncSubscription, expireSubscription, getEffectiveSubscription };
