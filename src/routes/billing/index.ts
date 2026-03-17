import express from 'express';
import { authenticateToken, requireClient } from '../../middleware/auth';
import { createCheckout, getBillingStatus, handleWebhook } from '../../controllers/billing/billingController';

const router = express.Router();

// Webhook — no auth, called directly by PayMongo
router.post('/webhook', handleWebhook);

// Billing routes — need auth + client role but NOT active subscription
router.post('/create-checkout', authenticateToken, requireClient, createCheckout);
router.get('/status', authenticateToken, requireClient, getBillingStatus);

export default router;
