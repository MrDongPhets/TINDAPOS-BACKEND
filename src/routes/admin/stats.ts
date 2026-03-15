import express from 'express';
import { getUserStats, getSubscriptionStats } from '../../controllers/admin/statsController';

const router = express.Router();

router.get('/users', getUserStats);
router.get('/subscriptions', getSubscriptionStats);

export default router;
