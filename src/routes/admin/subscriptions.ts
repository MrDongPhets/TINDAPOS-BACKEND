import express from 'express';
import { getSubscriptions, activateSubscription, deactivateSubscription, extendTrial } from '../../controllers/admin/subscriptionsController';

const router = express.Router();

router.get('/', getSubscriptions);
router.post('/activate', activateSubscription);
router.post('/deactivate', deactivateSubscription);
router.post('/extend-trial', extendTrial);

export default router;
