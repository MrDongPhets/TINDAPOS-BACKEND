// src/routes/client/ingredients.ts
import express from 'express';
import {
  getIngredients,
  getIngredient,
  createIngredient,
  updateIngredient,
  deleteIngredient,
  updateIngredientStock,
  getIngredientMovements
} from '../../controllers/client/ingredientsController';

const router = express.Router();

// Ingredients CRUD routes
router.get('/', getIngredients);
router.get('/movements', getIngredientMovements);
router.get('/:id', getIngredient);
router.post('/', createIngredient);
router.put('/:id', updateIngredient);
router.delete('/:id', deleteIngredient);
router.patch('/:id/stock', updateIngredientStock);

export default router;
