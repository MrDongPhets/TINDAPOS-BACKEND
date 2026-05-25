// src/routes/reports/sales.ts
import express from 'express';
import {
  getSalesReports,
  getSalesReportByPeriod,
  getTopProducts,
  getStaffPerformance,
  getSalesComparison
} from '../../controllers/reports/salesReportsController';
import { requireAdvancedReports } from '../../middleware/auth';

const router = express.Router();

// GET /reports/sales - Get sales summary (available to all plans)
router.get('/', getSalesReports);

// GET /reports/sales/period - Get sales by period (available to all plans)
router.get('/period', getSalesReportByPeriod);

// GET /reports/sales/top-products - Get top selling products (available to all plans)
router.get('/top-products', getTopProducts);

// GET /reports/sales/staff-performance - Laking Negosyo only
router.get('/staff-performance', requireAdvancedReports, getStaffPerformance);

// GET /reports/sales/comparison - Laking Negosyo only
router.get('/comparison', requireAdvancedReports, getSalesComparison);

export default router;
