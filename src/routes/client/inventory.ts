// src/routes/client/inventory.ts
import express from 'express';
import {
  getMovements,
  createStockAdjustment,
  getLowStockAlerts
} from '../../controllers/client/inventoryController';

const router = express.Router();

// GET /client/inventory/movements
router.get('/movements', getMovements);

// POST /client/inventory/adjust-stock
router.post('/adjust-stock', createStockAdjustment);

// GET /client/inventory/alerts
router.get('/alerts', getLowStockAlerts);

export default router;
