import express from 'express';
import { getSetupStatus, initializeSetup, getPublicStores } from '../controllers/setup/setupController';

const router = express.Router();

router.get('/status', getSetupStatus);
router.post('/initialize', initializeSetup);
router.get('/stores', getPublicStores);

export default router;
