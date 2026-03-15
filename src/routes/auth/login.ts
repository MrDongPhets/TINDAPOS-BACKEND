import express from 'express';
import {
  clientLogin,
  superAdminLogin,
  logout
} from '../../controllers/auth/loginController';

const router = express.Router();

router.post('/login', clientLogin);
router.post('/super-admin/login', superAdminLogin);
router.post('/logout', logout);

export default router;
