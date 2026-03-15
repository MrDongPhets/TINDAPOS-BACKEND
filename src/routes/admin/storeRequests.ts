// src/routes/admin/storeRequests.ts
import express from 'express';
import {
  getStoreRequests,
  approveStore,
  rejectStore
} from '../../controllers/admin/storeRequestsController';

const router = express.Router();

// GET /admin/store-requests
router.get('/', getStoreRequests);

// POST /admin/store-requests/approve
router.post('/approve', approveStore);

// POST /admin/store-requests/reject
router.post('/reject', rejectStore);

export default router;
