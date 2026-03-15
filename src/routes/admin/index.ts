import express from 'express';
import { authenticateToken, requireSuperAdmin } from '../../middleware/auth';

import companiesRoutes from './companies';
import usersRoutes from './users';
import statsRoutes from './stats';
import storeRequestsRoutes from './storeRequests';
import subscriptionsRoutes from './subscriptions';

const router = express.Router();

// Apply authentication to all admin routes
router.use(authenticateToken);
router.use(requireSuperAdmin);

// Mount admin routes
router.use('/companies', companiesRoutes);
router.use('/users', usersRoutes);
router.use('/stats', statsRoutes);
router.use('/store-requests', storeRequestsRoutes);
router.use('/subscriptions', subscriptionsRoutes);

export default router;
