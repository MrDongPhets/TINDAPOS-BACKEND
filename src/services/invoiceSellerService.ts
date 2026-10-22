// src/services/invoiceSellerService.ts
// Seller details printed on an invoice (RR 7-2024): registered name, trade name, address, TIN + branch code,
// VAT status, and the POS registration (PTU / MIN / MSN). Built on the server so every invoice — owner or
// staff, POS or reprint — shows the same BIR data. Invoicing plan P0-4.
import { getDb } from '../config/database';

type Db = ReturnType<typeof getDb>;

export interface InvoiceSeller {
  registered_name: string;
  trade_name: string | null;
  address: string | null;
  tin: string | null;            // 9 digits
  branch_code: string;           // 5 digits
  vat_status: 'vat' | 'non_vat' | 'rbe';
  ptu_number: string | null;
  min_number: string | null;
  msn_number: string | null;
  store_name: string | null;
  store_phone: string | null;
}

type CompanyRow = { name: string; address: string | null; tin: string | null; vat_status: string | null; bir_registered_name: string | null; bir_trade_name: string | null; bir_registered_address: string | null };
type StoreRow = { name: string; address: string | null; phone: string | null; branch_code: string | null; ptu_number: string | null; min_number: string | null; msn_number: string | null };

export function toInvoiceSeller(company: CompanyRow, store: StoreRow | null): InvoiceSeller {
  const vat = company.vat_status === 'non_vat' || company.vat_status === 'rbe' ? company.vat_status : 'vat';
  return {
    registered_name: company.bir_registered_name || company.name,
    trade_name: company.bir_trade_name || null,
    address: company.bir_registered_address || store?.address || company.address || null,
    tin: company.tin || null,
    branch_code: store?.branch_code || '00000',
    vat_status: vat,
    ptu_number: store?.ptu_number || null,
    min_number: store?.min_number || null,
    msn_number: store?.msn_number || null,
    store_name: store?.name || null,
    store_phone: store?.phone || null,
  };
}

// Never throws — an invoice without server seller data falls back to what the app has cached
export async function getInvoiceSeller(db: Db, companyId: string, storeId: string | null): Promise<InvoiceSeller | null> {
  try {
    const [{ data: companies }, { data: stores }] = await Promise.all([
      db.from('companies')
        .select('name, address, tin, vat_status, bir_registered_name, bir_trade_name, bir_registered_address')
        .eq('id', companyId).limit(1),
      storeId
        ? db.from('stores').select('name, address, phone, branch_code, ptu_number, min_number, msn_number').eq('id', storeId).eq('company_id', companyId).limit(1)
        : Promise.resolve({ data: [] as StoreRow[] }),
    ]);
    const company = companies?.[0] as CompanyRow | undefined;
    if (!company) return null;
    return toInvoiceSeller(company, (stores?.[0] as StoreRow | undefined) || null);
  } catch (error) {
    console.error('⚠️ Could not load invoice seller details:', error);
    return null;
  }
}
