// src/controllers/eis/eisWebhookController.ts
// POST /eis/webhooks/taxtrail/:companyId — BIR status updates from ITBS TaxTrail (Invoicing plan P2-6).
// No login: the HMAC signature (secret Tindapo got when it registered the webhook) is the authentication.
import { Request, Response } from 'express';
import { handleTaxTrailEvent, verifyTaxTrailSignature, webhookSecrets, type TaxTrailEvent } from '../../services/eis/eisStatus';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function receiveTaxTrailWebhook(req: Request, res: Response): Promise<void> {
  const companyId = String(req.params.companyId);
  const rawBody = (req as Request & { rawBody?: string }).rawBody;
  // Same answer for every auth failure (don't reveal which companies exist)
  const refuse = () => { res.status(401).json({ error: 'Invalid signature' }); };
  try {
    if (!UUID.test(companyId) || typeof rawBody !== 'string') return refuse();
    const secrets = await webhookSecrets(companyId);
    if (!secrets || !verifyTaxTrailSignature(req.header('x-taxtrail-signature'), rawBody, secrets)) return refuse();

    const ev = req.body as TaxTrailEvent;
    if (!ev?.id || !ev?.type) { res.status(400).json({ error: 'Not a TaxTrail event' }); return; }
    const result = await handleTaxTrailEvent(companyId, ev);
    console.log(`🧾 TaxTrail ${ev.type} ${ev.id} → ${result}`);
    res.json({ received: true, result });
  } catch (error) {
    // 5xx → TaxTrail retries the same event later
    console.error('❌ TaxTrail webhook error:', (error as Error).message);
    res.status(500).json({ error: 'Could not process the event' });
  }
}
