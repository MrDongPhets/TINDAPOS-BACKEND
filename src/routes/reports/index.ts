// src/routes/reports/index.ts
import express from 'express';
import { authenticateToken } from '../../middleware/auth';

import salesRoutes from './sales';
import inventoryRoutes from './inventory';
import financialRoutes from './financial';

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Mount sub-routes
router.use('/sales', salesRoutes);
router.use('/inventory', inventoryRoutes);
router.use('/financial', financialRoutes);

export default router;
