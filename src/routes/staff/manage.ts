import express from 'express';
import { createStaff, listStaff, updateStaff, deleteStaff } from '../../controllers/staff/staffManageController';
import { authenticateToken } from '../../middleware/auth';
import { isManager } from '../../middleware/permissions';

const router = express.Router();

// All routes require authentication
router.use(authenticateToken);

// Create new staff (managers only)
router.post('/create', isManager, createStaff);

// Get all staff
router.get('/list', listStaff);

// Update staff (managers only)
router.put('/:id', isManager, updateStaff);

// Delete staff (managers only)
router.delete('/:id', isManager, deleteStaff);

export default router;
