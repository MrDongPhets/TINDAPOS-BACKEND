// src/controllers/admin/storeRequestsController.ts
import { Request, Response } from 'express';
import { getDb } from '../../config/database';

async function getStoreRequests(req: Request, res: Response): Promise<void> {
  try {
    const supabase = getDb();

    console.log('🏪 Getting store requests for admin');

    const { data: requests, error } = await supabase
      .from('stores')
      .select(`
        *,
        companies!inner(name)
      `)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    // Format the response
    const formattedRequests = requests.map((request: Record<string, unknown> & { companies: { name: string } }) => ({
      ...request,
      company_name: request.companies.name
    }));

    console.log('✅ Store requests found:', requests?.length || 0);

    res.json({
      requests: formattedRequests || [],
      count: formattedRequests?.length || 0
    });

  } catch (error) {
    console.error('Get store requests error:', error);
    res.status(500).json({
      error: 'Failed to fetch store requests',
      code: 'STORE_REQUESTS_ERROR'
    });
  }
}

async function approveStore(req: Request, res: Response): Promise<void> {
  try {
    const { store_id } = req.body;
    const adminId = req.user!.id;
    const supabase = getDb();

    console.log('✅ Approving store:', store_id);

    if (!store_id) {
      res.status(400).json({
        error: 'Store ID is required',
        code: 'VALIDATION_ERROR'
      });
      return;
    }

    // Get store details first
    const { data: store, error: fetchError } = await supabase
      .from('stores')
      .select('*, companies!inner(name)')
      .eq('id', store_id)
      .single();

    if (fetchError || !store) {
      res.status(404).json({
        error: 'Store not found',
        code: 'STORE_NOT_FOUND'
      });
      return;
    }

    if (store.status !== 'pending') {
      res.status(400).json({
        error: 'Store is not pending approval',
        code: 'INVALID_STATUS'
      });
      return;
    }

    // Check subscription limits
    const { data: subscription } = await supabase
      .from('subscriptions')
      .select('max_stores')
      .eq('company_id', store.company_id)
      .eq('status', 'active')
      .single();

    // Count active stores
    const { count: activeStores } = await supabase
      .from('stores')
      .select('id', { count: 'exact' })
      .eq('company_id', store.company_id)
      .eq('status', 'active');

    if (subscription && activeStores !== null && activeStores >= subscription.max_stores) {
      res.status(400).json({
        error: `Company has reached store limit (${subscription.max_stores} stores)`,
        code: 'STORE_LIMIT_EXCEEDED'
      });
      return;
    }

    // Update store status - Fixed settings spread
    const { data: updatedStore, error: updateError } = await supabase
      .from('stores')
      .update({
        status: 'active',
        is_active: true,
        settings: {
          ...(store.settings || {}),  // Fallback to empty object if settings is null
          approved_by: adminId,
          approved_at: new Date().toISOString()
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', store_id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    console.log('✅ Store approved successfully:', store_id);

    res.json({
      message: 'Store approved successfully',
      store: updatedStore
    });

  } catch (error) {
    console.error('Approve store error:', error);
    res.status(500).json({
      error: 'Failed to approve store',
      code: 'STORE_APPROVAL_ERROR'
    });
  }
}

async function rejectStore(req: Request, res: Response): Promise<void> {
  try {
    const { store_id, reason } = req.body;
    const adminId = req.user!.id;
    const supabase = getDb();

    console.log('❌ Rejecting store:', store_id);

    if (!store_id) {
      res.status(400).json({
        error: 'Store ID is required',
        code: 'VALIDATION_ERROR'
      });
      return;
    }

    // Get store details first
    const { data: store, error: fetchError } = await supabase
      .from('stores')
      .select('*')
      .eq('id', store_id)
      .single();

    if (fetchError || !store) {
      res.status(404).json({
        error: 'Store not found',
        code: 'STORE_NOT_FOUND'
      });
      return;
    }

    if (store.status !== 'pending') {
      res.status(400).json({
        error: 'Store is not pending approval',
        code: 'INVALID_STATUS'
      });
      return;
    }

    // Update store status to cancelled - Fixed settings spread
    const { data: updatedStore, error: updateError } = await supabase
      .from('stores')
      .update({
        status: 'cancelled',
        is_active: false,
        settings: {
          ...(store.settings || {}),  // Fallback to empty object if settings is null
          rejection_reason: reason || 'No reason provided',
          rejected_by: adminId,
          rejected_at: new Date().toISOString()
        },
        updated_at: new Date().toISOString()
      })
      .eq('id', store_id)
      .select()
      .single();

    if (updateError) {
      throw updateError;
    }

    console.log('❌ Store rejected successfully:', store_id);

    res.json({
      message: 'Store request rejected',
      store: updatedStore
    });

  } catch (error) {
    console.error('Reject store error:', error);
    res.status(500).json({
      error: 'Failed to reject store',
      code: 'STORE_REJECTION_ERROR'
    });
  }
}

export {
  getStoreRequests,
  approveStore,
  rejectStore
};
