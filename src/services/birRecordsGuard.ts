// src/services/birRecordsGuard.ts
// BIR: invoices of a registered POS / e-invoices are tax records — never hard-deleted (Invoicing plan P0-8).
// Permanently deleting a company is kept for sign-ups, tests and demo accounts; it is refused once the company
// has a BIR-registered store (PTU), a store on e-invoice, or any e-invoice sent to TaxTrail.
// (Sales of an unregistered store print "SALES RECEIPT … not a BIR-registered invoice", so they don't lock it.)
import { getDb } from '../config/database';

export interface BirLockFacts { ptuStores: string[]; eisStores: string[]; einvoices: number }

export function describeBirLock(f: BirLockFacts): string | null {
  const why: string[] = [];
  if (f.ptuStores.length) why.push(`BIR-registered POS (PTU) at ${f.ptuStores.join(', ')}`);
  if (f.eisStores.length) why.push(`e-invoicing on at ${f.eisStores.join(', ')}`);
  if (f.einvoices > 0) why.push(`${f.einvoices} e-invoice${f.einvoices > 1 ? 's' : ''} sent to TaxTrail`);
  if (!why.length) return null;
  return `This company has BIR tax records (${why.join('; ')}). Invoices must be kept, so it can't be permanently deleted. Deactivate it instead.`;
}

export async function birRecordsLock(companyId: string): Promise<string | null> {
  const db = getDb();
  const { data: stores, error } = await db.from('stores').select('name, ptu_number, invoicing_mode').eq('company_id', companyId);
  if (error) throw error;
  const list = (stores || []) as Array<{ name: string; ptu_number: string | null; invoicing_mode: string | null }>;
  // eis_invoices may not exist yet (before the e-invoice migrations) → count as none
  const { data: einv, error: einvErr } = await db.from('eis_invoices').select('id').eq('company_id', companyId).limit(1000);
  return describeBirLock({
    ptuStores: list.filter((s) => s.ptu_number && String(s.ptu_number).trim()).map((s) => s.name),
    eisStores: list.filter((s) => s.invoicing_mode === 'eis').map((s) => s.name),
    einvoices: einvErr ? 0 : (einv || []).length,
  });
}
