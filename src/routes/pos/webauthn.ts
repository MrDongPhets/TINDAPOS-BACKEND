import { Router } from 'express';
import {
  getRegistrationOptions,
  verifyRegistration,
  getAuthOptions,
  verifyAuthentication,
  getRegisteredDevices,
  removeDevice,
} from '../../controllers/pos/webauthnController';

const router = Router();

router.get('/register/options', getRegistrationOptions);
router.post('/register/verify', verifyRegistration);
router.get('/auth/options', getAuthOptions);
router.post('/auth/verify', verifyAuthentication);
router.get('/devices', getRegisteredDevices);
router.delete('/devices/:id', removeDevice);

export default router;
