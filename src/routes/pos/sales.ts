import express from 'express';
import { createSale, getSaleByReceipt, getTodaySales, getZReading, createZReading, getZReadingHistory } from '../../controllers/pos/salesController';

const router = express.Router();

// POST /pos/sales
router.post('/', createSale);

// GET /pos/sales/receipt/:receipt_number
router.get('/receipt/:receipt_number', getSaleByReceipt);

// GET /pos/sales/today
router.get('/today', getTodaySales);

// GET /pos/sales/z-reading?store_id=xxx
router.get('/z-reading', getZReading);

// POST /pos/sales/z-reading
router.post('/z-reading', createZReading);

// GET /pos/sales/z-reading/history?store_id=xxx
router.get('/z-reading/history', getZReadingHistory);

export default router;
