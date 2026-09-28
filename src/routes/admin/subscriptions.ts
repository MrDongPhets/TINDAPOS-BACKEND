import express from 'express';
import {
  getSubscriptions,
  activateSubscription,
  deactivateSubscription,
  extendTrial,
  updateSubscription,
  deleteCompany,
  restoreCompany,
  permanentlyDeleteCompany,
} from '../../controllers/admin/subscriptionsController';

const router = express.Router();

router.get('/', getSubscriptions);
router.post('/activate', activateSubscription);
router.post('/deactivate', deactivateSubscription);
router.post('/extend-trial', extendTrial);
router.put('/:id', updateSubscription);
router.delete('/:id', deleteCompany);
router.post('/:id/restore', restoreCompany);
router.delete('/:id/permanent', permanentlyDeleteCompany);

export default router;
