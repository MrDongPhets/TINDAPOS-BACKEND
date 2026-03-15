// src/controllers/client/ingredientsController.ts
import { Request, Response } from 'express';
import { getDb } from '../../config/database';

// Get all ingredients
async function getIngredients(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { store_id } = req.query;
    const supabase = getDb();

    console.log('🥤 Getting ingredients for company:', companyId);

    // Get store IDs for this company
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    const storeIds = stores?.map((store: { id: string }) => store.id) || [];

    if (storeIds.length === 0) {
      res.json({ ingredients: [], count: 0 });
      return;
    }

    // Build query
    let query = supabase
      .from('ingredients')
      .select('*', { count: 'exact' })
      .in('store_id', storeIds)
      .eq('is_active', true);

    // Filter by specific store if provided
    if (store_id) {
      query = query.eq('store_id', store_id);
    }

    const { data: ingredients, error, count } = await query.order('name');

    if (error) throw error;

    console.log('✅ Ingredients found:', ingredients?.length || 0);

    res.json({
      ingredients: ingredients || [],
      count: count || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get ingredients error:', error);
    res.status(500).json({
      error: 'Failed to fetch ingredients',
      code: 'INGREDIENTS_ERROR'
    });
  }
}

// Get single ingredient
async function getIngredient(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const supabase = getDb();

    console.log('🥤 Getting ingredient:', id);

    // Get store IDs for this company
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    const storeIds = stores?.map((store: { id: string }) => store.id) || [];

    const { data: ingredient, error } = await supabase
      .from('ingredients')
      .select('*')
      .eq('id', id)
      .in('store_id', storeIds)
      .eq('is_active', true)
      .single();

    if (error || !ingredient) {
      res.status(404).json({
        error: 'Ingredient not found',
        code: 'INGREDIENT_NOT_FOUND'
      });
      return;
    }

    res.json({ ingredient });

  } catch (error) {
    console.error('Get ingredient error:', error);
    res.status(500).json({
      error: 'Failed to fetch ingredient',
      code: 'INGREDIENT_ERROR'
    });
  }
}

