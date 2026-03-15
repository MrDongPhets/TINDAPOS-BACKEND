// src/routes/client/categories.ts - WITH SWAGGER DOCUMENTATION
import express from 'express';
import {
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory
} from '../../controllers/client/categoriesController';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Client - Categories
 *   description: Product category management for organizing inventory
 */

/**
 * @swagger
 * /client/categories:
 *   get:
 *     tags: [Client - Categories]
 *     summary: Get all categories for the company
 *     description: Retrieve all categories across all stores belonging to the authenticated user's company, including product count for each category
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of categories retrieved successfully
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *       500:
 *         description: Server error
 */
router.get('/', getCategories);

/**
 * @swagger
 * /client/categories/{id}:
 *   get:
 *     tags: [Client - Categories]
 *     summary: Get a specific category by ID
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Category details retrieved successfully
 *       404:
 *         description: Category not found
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *       500:
 *         description: Server error
 */
router.get('/:id', getCategory);

/**
 * @swagger
 * /client/categories:
 *   post:
 *     tags: [Client - Categories]
 *     summary: Create a new category
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Category created successfully
 *       400:
 *         description: Validation error
 *       409:
 *         description: Duplicate category name
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *       500:
 *         description: Server error
 */
router.post('/', createCategory);

/**
 * @swagger
 * /client/categories/{id}:
 *   put:
 *     tags: [Client - Categories]
 *     summary: Update a category
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Category updated successfully
 *       404:
 *         description: Category not found
 *       409:
 *         description: Duplicate category name
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *       500:
 *         description: Server error
 */
router.put('/:id', updateCategory);

/**
 * @swagger
 * /client/categories/{id}:
 *   delete:
 *     tags: [Client - Categories]
 *     summary: Delete (deactivate) a category
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Category deleted successfully
 *       400:
 *         description: Category has active products
 *       404:
 *         description: Category not found
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *       500:
 *         description: Server error
 */
router.delete('/:id', deleteCategory);

export default router;
