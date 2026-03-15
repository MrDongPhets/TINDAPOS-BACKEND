import express from 'express';
import { authenticateToken, requireClientOrStaff, requireActiveSubscription } from '../../middleware/auth';
import { getStores } from '../../controllers/client/storesController';
import { getCategories } from '../../controllers/client/categoriesController';

import productsRoutes from './products';
import salesRoutes from './sales';

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

export default router;
