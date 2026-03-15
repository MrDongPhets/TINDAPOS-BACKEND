// src/routes/client/recipes.ts
import express from 'express';
import {
  getProductRecipe,
  saveProductRecipe,
  checkRecipeAvailability
} from '../../controllers/client/recipesController';

const router = express.Router();

// Recipe routes
router.get('/:product_id', getProductRecipe);
router.post('/:product_id', saveProductRecipe);
router.get('/:product_id/availability', checkRecipeAvailability);

export default router;
