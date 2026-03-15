import express from 'express';
import { registerCompany } from '../../controllers/auth/registerController';

const router = express.Router();

router.post('/register-company', registerCompany);

export default router;
