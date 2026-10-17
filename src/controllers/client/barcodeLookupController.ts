// src/controllers/client/barcodeLookupController.ts
// Barcode autofill for Add Product: suggest name / category / photo for a scanned barcode.
//   1. Tindapo — the same barcode saved by any store (most common name). Never shares price, cost or stock.
//   2. Open Food Facts — free public product database (fallback), cached in Redis.
import { Request, Response } from 'express';
import { getDb } from '../../config/database';
import { cacheGet, cacheSet } from '../../config/redis';

// Only standard retail barcodes (EAN-8, UPC-A, EAN-13, GTIN-14) are shared — store-made codes stay private
const RETAIL_BARCODE = /^(\d{8}|\d{12}|\d{13}|\d{14})$/;
const OFF_TIMEOUT_MS = 4000;
const OFF_CACHE_SECONDS = 7 * 24 * 60 * 60;
// OFF "brands" is sometimes the legal company name ("COCA-COLA SERVICES SA/NV") — don't put that in the product name
const CORPORATE_NAME = /\b(s\.a|sa|n\.v|nv|inc|corp|corporation|ltd|llc|services|company|co)\b|\//i;
const MAX_BRAND_LENGTH = 20;

type Suggestion = {
  source: 'tindapo' | 'openfoodfacts';
  name: string;
  category_name: string | null;
  image_url: string | null;
  stores_count?: number;
};

type ProductRow = {
  name: string;
  image_url: string | null;
  store_id: string;
  categories?: { name?: string } | null;
};

// Most frequent value, comparing case/space-insensitively but returning the original spelling
function mostCommon(values: string[]): string | null {
  const counts = new Map<string, { value: string; count: number }>();
  for (const raw of values) {
    const value = raw?.trim();
    if (!value) continue;
    const key = value.toLowerCase().replace(/\s+/g, ' ');
    const entry = counts.get(key);
    if (entry) entry.count++;
    else counts.set(key, { value, count: 1 });
  }
  let best: { value: string; count: number } | null = null;
  for (const entry of counts.values()) if (!best || entry.count > best.count) best = entry;
  return best?.value ?? null;
}

async function lookupTindapo(barcode: string, otherStores: ProductRow[]): Promise<Suggestion | null> {
  if (otherStores.length === 0) return null;
  const name = mostCommon(otherStores.map(p => p.name));
  if (!name) return null;

  const sameName = otherStores.filter(p => p.name.trim().toLowerCase() === name.toLowerCase());
  return {
    source: 'tindapo',
    name,
    category_name: mostCommon(otherStores.map(p => p.categories?.name || '')),
    image_url: sameName.find(p => p.image_url)?.image_url || null,
    stores_count: new Set(otherStores.map(p => p.store_id)).size,
  };
}

async function lookupOpenFoodFacts(barcode: string): Promise<Suggestion | null> {
  const cacheKey = `barcode:off:${barcode}`;
  const cached = await cacheGet(cacheKey);
  if (cached) return cached === 'null' ? null : JSON.parse(cached);

  try {
    const res = await fetch(
      `https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=product_name,brands,quantity`,
      {
        headers: { 'User-Agent': 'TindapoPOS/1.0 (https://tindapo.com)' },
        signal: AbortSignal.timeout(OFF_TIMEOUT_MS),
      }
    );
    const data = await res.json() as { status?: number; product?: { product_name?: string; brands?: string; quantity?: string } };

    let suggestion: Suggestion | null = null;
    const product = data.status === 1 ? data.product : undefined;
    if (product?.product_name?.trim()) {
      const brand = product.brands?.split(',')[0]?.trim();
      const base = product.product_name.trim();
      const useBrand = brand && brand.length <= MAX_BRAND_LENGTH && !CORPORATE_NAME.test(brand)
        && !base.toLowerCase().includes(brand.toLowerCase());
      const withBrand = useBrand ? `${brand} ${base}` : base;
      const quantity = product.quantity?.trim();
      suggestion = {
        source: 'openfoodfacts',
        name: quantity && !withBrand.includes(quantity) ? `${withBrand} ${quantity}` : withBrand,
        category_name: null,
        image_url: null, // OFF photos need CC BY-SA attribution — owner adds their own photo
      };
    }

    await cacheSet(cacheKey, suggestion ? JSON.stringify(suggestion) : 'null', OFF_CACHE_SECONDS);
    return suggestion;
  } catch (error) {
    console.warn(`⚠️ Open Food Facts lookup failed for ${barcode}:`, (error as Error).message);
    return null; // don't cache failures — try again next time
  }
}

// GET /client/products/barcode-lookup/:barcode
async function lookupBarcode(req: Request, res: Response): Promise<void> {
  try {
    const barcode = String(req.params.barcode || '').trim();
    const companyId = req.user!.company_id as string;

    if (!RETAIL_BARCODE.test(barcode)) {
      res.json({ found: false, reason: 'not_retail_barcode' });
      return;
    }

    const db = getDb();
    const [{ data: ownStores }, { data: matches, error }] = await Promise.all([
      db.from('stores').select('id').eq('company_id', companyId),
      db.from('products')
        .select('name, image_url, store_id, categories!fk_products_category(name)')
        .eq('barcode', barcode)
        .eq('is_active', true)
        .limit(200),
    ]);
    if (error) throw error;

    const ownStoreIds = new Set((ownStores || []).map((s: { id: string }) => s.id));
    const rows = (matches || []) as ProductRow[];
    const mine = rows.find(p => ownStoreIds.has(p.store_id));
    const others = rows.filter(p => !ownStoreIds.has(p.store_id));

    // Already in this company's inventory — warn instead of creating a duplicate
    if (mine) {
      res.json({ found: true, already_exists: true, existing_name: mine.name });
      return;
    }

    const suggestion = (await lookupTindapo(barcode, others)) || (await lookupOpenFoodFacts(barcode));

    console.log(`🔍 Barcode lookup ${barcode}: ${suggestion ? `${suggestion.source} → ${suggestion.name}` : 'not found'}`);
    res.json(suggestion ? { found: true, already_exists: false, suggestion } : { found: false });
  } catch (error) {
    console.error('❌ lookupBarcode error:', error);
    res.status(500).json({ error: 'Barcode lookup failed', code: 'BARCODE_LOOKUP_ERROR' });
  }
}

export { lookupBarcode, mostCommon, CORPORATE_NAME };
