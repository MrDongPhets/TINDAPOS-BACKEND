// src/routes/reports/financial.ts
import express from 'express';
import {
  getFinancialReports,
  getProfitMargins,
  getExpenseTracking,
  getTaxReports,
  getRevenueByStore
} from '../../controllers/reports/financialReportsController';
import { requireAdvancedReports } from '../../middleware/auth';

const router = express.Router();

// All financial report endpoints are Laking Negosyo only
router.get('/', requireAdvancedReports, getFinancialReports);
router.get('/profit-margins', requireAdvancedReports, getProfitMargins);
router.get('/expenses', requireAdvancedReports, getExpenseTracking);
router.get('/tax', requireAdvancedReports, getTaxReports);
router.get('/revenue-by-store', requireAdvancedReports, getRevenueByStore);

export default router;
