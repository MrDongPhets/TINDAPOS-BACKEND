// src/routes/reports/inventory.ts
import express from 'express';
import {
  getInventoryReports,
  getStockValue,
  getTurnoverRates,
  getLowStockProducts,
  getInventoryMovementSummary
} from '../../controllers/reports/inventoryReportsController';
import { requireAdvancedReports } from '../../middleware/auth';

const router = express.Router();

// All inventory report endpoints are Laking Negosyo only
router.get('/', requireAdvancedReports, getInventoryReports);
router.get('/stock-value', requireAdvancedReports, getStockValue);
router.get('/turnover', requireAdvancedReports, getTurnoverRates);
router.get('/low-stock', requireAdvancedReports, getLowStockProducts);
router.get('/movements', requireAdvancedReports, getInventoryMovementSummary);

export default router;
