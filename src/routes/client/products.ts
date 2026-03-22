import express from 'express';
import {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getCategories,
  bulkAdjustStock,
  restockProduct,
  getProductBatches
} from '../../controllers/client/productsController';

const router = express.Router();

// Products CRUD routes
router.get('/', getProducts);
router.get('/categories', getCategories);
router.post('/bulk-adjust', bulkAdjustStock); // Must be before /:id
router.get('/:id', getProduct);
router.post('/', createProduct);
router.put('/:id', updateProduct);
router.delete('/:id', deleteProduct);
router.post('/:id/restock', restockProduct);
router.get('/:id/batches', getProductBatches);

export default router;
