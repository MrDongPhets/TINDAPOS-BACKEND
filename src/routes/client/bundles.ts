import { Router } from 'express';
import { getBundles, createBundle, updateBundle, deleteBundle } from '../../controllers/client/bundleController';

const router = Router();

router.get('/', getBundles);
router.post('/', createBundle);
router.put('/:id', updateBundle);
router.delete('/:id', deleteBundle);

export default router;
