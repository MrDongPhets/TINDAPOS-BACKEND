// src/services/eis/eisSpec.ts
// BIR EIS e-invoice — CRM/POS JSON format. Source: official EIS Certification Portal downloads
// (eis-cert.bir.gov.ph → Downloads → "Updated EIS e-invoice API Development Guide v2.3 and latest JSON file format",
// Oct 15 2026): "4_ANNEX B_EIS e-invoice JSON File format v2.1 … (Sept 2026).xlsx", sheet "2.e-invoice format-POS_v2.1",
// and "EIS e-invoice API development guide v2.3.pdf" §4.2 + §8.2.1.1. Copies are kept in eis-spec/official/.

export const EIS_SPEC_VERSION = 'CRM/POS v2.1 (Annex B, Sept 2026)';

export const DOC_TYPE = {
  INVOICE: '01',
  ADJUSTMENT: '06', // void / return / cancel slip
} as const;

export const CORRECTION_CD = {
  ERROR: '01',
  DUPLICATION: '02',
  ADDITION_REDUCTION: '03',
  CANCELLATION: '04', // full return without replacement counts as cancellation
  RETURN: '05',       // returned for replacement
  OTHERS: '09',
} as const;

export const SELLER_TYPE = {
  VAT: '0',
  NON_VAT: '1',
  REGISTERED_BUSINESS_ENTERPRISE: '2',
} as const;

export const VAT_RATE = 0.12;
export const MAX_INVOICES_PER_SUBMISSION = 100;
export const EIS_UNIQUE_ID_LENGTH = 24;   // date (8) + EIS Cert number (8) + control value (8)
export const BUYER_NO_TIN = '000000000';  // buyer not registered with BIR
// Spec text shows 25 zeros, but the field is 24 characters — 24 used here (open question for BIR)
export const PREV_ID_NOT_IN_POS = '0'.repeat(EIS_UNIQUE_ID_LENGTH);
