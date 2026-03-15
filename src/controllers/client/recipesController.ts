// src/controllers/client/recipesController.ts
import { Request, Response } from 'express';
import { getDb } from '../../config/database';

// Get recipe for a product
async function getProductRecipe(req: Request, res: Response): Promise<void> {
  try {
    const { product_id } = req.params;
    const companyId = req.user!.company_id;
    const supabase = getDb();

    console.log('📝 Getting recipe for product:', product_id);

    // Verify product belongs to company
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    const storeIds = stores?.map((s: { id: string }) => s.id) || [];

    const { data: product } = await supabase
      .from('products')
      .select('id, store_id, is_composite')
      .eq('id', product_id)
      .in('store_id', storeIds)
      .single();

    if (!product) {
      res.status(404).json({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND'
      });
      return;
    }

    // Get recipe
    const { data: recipe, error } = await supabase
      .from('product_recipes')
      .select(`
        *,
        ingredients(id, name, unit, unit_cost, stock_quantity, sku)
      `)
      .eq('product_id', product_id)
      .order('created_at');

    if (error) throw error;

    // Calculate total recipe cost
    const totalCost = recipe?.reduce((sum: number, item: { quantity_needed: number; ingredients?: { unit_cost?: number } }) => {
      const ingredientCost = (item.ingredients?.unit_cost || 0) * item.quantity_needed;
      return sum + ingredientCost;
    }, 0) || 0;

    console.log('✅ Recipe found with', recipe?.length || 0, 'ingredients');

    res.json({
      recipe: recipe || [],
      total_cost: parseFloat(totalCost.toFixed(4)),
      is_composite: product.is_composite || false,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get recipe error:', error);
    res.status(500).json({
      error: 'Failed to fetch recipe',
      code: 'RECIPE_ERROR'
    });
  }
}

// Create or update product recipe
async function saveProductRecipe(req: Request, res: Response): Promise<void> {
  try {
    const { product_id } = req.params;
    const { ingredients } = req.body;
    const companyId = req.user!.company_id;
    const supabase = getDb();

    console.log('📝 Saving recipe for product:', product_id);

    // Verify product belongs to company
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    const storeIds = stores?.map((s: { id: string }) => s.id) || [];

    const { data: product } = await supabase
      .from('products')
      .select('id, store_id')
      .eq('id', product_id)
      .in('store_id', storeIds)
      .single();

    if (!product) {
      res.status(404).json({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND'
      });
      return;
    }

    // Validate ingredients array
    if (ingredients && !Array.isArray(ingredients)) {
      res.status(400).json({
        error: 'Ingredients must be an array',
        code: 'INVALID_INPUT'
      });
      return;
    }

    // Delete existing recipe items
    await supabase
      .from('product_recipes')
      .delete()
      .eq('product_id', product_id);

    let recipeCost = 0;

    // Insert new recipe items if provided
    if (ingredients && ingredients.length > 0) {
      // Validate all ingredients
      for (const item of ingredients as Array<{ ingredient_id?: string; quantity_needed?: number; unit?: string; notes?: string }>) {
        if (!item.ingredient_id || !item.quantity_needed || !item.unit) {
          res.status(400).json({
            error: 'Each ingredient must have ingredient_id, quantity_needed, and unit',
            code: 'INVALID_INGREDIENT'
          });
          return;
        }
      }

      const recipeItems = (ingredients as Array<{ ingredient_id: string; quantity_needed: number; unit: string; notes?: string }>).map(item => ({
        product_id,
        ingredient_id: item.ingredient_id,
        quantity_needed: parseFloat(String(item.quantity_needed)),
        unit: item.unit,
        notes: item.notes || null
      }));

      const { error: insertError } = await supabase
        .from('product_recipes')
        .insert(recipeItems);

      if (insertError) throw insertError;

      // Calculate recipe cost
      const { data: fullRecipe } = await supabase
        .from('product_recipes')
        .select(`
          quantity_needed,
          ingredients(unit_cost)
        `)
        .eq('product_id', product_id);

      recipeCost = (fullRecipe as any[])?.reduce((sum: number, item: any) => {
        return sum + (item.quantity_needed * (item.ingredients?.unit_cost || 0));
      }, 0) || 0;

      // Update product as composite and auto-fill cost_price from recipe
      await supabase
        .from('products')
        .update({
          is_composite: true,
          recipe_cost: parseFloat(recipeCost.toFixed(4)),
          cost_price: parseFloat(recipeCost.toFixed(4)),
          updated_at: new Date().toISOString()
        })
        .eq('id', product_id);

      console.log('✅ Recipe saved with', ingredients.length, 'ingredients');
    } else {
      // No ingredients, mark as non-composite and clear cost_price
      await supabase
        .from('products')
        .update({
          is_composite: false,
          recipe_cost: 0,
          cost_price: 0,
          updated_at: new Date().toISOString()
        })
        .eq('id', product_id);

      console.log('✅ Recipe cleared, product marked as non-composite');
    }

    res.json({
      message: 'Recipe saved successfully',
      recipe_cost: parseFloat(recipeCost.toFixed(4)),
      ingredient_count: ingredients?.length || 0
    });

  } catch (error) {
    console.error('Save recipe error:', error);
    res.status(500).json({
      error: 'Failed to save recipe',
      code: 'SAVE_ERROR'
    });
  }
}

// Check if product can be made (sufficient ingredients)
async function checkRecipeAvailability(req: Request, res: Response): Promise<void> {
  try {
    const { product_id } = req.params;
    const { quantity } = req.query;
    const companyId = req.user!.company_id;
    const supabase = getDb();

    console.log('🔍 Checking recipe availability for product:', product_id);

    // Verify product belongs to company
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    const storeIds = stores?.map((s: { id: string }) => s.id) || [];

    const { data: product } = await supabase
      .from('products')
      .select('id, store_id, name, is_composite')
      .eq('id', product_id)
      .in('store_id', storeIds)
      .single();

    if (!product) {
      res.status(404).json({
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND'
      });
      return;
    }

    if (!product.is_composite) {
      res.json({
        can_make: true,
        availability: [],
        message: 'Product is not a composite product'
      });
      return;
    }

    // Get recipe with ingredient stock
    const { data: recipe } = await supabase
      .from('product_recipes')
      .select(`
        *,
        ingredients(id, name, stock_quantity, unit)
      `)
      .eq('product_id', product_id);

    if (!recipe || recipe.length === 0) {
      res.json({
        can_make: false,
        availability: [],
        message: 'No recipe defined for this product'
      });
      return;
    }

    const qty = parseFloat(String(quantity || 1));

    // Check availability for each ingredient
    const availability = (recipe as Array<{ quantity_needed: number; ingredient_id: string; unit: string; ingredients?: { name: string; stock_quantity: number } }>).map(item => {
      const neededQty = item.quantity_needed * qty;
      const availableQty = item.ingredients?.stock_quantity || 0;
      const sufficient = availableQty >= neededQty;

      return {
        ingredient_id: item.ingredient_id,
        ingredient_name: item.ingredients?.name || 'Unknown',
        needed: neededQty,
        available: availableQty,
        sufficient: sufficient,
        unit: item.unit,
        shortage: sufficient ? 0 : neededQty - availableQty
      };
    });

    const canMake = availability.every((item: { sufficient: boolean }) => item.sufficient);
    const maxCanMake = Math.min(
      ...availability.map((item: { available: number; needed: number }) =>
        Math.floor(item.available / (item.needed / qty))
      )
    );

    console.log('✅ Availability checked:', canMake ? 'Can make' : 'Cannot make');

    res.json({
      can_make: canMake,
      max_quantity: maxCanMake,
      requested_quantity: qty,
      availability,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Check availability error:', error);
    res.status(500).json({
      error: 'Failed to check availability',
      code: 'AVAILABILITY_ERROR'
    });
  }
}

export {
  getProductRecipe,
  saveProductRecipe,
  checkRecipeAvailability
};
