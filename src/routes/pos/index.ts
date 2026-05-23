import express from 'express';
import { authenticateToken, requireClientOrStaff, requireActiveSubscription } from '../../middleware/auth';
import { getStores } from '../../controllers/client/storesController';
import { getCategories } from '../../controllers/client/categoriesController';

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

// Mount POS routes
router.use('/products', productsRoutes);
router.use('/sales', salesRoutes);
router.use('/stock-counts', stockCountRoutes);
router.use('/utang', utangRoutes);
router.use('/attendance', attendanceRoutes);
router.use('/webauthn', webauthnRoutes);

export default router;
