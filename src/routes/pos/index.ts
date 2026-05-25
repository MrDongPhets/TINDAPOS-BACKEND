import express, { Request, Response } from 'express';
import { authenticateToken, requireClientOrStaff, requireActiveSubscription } from '../../middleware/auth';
import { getStores } from '../../controllers/client/storesController';
import { getCategories } from '../../controllers/client/categoriesController';
import { getDb } from '../../config/database';

import productsRoutes from './products';
import salesRoutes from './sales';
import stockCountRoutes from './stockCount';
import utangRoutes from '../client/utang';
import attendanceRoutes from './attendance';
import webauthnRoutes from './webauthn';

const router = express.Router();

// Apply authentication to all POS routes
router.use(authenticateToken);
router.use(requireClientOrStaff);
router.use(requireActiveSubscription);

// Shared endpoints accessible by both client and staff
router.get('/stores', getStores);
router.get('/categories', getCategories);

// GET /pos/company-settings — returns company feature flags for staff
router.get('/company-settings', async (req: Request, res: Response) => {
  try {
    const db = getDb();
    const { data, error } = await db
      .from('companies')
      .select('settings')
      .eq('id', req.user!.company_id)
      .single();
    if (error) throw error;
    res.json({ biometric_enabled: data?.settings?.biometric_enabled === true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Mount POS routes
router.use('/products', productsRoutes);
router.use('/sales', salesRoutes);
router.use('/stock-counts', stockCountRoutes);
router.use('/utang', utangRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/webauthn', webauthnRoutes);

export default router;
