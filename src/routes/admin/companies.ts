import express from 'express';
import { getCompanies } from '../../controllers/admin/companiesController';

const router = express.Router();

router.get('/', getCompanies);

export default router;
