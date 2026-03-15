import express from 'express';
import { searchProducts, getProductsByCategory, calculatePrice } from '../../controllers/pos/posController';

const router = express.Router();

// GET /pos/products/search
router.get('/search', searchProducts);

// GET /pos/products/category
router.get('/category', getProductsByCategory);

// POST /pos/products/calculate-price
router.post('/calculate-price', calculatePrice);

export default router;
