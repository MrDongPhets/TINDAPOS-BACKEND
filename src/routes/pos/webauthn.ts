import { Router } from 'express';
import {
  getRegistrationOptions,
  verifyRegistration,
  getAuthOptions,
  verifyAuthentication,
  getRegisteredDevices,
  removeDevice,
} from '../../controllers/pos/webauthnController';
import { requireBiometricEnabled } from '../../middleware/auth';

const router = Router();

// All biometric/WebAuthn endpoints require biometric to be enabled by the company owner
router.get('/register/options', requireBiometricEnabled, getRegistrationOptions);
router.post('/register/verify', requireBiometricEnabled, verifyRegistration);
router.get('/auth/options', requireBiometricEnabled, getAuthOptions);
router.post('/auth/verify', requireBiometricEnabled, verifyAuthentication);
router.get('/devices', requireBiometricEnabled, getRegisteredDevices);
router.delete('/devices/:id', requireBiometricEnabled, removeDevice);

export default router;
