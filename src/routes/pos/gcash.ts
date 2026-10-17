import { Router } from 'express';
import { requireClient } from '../../middleware/auth';
import {
  getGcashSettings,
  getGcashTransactions,
  createGcashTransaction,
  deleteGcashTransaction,
} from '../../controllers/pos/gcashController';

const router = Router();

// Owner + staff
router.get('/settings', getGcashSettings);
router.get('/', getGcashTransactions);
router.post('/', createGcashTransaction);

// Owner only
router.delete('/:id', requireClient, deleteGcashTransaction);

export default router;
