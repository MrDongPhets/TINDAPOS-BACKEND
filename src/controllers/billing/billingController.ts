import { Request, Response } from 'express';
import crypto from 'crypto';
import { getDb } from '../../config/database';

const PAYMONGO_BASE = 'https://api.paymongo.com/v1';

const PLANS: Record<string, { name: string; amount: number; months: number }> = {
  'negosyo-monthly':       { name: 'Negosyo Plan – 1 Month',        amount: 29900, months: 1 },
  'negosyo-quarterly':     { name: 'Negosyo Plan – 3 Months',       amount: 84900, months: 3 },
  'laking-negosyo-monthly':    { name: 'Laking Negosyo Plan – 1 Month',    amount: 59900, months: 1 },
  'laking-negosyo-quarterly':  { name: 'Laking Negosyo Plan – 3 Months',   amount: 169900, months: 3 },
};

function paymongoAuth() {
  const key = process.env.PAYMONGO_SECRET_KEY || '';
  return 'Basic ' + Buffer.from(key + ':').toString('base64');
}

// POST /billing/create-checkout
export async function createCheckout(req: Request, res: Response): Promise<void> {
  try {
    const { price_key } = req.body; // e.g. 'negosyo-monthly'
    const plan = PLANS[price_key];
    if (!plan) {
      res.status(400).json({ error: 'Invalid plan selected' });
      return;
    }

    const db = getDb();
    const { data: company } = await db
      .from('companies')
      .select('id, name, contact_email, subscription_plan')
      .eq('id', req.user!.company_id)
      .single();

    if (!company) {
      res.status(404).json({ error: 'Company not found' });
      return;
    }

    const frontendUrl = process.env.FRONTEND_URL || 'https://kitapos.mrdongphets.com';
    const planId = price_key.startsWith('laking') ? 'laking-negosyo' : 'negosyo';

    const body = {
      data: {
        attributes: {
          billing: {
            name: company.name,
            email: company.contact_email,
          },
          line_items: [{
            currency: 'PHP',
            amount: plan.amount,
            name: plan.name,
            quantity: 1,
          }],
          payment_method_types: ['gcash', 'paymaya', 'card', 'dob', 'dob_ubp', 'qrph'],
          success_url: `${frontendUrl}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${frontendUrl}/subscription-expired?cancelled=1`,
          metadata: {
            company_id: company.id,
            plan: planId,
            months: String(plan.months),
          },
        },
      },
    };

    const pmRes = await fetch(`${PAYMONGO_BASE}/checkout_sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': paymongoAuth(),
      },
      body: JSON.stringify(body),
    });

    const pmData = await pmRes.json() as any;
    if (!pmRes.ok) {
      console.error('❌ PayMongo error:', pmData);
      res.status(502).json({ error: 'Failed to create payment session', detail: pmData.errors?.[0]?.detail });
      return;
    }

    const checkoutUrl = pmData.data?.attributes?.checkout_url;
    console.log(`✅ PayMongo checkout created for ${company.name} → ${price_key}`);
    res.json({ checkout_url: checkoutUrl, session_id: pmData.data?.id });
  } catch (error) {
    console.error('❌ createCheckout error:', error);
    res.status(500).json({ error: 'Failed to create payment session' });
  }
}

// GET /billing/status?session_id=xxx
export async function getBillingStatus(req: Request, res: Response): Promise<void> {
  try {
    const { session_id } = req.query;
    if (!session_id) {
      res.status(400).json({ error: 'session_id is required' });
      return;
    }

    const pmRes = await fetch(`${PAYMONGO_BASE}/checkout_sessions/${session_id}`, {
      headers: { 'Authorization': paymongoAuth() },
    });

    const pmData = await pmRes.json() as any;
    if (!pmRes.ok) {
      res.status(502).json({ error: 'Failed to retrieve payment status' });
      return;
    }

    const status = pmData.data?.attributes?.payment_intent?.attributes?.status || 'pending';
    const metadata = pmData.data?.attributes?.metadata || {};
    const paid = status === 'succeeded';

    // If paid, also return updated subscription info
    if (paid) {
      const db = getDb();
      const { data: company } = await db
        .from('companies')
        .select('subscription_status, subscription_end_date, subscription_plan')
        .eq('id', req.user!.company_id)
        .single();
      res.json({ paid, status, company, metadata });
    } else {
      res.json({ paid, status, metadata });
    }
  } catch (error) {
    console.error('❌ getBillingStatus error:', error);
    res.status(500).json({ error: 'Failed to get billing status' });
  }
}

// POST /billing/webhook  (no auth — called by PayMongo)
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  try {
    // Verify signature
    const sigHeader = req.headers['paymongo-signature'] as string;
    const webhookSecret = process.env.PAYMONGO_WEBHOOK_SECRET || '';

    if (sigHeader && webhookSecret) {
      const parts: Record<string, string> = {};
      sigHeader.split(',').forEach(part => {
        const [k, v] = part.split('=');
        parts[k] = v;
      });

      const timestamp = parts['t'];
      const rawBody = (req as any).rawBody as string;
      const toSign = timestamp + '.' + rawBody;
      const computed = crypto.createHmac('sha256', webhookSecret).update(toSign).digest('hex');
      const signature = parts['te'] || parts['li'];

      if (signature && !crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(signature))) {
        console.warn('⚠️ PayMongo webhook: invalid signature');
        res.status(400).json({ error: 'Invalid signature' });
        return;
      }
    }

    const event = req.body;
    const eventType = event?.data?.attributes?.type;

    if (eventType !== 'checkout_session.payment.paid') {
      res.json({ received: true });
      return;
    }

    const sessionData = event?.data?.attributes?.data;
    const metadata = sessionData?.attributes?.metadata || {};
    const { company_id, plan, months } = metadata;

    if (!company_id || !plan || !months) {
      console.warn('⚠️ Webhook missing metadata:', metadata);
      res.json({ received: true });
      return;
    }

    // Activate subscription
    const db = getDb();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + Number(months));

    const { error } = await db
      .from('companies')
      .update({
        subscription_status: 'active',
        subscription_plan: plan,
        subscription_end_date: endDate.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', company_id);

    if (error) {
      console.error('❌ Webhook: failed to activate subscription:', error);
      res.status(500).json({ error: 'DB update failed' });
      return;
    }

    console.log(`✅ Subscription auto-activated via webhook: company=${company_id} plan=${plan} until=${endDate.toISOString()}`);
    res.json({ received: true });
  } catch (error) {
    console.error('❌ handleWebhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
}
