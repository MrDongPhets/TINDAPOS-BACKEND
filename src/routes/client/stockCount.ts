import express from 'express';
import {
  getStockCounts,
  getStockCount,
  createStockCount,
  updateStockCountItems,
  submitStockCount,
  approveStockCount,
} from '../../controllers/client/stockCountController';

const router = express.Router();

router.get('/', getStockCounts);
router.get('/:id', getStockCount);
router.post('/', createStockCount);
router.put('/:id/items', updateStockCountItems);
router.post('/:id/submit', submitStockCount);
router.post('/:id/approve', approveStockCount);

export default router;
