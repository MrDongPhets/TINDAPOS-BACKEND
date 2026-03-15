import express from 'express';
import { authenticateToken } from '../../middleware/auth';
import { verifyToken, cleanup } from '../../controllers/auth/verifyController';

const router = express.Router();

router.get('/verify', authenticateToken, verifyToken);
router.post('/cleanup', authenticateToken, cleanup);

export default router;
