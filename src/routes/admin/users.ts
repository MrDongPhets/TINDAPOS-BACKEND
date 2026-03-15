import express from 'express';
import { getUsers } from '../../controllers/admin/usersController';

const router = express.Router();

// Future: Add user management endpoints
router.get('/', getUsers);

export default router;
