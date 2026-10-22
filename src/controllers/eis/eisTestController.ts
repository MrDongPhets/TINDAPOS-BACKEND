// src/controllers/eis/eisTestController.ts
// TEST API for an EIS (BIR Electronic Invoicing System) integration: real Tindapo sales → unsigned e-invoice JSON,
// pulled by the EIS system under test the way a middleware polls a POS. Tindapo is NOT EIS-certified — this never
// transmits anything to BIR.
//
// Safe by default:
//   EIS_TEST_API_KEY      unset → every /eis-test route answers 404 (feature off)
//   EIS_TEST_COMPANY_IDS  comma-separated company ids whose sales may be read (e.g. the Demo Bakery demo account);
//                         empty → only the synthetic /samples are available
// Optional seller overrides (Tindapo has no BIR registration data yet):
//   EIS_TEST_CERT_ID (8 chars, default TESTCERT), EIS_TEST_SELLER_TIN (default 000000001 when the company has no 9-digit TIN),
//   EIS_TEST_BRANCH_CD (00000), EIS_TEST_SELLER_TYPE ('0' VAT [default, matches Tindapo receipts], '1' Non-VAT, '2' RBE),
//   EIS_TEST_PTU / EIS_TEST_MIN / EIS_TEST_MSN (Permit To Use, Machine ID and Serial numbers — mandatory for CRM/POS)
import { timingSafeEqual } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { getDb } from '../../config/database';
import { buildEisInvoice, idsForSale, type EisSaleItem, type EisSeller, type TindapoDiscountType, type TindapoVatType } from '../../services/eis/eisInvoice';
import { EIS_SPEC_VERSION, MAX_INVOICES_PER_SUBMISSION, SELLER_TYPE } from '../../services/eis/eisSpec';
import { buildTestSet } from '../../services/eis/eisTestCases';

const allowedCompanies = () => (process.env.EIS_TEST_COMPANY_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
const certId = () => process.env.EIS_TEST_CERT_ID || 'TESTCERT';
const sellerType = () => (Object.values(SELLER_TYPE) as string[]).includes(process.env.EIS_TEST_SELLER_TYPE || '')
  ? (process.env.EIS_TEST_SELLER_TYPE as EisSeller['type']) : SELLER_TYPE.VAT;

// X-EIS-Test-Key header must match EIS_TEST_API_KEY (constant-time compare). No key configured → feature off.
export function requireEisTestKey(req: Request, res: Response, next: NextFunction): void {
  const expected = process.env.EIS_TEST_API_KEY;
  if (!expected) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  const given = req.get('x-eis-test-key') || '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    res.status(401).json({ error: 'Invalid or missing X-EIS-Test-Key' });
    return;
  }
  next();
}

type SaleRow = {
  id: string; company_id: string; store_id: string; created_at: string; or_number: string | null; receipt_number: string;
  total_amount: number | string; discount_type: string | null; discount_amount: number | string | null; payment_method: string | null;
};

