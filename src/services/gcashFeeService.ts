// src/services/gcashFeeService.ts
// GCash cash-in / cash-out fee rules. Stored per company in companies.settings.gcash.
// Same math lives in the frontend (src/lib/gcashFees.ts) for the live preview — keep them in sync.

type FeeRule = {
  mode: 'bracket' | 'percent';
  bracket_amount: number; // bracket mode: fee per started block of this amount (e.g. every ₱500)
  bracket_fee: number;    // bracket mode: fee per block (e.g. ₱10)
  percent: number;        // percent mode: % of amount (e.g. 2)
  minimum_fee: number;    // percent mode: never charge less than this
};

type GcashSettings = { cash_in: FeeRule; cash_out: FeeRule };

// Common sari-sari rate: ₱10 per ₱500 (≈2%)
const DEFAULT_RULE: FeeRule = { mode: 'bracket', bracket_amount: 500, bracket_fee: 10, percent: 2, minimum_fee: 10 };

const DEFAULT_GCASH_SETTINGS: GcashSettings = {
  cash_in: { ...DEFAULT_RULE },
  cash_out: { ...DEFAULT_RULE },
};

const toNumber = (value: unknown, fallback: number): number => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
};

function normalizeRule(rule: Partial<FeeRule> | undefined): FeeRule {
  return {
    mode: rule?.mode === 'percent' ? 'percent' : 'bracket',
    bracket_amount: toNumber(rule?.bracket_amount, DEFAULT_RULE.bracket_amount) || DEFAULT_RULE.bracket_amount,
    bracket_fee: toNumber(rule?.bracket_fee, DEFAULT_RULE.bracket_fee),
    percent: toNumber(rule?.percent, DEFAULT_RULE.percent),
    minimum_fee: toNumber(rule?.minimum_fee, DEFAULT_RULE.minimum_fee),
  };
}

// Merge saved settings with defaults (older companies have none saved)
function normalizeGcashSettings(saved: Partial<GcashSettings> | undefined): GcashSettings {
  return {
    cash_in: normalizeRule(saved?.cash_in),
    cash_out: normalizeRule(saved?.cash_out),
  };
}

function computeGcashFee(amount: number, rule: FeeRule): number {
  if (!(amount > 0)) return 0;
  const fee = rule.mode === 'percent'
    ? Math.max(rule.minimum_fee, (amount * rule.percent) / 100)
    : Math.ceil(amount / rule.bracket_amount) * rule.bracket_fee;
  return Math.round(fee * 100) / 100;
}

export { DEFAULT_GCASH_SETTINGS, normalizeGcashSettings, computeGcashFee };
export type { FeeRule, GcashSettings };
