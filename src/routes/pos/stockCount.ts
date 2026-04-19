import express from 'express';
import {
  getStockCounts,
  getStockCount,
  updateStockCountItems,
  submitStockCount,
} from '../../controllers/client/stockCountController';

const router = express.Router();

router.get('/', getStockCounts);
router.get('/:id', getStockCount);
router.put('/:id/items', updateStockCountItems);
router.post('/:id/submit', submitStockCount);

export default router;
