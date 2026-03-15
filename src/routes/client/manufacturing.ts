// src/routes/client/manufacturing.ts
import express from 'express';
import {
  checkManufacturingAvailability,
  manufactureProduct,
  getManufacturingHistory
} from '../../controllers/client/manufacturingController';

const router = express.Router();

// Manufacturing routes
router.get('/history', getManufacturingHistory);
router.get('/:product_id/check', checkManufacturingAvailability);
router.post('/:product_id/manufacture', manufactureProduct);

export default router;
