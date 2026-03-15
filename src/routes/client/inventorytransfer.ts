import express from 'express';
import {
  createTransferRequest,
  getTransfers,
  approveTransfer,
  completeTransfer,
  rejectTransfer
} from '../../controllers/client/transferController';

const router = express.Router();

// POST /client/inventory-transfer/request
router.post('/transfers', createTransferRequest);
router.get('/transfers', getTransfers);
router.patch('/transfers/:id/approve', approveTransfer);
router.patch('/transfers/:id/complete', completeTransfer);
router.patch('/transfers/:id/reject', rejectTransfer);

export default router;
