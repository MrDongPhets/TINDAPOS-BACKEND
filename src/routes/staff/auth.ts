// src/routes/staff/auth.ts - Updated with logout
import express from 'express';
import {
  staffLogin,
  staffLogout,
  verifyStaffToken
} from '../../controllers/staff/staffAuthController';
import { authenticateToken } from '../../middleware/auth';

const router = express.Router();

// Public routes
router.post('/login', staffLogin);

// Protected routes
router.post('/logout', authenticateToken, staffLogout);
router.get('/verify', authenticateToken, verifyStaffToken);

export default router;
