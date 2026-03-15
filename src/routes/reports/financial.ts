// src/routes/reports/financial.ts
import express from 'express';
import {
  getFinancialReports,
  getProfitMargins,
  getExpenseTracking,
  getTaxReports,
  getRevenueByStore
} from '../../controllers/reports/financialReportsController';

const router = express.Router();

// GET /reports/financial - Get financial summary
router.get('/', getFinancialReports);

// GET /reports/financial/profit-margins - Get profit margins
router.get('/profit-margins', getProfitMargins);

// GET /reports/financial/expenses - Get expense tracking
router.get('/expenses', getExpenseTracking);

// GET /reports/financial/tax - Get tax reports
router.get('/tax', getTaxReports);

// GET /reports/financial/revenue-by-store - Get revenue by store
router.get('/revenue-by-store', getRevenueByStore);

export default router;
