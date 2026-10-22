// src/controllers/client/einvoicesController.ts
// Owner's e-invoice status (Invoicing plan P2-8)
//   GET  /client/einvoices?filter=attention|pending|all&limit=50 → { items, counts, attention, pending }
//   POST /client/einvoices/:id/retry                               → { einvoice }
import { Request, Response } from 'express';
import { listCompanyEinvoices, retryEinvoice, RetryError } from '../../services/eis/eisIssuer';

export async function getEinvoices(req: Request, res: Response): Promise<void> {
  try {
    const f = String(req.query.filter || 'attention');
    const filter = (['attention', 'pending', 'all'].includes(f) ? f : 'attention') as 'attention' | 'pending' | 'all';
    res.json(await listCompanyEinvoices(req.user!.company_id as string, { filter, limit: Number(req.query.limit) || 50 }));
  } catch (error) {
    console.error('❌ getEinvoices error:', error);
    res.status(500).json({ error: 'Failed to load e-invoices', code: 'EINVOICES_ERROR' });
  }
}

export async function retryEinvoiceHandler(req: Request, res: Response): Promise<void> {
  try {
    const einvoice = await retryEinvoice(req.user!.company_id as string, String(req.params.id));
    res.json({ einvoice });
  } catch (error) {
    if (error instanceof RetryError) {
      res.status(error.code === 'NOT_FOUND' ? 404 : error.code === 'STILL_INVALID' ? 422 : 409).json({ error: error.message, code: error.code });
      return;
    }
    console.error('❌ retryEinvoice error:', error);
    res.status(500).json({ error: 'Failed to retry the e-invoice', code: 'EINVOICES_ERROR' });
  }
}
