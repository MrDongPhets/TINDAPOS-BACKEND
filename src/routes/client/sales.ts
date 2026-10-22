// src/routes/client/sales.ts - Sales Management Routes
import express from 'express';
import {
  getAllSales,
  getSaleDetails,
  getSalesSummary,
  getRecentSales,
  exportSales
} from '../../controllers/client/salesController';
import { createSaleAdjustment } from '../../controllers/client/saleAdjustmentsController';

const router = express.Router();

// GET /client/sales - Get all sales with filters and pagination
router.get('/', getAllSales);

// GET /client/sales/summary - Get sales statistics
router.get('/summary', getSalesSummary);

// GET /client/sales/recent - Get recent sales (last 24 hours)
router.get('/recent', getRecentSales);

// GET /client/sales/export - Export sales with item names
router.get('/export', exportSales);

// GET /client/sales/:id - Get sale details with items
router.get('/:id', getSaleDetails);

// POST /client/sales/:id/adjustments - void or return (its own ADJ-… document; stock back; grand total untouched)
router.post('/:id/adjustments', createSaleAdjustment);
// POST /client/sales/:id/void - void the whole sale (same as kind 'void')
router.post('/:id/void', createSaleAdjustment);

export default router;
