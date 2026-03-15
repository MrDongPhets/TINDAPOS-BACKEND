// src/routes/client/stores.ts - WITH SWAGGER DOCUMENTATION
import express from 'express';
import { getStores, requestStore } from '../../controllers/client/storesController';

const router = express.Router();

/**
 * @swagger
 * tags:
 *   name: Client - Stores
 *   description: Store management endpoints for multi-location businesses
 */

/**
 * @swagger
 * /client/stores:
 *   get:
 *     tags: [Client - Stores]
 *     summary: Get all stores for the authenticated company
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of stores retrieved successfully
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *       500:
 *         description: Server error
 */
router.get('/', getStores);

/**
 * @swagger
 * /client/stores/request:
 *   post:
 *     tags: [Client - Stores]
 *     summary: Request a new store (requires admin approval)
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       201:
 *         description: Store request submitted successfully
 *       400:
 *         description: Validation error - Missing required fields
 *       401:
 *         description: Unauthorized - Invalid or missing token
 *       500:
 *         description: Server error
 */
router.post('/request', requestStore);

export default router;
