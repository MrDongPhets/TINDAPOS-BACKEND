// src/routes/staff/permissions.ts
import express from 'express';
import {
  getRolePermissions,
  updateStaffRole,
  verifyManagerOverride,
  logActivity,
  getActivityLogs,
  changePasscode
} from '../../controllers/staff/staffPermissionsController';
import { authenticateToken } from '../../middleware/auth';
import { isManager, isSupervisor } from '../../middleware/permissions';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Get role permissions matrix (all authenticated staff can view)
router.get('/roles', getRolePermissions);

// Update staff role (managers only)
router.put('/role/:staff_id', isManager, updateStaffRole);

// Verify manager override for restricted actions
router.post('/manager-override', verifyManagerOverride);

// Log staff activity
router.post('/log-activity', logActivity);

// Get activity logs (managers and supervisors)
router.get('/activity-logs', isSupervisor, getActivityLogs);

// Change own passcode (any staff)
router.post('/change-passcode', changePasscode);

export default router;