// Tindapo sales (+ items, products, store, company) → e-invoices
async function toEisPayload(sales: SaleRow[]) {
  if (sales.length === 0) return [];
  const db = getDb();
  const saleIds = sales.map((s) => s.id);

  const { data: items, error: itemsError } = await db
    .from('sales_items')
    .select('sales_id, product_id, quantity, unit_price, discount_amount')
    .in('sales_id', saleIds);
  if (itemsError) throw itemsError;

  const productIds = [...new Set((items || []).map((i: { product_id: string }) => i.product_id))];
  const storeIds = [...new Set(sales.map((s) => s.store_id))];
  const companyIds = [...new Set(sales.map((s) => s.company_id))];
  const [products, stores, companies] = await Promise.all([
    productIds.length ? db.from('products').select('id, name, vat_type').in('id', productIds) : Promise.resolve({ data: [] }),
    db.from('stores').select('id, name, address').in('id', storeIds),
    db.from('companies').select('id, name, tax_id, address, contact_email').in('id', companyIds),
  ]);
  const productMap = new Map((products.data || []).map((p: { id: string }) => [p.id, p]));
  const storeMap = new Map((stores.data || []).map((s: { id: string }) => [s.id, s]));
  const companyMap = new Map((companies.data || []).map((c: { id: string }) => [c.id, c]));

  return sales.map((sale) => {
    const store = storeMap.get(sale.store_id) as { name: string; address: string | null } | undefined;
    const company = companyMap.get(sale.company_id) as { name: string; tax_id: string | null; address: string | null; contact_email: string | null } | undefined;
    const companyTin = (company?.tax_id || '').replace(/\D/g, '');

    const seller: EisSeller = {
      tin: companyTin.length >= 9 ? companyTin.slice(0, 9) : (process.env.EIS_TEST_SELLER_TIN || '000000001'),
      branchCd: process.env.EIS_TEST_BRANCH_CD || '00000',
      type: sellerType(),
      regNm: company?.name || 'TEST SELLER',
      businessNm: store?.name,
      regAddr: store?.address || company?.address || '',
      email: company?.contact_email || undefined,
      ptuNum: process.env.EIS_TEST_PTU || 'TEST-PTU-0001',
      min: process.env.EIS_TEST_MIN || 'TEST-MIN-0001',
      msn: process.env.EIS_TEST_MSN || 'TEST-MSN-0001',
    };

    const saleItems: EisSaleItem[] = (items || [])
      .filter((i: { sales_id: string }) => i.sales_id === sale.id)
      .map((i: { product_id: string; quantity: number; unit_price: number | string; discount_amount: number | string | null }) => {
        const product = productMap.get(i.product_id) as { name: string; vat_type: string | null } | undefined;
        return {
          name: product?.name || 'Item',
          quantity: Number(i.quantity),
          unit_price: Number(i.unit_price),
          discount_amount: Number(i.discount_amount || 0),
          vat_type: (product?.vat_type || 'vatable') as TindapoVatType,
        };
      });

    // Tindapo stores percentage/fixed discounts as a peso amount; SC/PWD keep their type (VAT-exempt rules)
    const scPwd = sale.discount_type === 'senior_citizen' || sale.discount_type === 'pwd';
    const saleDiscount = Number(sale.discount_amount || 0);
    const orNumber = sale.or_number || sale.receipt_number;
    const base = { saleId: sale.id, orNumber, createdAt: sale.created_at, store: store?.name || null, paymentMethod: sale.payment_method || 'cash', tindapoTotal: Number(sale.total_amount) };

    // One bad sale (e.g. old data with no items) must not block the rest of the batch
    let result: ReturnType<typeof buildEisInvoice>;
    try {
      result = buildEisInvoice(
        {
          receipt_no: orNumber,
          issued_at: new Date(sale.created_at),
          items: saleItems,
          discount_type: (scPwd ? sale.discount_type : saleDiscount > 0 ? 'fixed' : null) as TindapoDiscountType,
          discount_value: scPwd ? undefined : saleDiscount,
          remarks: sale.payment_method === 'credit' ? 'Credit sale (utang)' : `Payment: ${sale.payment_method || 'cash'}`,
        },
        seller,
        idsForSale(certId(), orNumber, sale.store_id),
      );
    } catch (err) {
      return { ...base, amountPaid: null, matchesTindapoTotal: false, invoice: null, error: (err as Error).message };
    }

    return {
      ...base,
      amountPaid: result.amountPaid,
      matchesTindapoTotal: Math.abs(result.amountPaid - Number(sale.total_amount)) < 0.01,
      invoice: result.invoice,
    };
  });
}

const SALE_COLUMNS = 'id, company_id, store_id, created_at, or_number, receipt_number, total_amount, discount_type, discount_amount, payment_method';