// Create ingredient
async function createIngredient(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const userId = req.user!.id;
    const supabase = getDb();

    const {
      name,
      description,
      sku,
      unit,
      unit_cost,
      stock_quantity,
      min_stock_level,
      store_id,
      supplier
    } = req.body;

    console.log('🥤 Creating ingredient:', name);

    // Validate required fields
    if (!name || !unit || !unit_cost || !store_id) {
      res.status(400).json({
        error: 'Name, unit, unit cost, and store are required',
        code: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    // Verify store belongs to company
    const { data: store } = await supabase
      .from('stores')
      .select('id')
      .eq('id', store_id)
      .eq('company_id', companyId)
      .single();

    if (!store) {
      res.status(400).json({
        error: 'Invalid store for this company',
        code: 'INVALID_STORE'
      });
      return;
    }

    // Generate SKU if not provided
    let finalSku = sku;
    if (!finalSku) {
      const timestamp = Date.now().toString().slice(-6);
      const namePrefix = name.substring(0, 3).toUpperCase();
      finalSku = `ING${namePrefix}${timestamp}`;
    }

    // Check if SKU already exists
    const { data: existingSku } = await supabase
      .from('ingredients')
      .select('id')
      .eq('sku', finalSku)
      .single();

    if (existingSku) {
      res.status(409).json({
        error: 'SKU already exists',
        code: 'SKU_EXISTS'
      });
      return;
    }

    // Create ingredient
    const { data: ingredient, error } = await supabase
      .from('ingredients')
      .insert([{
        name: name.trim(),
        description: description?.trim() || null,
        sku: finalSku,
        unit: unit,
        unit_cost: parseFloat(unit_cost),
        stock_quantity: parseFloat(stock_quantity || 0),
        min_stock_level: parseFloat(min_stock_level || 10),
        supplier: supplier?.trim() || null,
        store_id,
        created_by: userId
      }])
      .select()
      .single();

    if (error) throw error;

    console.log('✅ Ingredient created successfully:', ingredient.id);

    res.status(201).json({
      message: 'Ingredient created successfully',
      ingredient
    });

  } catch (error) {
    console.error('Create ingredient error:', error);
    res.status(500).json({
      error: 'Failed to create ingredient',
      code: 'CREATE_ERROR'
    });
  }
}

// Update ingredient
async function updateIngredient(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const supabase = getDb();

    const {
      name,
      description,
      sku,
      unit,
      unit_cost,
      min_stock_level,
      supplier
    } = req.body;

    console.log('🥤 Updating ingredient:', id);

    // Get store IDs for this company
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    const storeIds = stores?.map((store: { id: string }) => store.id) || [];

    // Verify ingredient exists and belongs to company
    const { data: existingIngredient } = await supabase
      .from('ingredients')
      .select('*')
      .eq('id', id)
      .in('store_id', storeIds)
      .single();

    if (!existingIngredient) {
      res.status(404).json({
        error: 'Ingredient not found',
        code: 'INGREDIENT_NOT_FOUND'
      });
      return;
    }

    // Check SKU uniqueness if changed
    if (sku && sku !== existingIngredient.sku) {
      const { data: existingSku } = await supabase
        .from('ingredients')
        .select('id')
        .eq('sku', sku)
        .neq('id', id)
        .single();

      if (existingSku) {
        res.status(409).json({
          error: 'SKU already exists',
          code: 'SKU_EXISTS'
        });
        return;
      }
    }

    // Update ingredient
    const { data: ingredient, error } = await supabase
      .from('ingredients')
      .update({
        name: name?.trim() || existingIngredient.name,
        description: description?.trim() || existingIngredient.description,
        sku: sku || existingIngredient.sku,
        unit: unit || existingIngredient.unit,
        unit_cost: unit_cost !== undefined ? parseFloat(unit_cost) : existingIngredient.unit_cost,
        min_stock_level: min_stock_level !== undefined ? parseFloat(min_stock_level) : existingIngredient.min_stock_level,
        supplier: supplier?.trim() || existingIngredient.supplier,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    console.log('✅ Ingredient updated successfully');

    res.json({
      message: 'Ingredient updated successfully',
      ingredient
    });

  } catch (error) {
    console.error('Update ingredient error:', error);
    res.status(500).json({
      error: 'Failed to update ingredient',
      code: 'UPDATE_ERROR'
    });
  }
}

// Delete ingredient
async function deleteIngredient(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const companyId = req.user!.company_id;
    const supabase = getDb();

    console.log('🥤 Deleting ingredient:', id);

    // Get store IDs for this company
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    const storeIds = stores?.map((store: { id: string }) => store.id) || [];

    // Check if ingredient is used in any recipes
    const { data: recipes } = await supabase
      .from('product_recipes')
      .select('id')
      .eq('ingredient_id', id)
      .limit(1);

    if (recipes && recipes.length > 0) {
      res.status(400).json({
        error: 'Cannot delete ingredient that is used in product recipes',
        code: 'INGREDIENT_IN_USE'
      });
      return;
    }

    // Soft delete (mark as inactive)
    const { error } = await supabase
      .from('ingredients')
      .update({
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .in('store_id', storeIds);

    if (error) throw error;

    console.log('✅ Ingredient deleted successfully');

    res.json({
      message: 'Ingredient deleted successfully'
    });

  } catch (error) {
    console.error('Delete ingredient error:', error);
    res.status(500).json({
      error: 'Failed to delete ingredient',
      code: 'DELETE_ERROR'
    });
  }
}

// Update ingredient stock
async function updateIngredientStock(req: Request, res: Response): Promise<void> {
  try {
    const { id } = req.params;
    const { quantity, movement_type, notes } = req.body;
    const userId = req.user!.id;
    const companyId = req.user!.company_id;
    const supabase = getDb();

    console.log('🥤 Updating ingredient stock:', id);

    // Validate required fields
    if (!quantity || !movement_type) {
      res.status(400).json({
        error: 'Quantity and movement type are required',
        code: 'MISSING_REQUIRED_FIELDS'
      });
      return;
    }

    // Get store IDs for this company
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    const storeIds = stores?.map((store: { id: string }) => store.id) || [];

    // Get current ingredient
    const { data: ingredient, error: getError } = await supabase
      .from('ingredients')
      .select('*')
      .eq('id', id)
      .in('store_id', storeIds)
      .single();

    if (getError || !ingredient) {
      res.status(404).json({
        error: 'Ingredient not found',
        code: 'INGREDIENT_NOT_FOUND'
      });
      return;
    }

    const previousStock = parseFloat(ingredient.stock_quantity);
    let newStock = previousStock;
    const qty = parseFloat(quantity);

    // Calculate new stock based on movement type
    if (movement_type === 'in' || movement_type === 'adjustment') {
      newStock = previousStock + qty;
    } else if (movement_type === 'out') {
      newStock = previousStock - qty;
      if (newStock < 0) {
        res.status(400).json({
          error: 'Insufficient stock',
          code: 'INSUFFICIENT_STOCK'
        });
        return;
      }
    }

    // Update ingredient stock
    const { error: updateError } = await supabase
      .from('ingredients')
      .update({
        stock_quantity: newStock,
        updated_at: new Date().toISOString()
      })
      .eq('id', id);

    if (updateError) throw updateError;

    // Log movement
    await supabase
      .from('ingredient_movements')
      .insert([{
        ingredient_id: id,
        store_id: ingredient.store_id,
        movement_type,
        quantity: qty,
        previous_stock: previousStock,
        new_stock: newStock,
        unit_cost: ingredient.unit_cost,
        notes,
        created_by: userId
      }]);

    console.log('✅ Ingredient stock updated successfully');

    res.json({
      message: 'Stock updated successfully',
      previous_stock: previousStock,
      new_stock: newStock,
      quantity: qty
    });

  } catch (error) {
    console.error('Update ingredient stock error:', error);
    res.status(500).json({
      error: 'Failed to update stock',
      code: 'STOCK_UPDATE_ERROR'
    });
  }
}

// Get ingredient movements
async function getIngredientMovements(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const { ingredient_id, store_id } = req.query;
    const supabase = getDb();

    console.log('📊 Getting ingredient movements');

    // Get store IDs for this company
    const { data: stores } = await supabase
      .from('stores')
      .select('id')
      .eq('company_id', companyId);

    const storeIds = stores?.map((store: { id: string }) => store.id) || [];

    if (storeIds.length === 0) {
      res.json({ movements: [], count: 0 });
      return;
    }

    // Build query
    let query = supabase
      .from('ingredient_movements')
      .select(`
        *,
        ingredients(id, name, sku, unit)
      `, { count: 'exact' })
      .in('store_id', storeIds);

    // Filter by ingredient if provided
    if (ingredient_id) {
      query = query.eq('ingredient_id', ingredient_id);
    }

    // Filter by store if provided
    if (store_id) {
      query = query.eq('store_id', store_id);
    }

    const { data: movements, error, count } = await query
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    // Transform data
    const transformedMovements = movements?.map((movement: Record<string, unknown> & { ingredients?: { name: string; sku: string; unit: string } }) => ({
      ...movement,
      ingredient_name: movement.ingredients?.name || 'Unknown',
      ingredient_sku: movement.ingredients?.sku,
      ingredient_unit: movement.ingredients?.unit
    })) || [];

    console.log('✅ Movements found:', transformedMovements.length);

    res.json({
      movements: transformedMovements,
      count: count || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Get ingredient movements error:', error);
    res.status(500).json({
      error: 'Failed to fetch ingredient movements',
      code: 'MOVEMENTS_ERROR'
    });
  }
}

export {
  getIngredients,
  getIngredient,
  createIngredient,
  updateIngredient,
  deleteIngredient,
  updateIngredientStock,
  getIngredientMovements
};
