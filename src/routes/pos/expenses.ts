import { Router } from 'express';
import { requireClient } from '../../middleware/auth';
import { getExpenses, createExpense, updateExpense, deleteExpense } from '../../controllers/pos/expensesController';

const router = Router();

// Owner + staff
router.get('/', getExpenses);
router.post('/', createExpense);

// Owner only
router.put('/:id', requireClient, updateExpense);
router.delete('/:id', requireClient, deleteExpense);

export default router;