// GET /eis-test — what's available
export async function getEisTestInfo(_req: Request, res: Response): Promise<void> {
  res.json({
    name: 'Tindapo EIS test API',
    warning: 'TEST ONLY — Tindapo is not EIS-certified. Unsigned JSON; signing, encryption and transmission belong to the EIS system under test.',
    format: 'CRM/POS e-invoice — one document per sale, totals only (no item list)',
    specVersion: EIS_SPEC_VERSION,
    companiesEnabled: allowedCompanies().length,
    endpoints: {
      samples: 'GET /eis-test/samples — synthetic set (valid + invalid cases)',
      invoices: `GET /eis-test/invoices?since=<ISO time>&limit=<1-${MAX_INVOICES_PER_SUBMISSION}>&store_id=<optional> — new sales, oldest first; poll with nextSince`,
      invoice: 'GET /eis-test/invoices/:orNumberOrSaleId — one sale',
    },
  });
}

// GET /eis-test/samples
export async function getEisTestSamples(_req: Request, res: Response): Promise<void> {
  res.json(buildTestSet(certId()));
}

// GET /eis-test/invoices?since=&limit=&store_id=
export async function getEisTestInvoices(req: Request, res: Response): Promise<void> {
  try {
    const companies = allowedCompanies();
    if (companies.length === 0) {
      res.status(403).json({ error: 'No companies enabled — set EIS_TEST_COMPANY_IDS' });
      return;
    }
    // Pass `since` to the database as given: created_at has microseconds (…00.247983) but a JS Date keeps only
    // milliseconds (…00.247), so re-serialising it would return the last sale again on every poll
    // An un-encoded "+00:00" arrives as " 00:00" — put the plus back
    const since = req.query.since ? String(req.query.since).replace(/ (\d{2}:\d{2})$/, '+$1') : '1970-01-01T00:00:00Z';
    if (Number.isNaN(Date.parse(since))) {
      res.status(400).json({ error: 'since must be an ISO date/time, e.g. 2026-10-22T00:00:00Z' });
      return;
    }
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), MAX_INVOICES_PER_SUBMISSION);

    let query = getDb()
      .from('sales')
      .select(SALE_COLUMNS)
      .in('company_id', companies)
      .gt('created_at', since)
      .order('created_at', { ascending: true })
      .limit(limit);
    if (req.query.store_id) query = query.eq('store_id', String(req.query.store_id));

    const { data, error } = await query;
    if (error) throw error;
    const sales = await toEisPayload((data || []) as SaleRow[]);

    res.json({
      specVersion: EIS_SPEC_VERSION,
      count: sales.length,
      invoiceCount: sales.filter((s) => s.invoice).length,
      nextSince: sales.length ? sales[sales.length - 1].createdAt : since,
      sales,
    });
  } catch (err) {
    console.error('EIS test invoices error:', err);
    res.status(500).json({ error: 'Failed to build e-invoices' });
  }
}

// GET /eis-test/invoices/:ref — OR number (OR-00000008) or sale id
export async function getEisTestInvoice(req: Request, res: Response): Promise<void> {
  try {
    const companies = allowedCompanies();
    if (companies.length === 0) {
      res.status(403).json({ error: 'No companies enabled — set EIS_TEST_COMPANY_IDS' });
      return;
    }
    const ref = String(req.params.ref);
    const column = /^[A-Za-z]*-?\d+$/.test(ref) && !ref.includes('_') ? 'or_number' : 'id';
    let query = getDb().from('sales').select(SALE_COLUMNS).in('company_id', companies).eq(column, ref).limit(5);
    if (req.query.store_id) query = query.eq('store_id', String(req.query.store_id));

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) {
      res.status(404).json({ error: 'Sale not found (or not in an enabled company)' });
      return;
    }
    // OR numbers are unique per store — several stores can share one; return all matches
    const sales = await toEisPayload(data as SaleRow[]);
    res.json({ specVersion: EIS_SPEC_VERSION, count: sales.length, sales });
  } catch (err) {
    console.error('EIS test invoice error:', err);
    res.status(500).json({ error: 'Failed to build e-invoice' });
  }
}
