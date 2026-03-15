// src/routes/staff/index.ts - Updated with permissions routes
import express from 'express';

import authRoutes from './auth';
import manageRoutes from './manage';
import permissionsRoutes from './permissions';

const router = express.Router();

// Public staff routes (login)
router.use('/auth', authRoutes);

// Protected staff routes
router.use('/manage', manageRoutes);
router.use('/permissions', permissionsRoutes);

export default router;
