// src/services/eis/eisTestCases.ts
// Synthetic EIS test set in the official CRM/POS format (fake TINs, made-up products) — shared by
// scripts/eis-test-invoices.ts (files) and GET /eis-test/samples (API).
// valid/* should be accepted by the EIS system under test, invalid/* rejected.
import { buildEisInvoice, type EisIdContext, type EisInvoice, type EisParty, type EisSale, type EisSeller } from './eisInvoice';
import { CORRECTION_CD, EIS_SPEC_VERSION, SELLER_TYPE } from './eisSpec';

// Test identities — obviously fake TINs / machine numbers, never real taxpayers
export const TEST_SELLER: EisSeller = {
  tin: '000000001', branchCd: '00000', type: SELLER_TYPE.VAT,
  regNm: 'TINDAPO TEST STORE (VAT)', businessNm: 'Aling Nena Sari-Sari Store',
  regAddr: '123 Rizal St, Brgy. San Jose, La Paz, Tarlac', email: 'test@example.com',
  ptuNum: 'TEST-PTU-0001', min: 'TEST-MIN-0001', msn: 'TEST-MSN-0001',
};
const SELLER_NONVAT: EisSeller = { ...TEST_SELLER, tin: '000000002', type: SELLER_TYPE.NON_VAT, regNm: 'TINDAPO TEST STORE (NON-VAT)' };
const BUYER_B2B: EisParty = { tin: '000000003', branchCd: '00000', regNm: 'TEST BUYER CORP', regAddr: '1 Ayala Ave, Makati City', email: 'ap@example.com' };

// Fixed test date (Manila time) so the set is identical on every run
const at = (h: number) => new Date(Date.UTC(2026, 9, 21, h - 8, 0));

type Case = { id: string; title: string; expect: string; sale: EisSale; seller?: EisSeller; buyer?: EisParty };

const CASES: Case[] = [
  { id: '01-cash-vatable', title: 'Cash sale, VATable items (2× Coca-Cola ₱20, 1× Chicken Noodles ₱15)', expect: 'VATSales 49.11, VAT 5.89, pay ₱55.00',
    sale: { receipt_no: 'OR-00000001', issued_at: at(9), items: [
      { name: 'Coca-Cola 1.5L', quantity: 2, unit_price: 20 }, { name: 'Chicken Noodles', quantity: 1, unit_price: 15 }] } },
  { id: '02-mixed-vat-exempt', title: 'VATable + VAT-exempt (rice) in one sale', expect: 'ONE document: VATSales 50.00 + ExemptSales 100.00',
    sale: { receipt_no: 'OR-00000002', issued_at: at(9), items: [
      { name: 'Coca-Cola 1.5L', quantity: 1, unit_price: 56 }, { name: 'Bigas 1kg', quantity: 2, unit_price: 50, vat_type: 'vat_exempt' }] } },
  { id: '03-zero-rated', title: 'Zero-rated item', expect: 'ZeroSales 500.00, VAT 0.00',
    sale: { receipt_no: 'OR-00000003', issued_at: at(10), items: [{ name: 'Zero-rated item', quantity: 1, unit_price: 500, vat_type: 'zero_rated' }] } },
  { id: '04-senior-citizen', title: 'Senior citizen discount (RA 9994)', expect: 'ExemptSales 100.00, ScAmt 20.00, VAT 0.00, pay ₱80.00',
    sale: { receipt_no: 'OR-00000004', issued_at: at(10), discount_type: 'senior_citizen', items: [
      { name: 'Pandesal', quantity: 10, unit_price: 5.6 }, { name: 'Kape 3-in-1', quantity: 1, unit_price: 56 }] } },
  { id: '05-pwd', title: 'PWD discount (RA 7277)', expect: 'ExemptSales 25.00, PwdAmt 5.00, pay ₱20.00',
    sale: { receipt_no: 'OR-00000005', issued_at: at(11), discount_type: 'pwd', items: [{ name: 'Gamot (Biogesic)', quantity: 4, unit_price: 7 }] } },
  { id: '06-regular-discount', title: '10% store discount on the whole sale', expect: 'RegAmt filled, VAT on the discounted amount',
    sale: { receipt_no: 'OR-00000006', issued_at: at(11), discount_type: 'percentage', discount_value: 10, items: [
      { name: 'Sardinas', quantity: 3, unit_price: 25 }, { name: 'Itlog (dozen)', quantity: 1, unit_price: 110 }] } },
  { id: '07-utang-credit', title: 'Utang (credit) sale — still an invoice', expect: 'Rmk1 notes credit',
    sale: { receipt_no: 'OR-00000007', issued_at: at(12), remarks: 'Credit sale (utang)', items: [
      { name: 'Mantika 1L', quantity: 1, unit_price: 89 }, { name: 'Asukal 1kg', quantity: 1, unit_price: 75 }] } },
  { id: '08-rounding', title: 'Rounding edge: 3× ₱9.99 + 7× ₱0.75', expect: 'NetAmtPay equals amount paid (₱35.22)',
    sale: { receipt_no: 'OR-00000008', issued_at: at(12), items: [
      { name: 'Candy', quantity: 3, unit_price: 9.99 }, { name: 'Kendi', quantity: 7, unit_price: 0.75 }] } },
  { id: '09-b2b-buyer', title: 'Sale to a VAT-registered business (BuyerInfo filled)', expect: 'BuyerInfo with buyer TIN',
    buyer: BUYER_B2B,
    sale: { receipt_no: 'OR-00000009', issued_at: at(13), items: [{ name: 'Softdrinks case (24)', quantity: 2, unit_price: 480 }] } },
  { id: '10-buyer-no-tin', title: 'Named buyer without a TIN', expect: "Buyer Tin '000000000' (spec rule)",
    buyer: { tin: '000000000', branchCd: '00000', regNm: 'JUAN DELA CRUZ' },
    sale: { receipt_no: 'OR-00000010', issued_at: at(13), items: [{ name: 'Bigas 5kg', quantity: 1, unit_price: 250, vat_type: 'vat_exempt' }] } },
  { id: '11-non-vat-seller', title: 'Non-VAT seller (most sari-sari stores), Type 1', expect: '⚠️ amounts reported as ExemptSales — confirm with BIR',
    seller: SELLER_NONVAT,
    sale: { receipt_no: 'OR-00000011', issued_at: at(14), items: [{ name: 'Load ₱50', quantity: 1, unit_price: 50 }] } },
];

