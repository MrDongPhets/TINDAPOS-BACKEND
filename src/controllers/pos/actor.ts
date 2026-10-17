// src/controllers/pos/actor.ts
// Who is recording (owner vs staff) + which store — shared by GCash and expenses.
import { Request } from 'express';
import { getDb } from '../../config/database';

type Actor = {
  companyId: string;
  isStaff: boolean;
  storeId: string | null;      // staff: their assigned store
  createdBy: string | null;    // owner → users.id
  staffId: string | null;      // staff → staff.id
};

function resolveActor(req: Request): Actor {
  const isStaff = req.user!.userType === 'staff';
  return {
    companyId: req.user!.company_id as string,
    isStaff,
    storeId: isStaff ? req.user!.store_id || null : null,
    createdBy: isStaff ? null : req.user!.id,
    staffId: isStaff ? req.user!.id : null,
  };
}

// Staff always record for their own store. Owners may pick a store (or none = company-wide).
// Returns false when the owner sent a store that isn't theirs.
async function resolveStoreId(req: Request, actor: Actor): Promise<string | null | false> {
  if (actor.isStaff) return actor.storeId;

  const storeId = req.body.store_id as string | undefined;
  if (!storeId) return null;

  const { data } = await getDb()
    .from('stores')
    .select('id')
    .eq('id', storeId)
    .eq('company_id', actor.companyId)
    .limit(1);
  return data && data.length > 0 ? storeId : false;
}

export { resolveActor, resolveStoreId };
export type { Actor };
