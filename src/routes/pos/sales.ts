import express from 'express';
import { createSale, getSaleByReceipt, getTodaySales } from '../../controllers/pos/salesController';

const router = express.Router();

// POST /pos/sales
router.post('/', createSale);

// GET /pos/sales/receipt/:receipt_number
router.get('/receipt/:receipt_number', getSaleByReceipt);

// GET /pos/sales/today
router.get('/today', getTodaySales);

export default router;