export interface EisTestSet {
  manifest: { specVersion: string; generatedAt: string; cases: Array<Record<string, unknown>> };
  files: Record<string, EisInvoice | Record<string, unknown>>;  // 'valid/01-cash-vatable.json' → e-invoice JSON
}

export function buildTestSet(certId = 'TESTCERT'): EisTestSet {
  let seq = 0;
  const ids: EisIdContext = { certId, nextControl: () => String(++seq).padStart(8, '0') };
  const files: EisTestSet['files'] = {};
  const cases: Array<Record<string, unknown>> = [];
  const byCase = new Map<string, EisInvoice>();

  for (const c of CASES) {
    const r = buildEisInvoice(c.sale, c.seller || TEST_SELLER, ids, { buyer: c.buyer });
    byCase.set(c.id, r.invoice);
    files[`valid/${c.id}.json`] = r.invoice;
    cases.push({ file: `valid/${c.id}.json`, title: c.title, expect: c.expect, amountPaid: r.amountPaid, roundingDiff: r.roundingDiff, eisUniqueId: r.invoice.EisUniqueId });
  }

  // Adjustment document (DocType 06): cancellation of case 01 — negative amounts, same issue date as the original
  const original = byCase.get('01-cash-vatable')!;
  const cancel = buildEisInvoice(CASES[0].sale, TEST_SELLER, ids, {
    adjustment: { code: CORRECTION_CD.CANCELLATION, prevUniqueId: original.EisUniqueId, remarks: 'Void of OR-00000001 (customer cancelled)' },
  });
  files['valid/12-cancel-case-01.json'] = cancel.invoice;
  cases.push({ file: 'valid/12-cancel-case-01.json', title: 'Void/cancel slip for case 01 (DocType 06, CorrYN=Y, CorrectionCd=04)', expect: 'Accepted; negative amounts; PrevUniqueId = case 01', amountPaid: cancel.amountPaid, eisUniqueId: cancel.invoice.EisUniqueId });

  // Invalid on purpose — the EIS system should reject these
  const base = byCase.get('01-cash-vatable')!;
  const exemptOnly = byCase.get('03-zero-rated')!;
  const invalid: Array<{ name: string; data: Record<string, unknown>; expect: string }> = [
    { name: 'x1-duplicate-unique-id', data: { ...base }, expect: 'Duplicate EisUniqueId' },
    { name: 'x2-date-mismatch', data: { ...base, EisUniqueId: `20261020${base.EisUniqueId.slice(8)}` }, expect: 'EisUniqueId date ≠ IssueDtm' },
    { name: 'x3-unique-id-length', data: { ...base, EisUniqueId: `${base.EisUniqueId}9` }, expect: 'EisUniqueId must be 24 characters' },
    { name: 'x4-vat-without-vatable-sales', data: { ...exemptOnly, VATAmt: 60 }, expect: 'VAT amount with no VATable sales' },
    { name: 'x5-wrong-vat-amount', data: { ...base, VATAmt: 6.5 }, expect: 'VATAmt ≠ 12% of VATable sales' },
    { name: 'x6-tin-with-dashes', data: { ...base, SellerInfo: { ...base.SellerInfo, Tin: '000-000-001' } }, expect: 'Seller TIN must be 9 digits, no dashes' },
    { name: 'x7-seller-type-text', data: { ...base, SellerInfo: { ...base.SellerInfo, Type: 'VAT' } }, expect: "Seller Type must be '0', '1' or '2'" },
    { name: 'x8-missing-min-msn', data: (({ Min: _m, Msn: _s, ...rest }) => rest)(base), expect: 'Min and Msn are mandatory for CRM/POS' },
    { name: 'x9-totals-dont-add-up', data: { ...base, TotSalesAmt: 60 }, expect: 'TotSalesAmt ≠ VATSales + ExemptSales + ZeroSales' },
  ];
  for (const x of invalid) {
    files[`invalid/${x.name}.json`] = x.data;
    cases.push({ file: `invalid/${x.name}.json`, expect: `REJECT — ${x.expect}` });
  }

  return { manifest: { specVersion: EIS_SPEC_VERSION, generatedAt: new Date().toISOString(), cases }, files };
}
