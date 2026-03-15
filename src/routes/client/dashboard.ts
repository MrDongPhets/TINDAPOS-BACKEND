import express from 'express';
import {
  getDashboardOverview,
  getRecentSales,
  getLowStockProducts,
  getTopProducts,
  getStores
} from '../../controllers/client/dashboardController';

const router = express.Router();

router.get('/overview', getDashboardOverview);
router.get('/recent-sales', getRecentSales);
router.get('/low-stock', getLowStockProducts);
router.get('/top-products', getTopProducts);
router.get('/stores', getStores);

export default router;
