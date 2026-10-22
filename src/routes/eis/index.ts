// src/routes/eis/index.ts — EIS integration TEST API (off unless EIS_TEST_API_KEY is set; see eisTestController)
import { Router } from 'express';
import {
  getEisTestInfo,
  getEisTestInvoice,
  getEisTestInvoices,
  getEisTestSamples,
  requireEisTestKey,
} from '../../controllers/eis/eisTestController';

const router = Router();

router.use(requireEisTestKey);
router.get('/', getEisTestInfo);
router.get('/samples', getEisTestSamples);
router.get('/invoices', getEisTestInvoices);
router.get('/invoices/:ref', getEisTestInvoice);

export default router;
