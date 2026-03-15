import express from 'express';
import {
  getProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getCategories
} from '../../controllers/client/productsController';

const router = express.Router();

// Products CRUD routes
router.get('/', getProducts);
router.get('/categories', getCategories); // Get categories for dropdowns
router.get('/:id', getProduct);
router.post('/', createProduct);
router.put('/:id', updateProduct);
router.delete('/:id', deleteProduct);

export default router;
