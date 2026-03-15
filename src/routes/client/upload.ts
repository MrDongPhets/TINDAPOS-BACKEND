// src/routes/client/upload.ts - Upload routes
import express from 'express';
import { uploadImage, deleteImage, upload } from '../../controllers/client/uploadController';
import { authenticateToken, requireClient } from '../../middleware/auth';

const router = express.Router();

// Apply authentication middleware to all routes
router.use(authenticateToken);
router.use(requireClient);

// POST /client/upload/image - Upload product image
router.post('/image', upload.single('file'), uploadImage);

// DELETE /client/upload/image/:filename - Delete uploaded image
router.delete('/image/:filename', deleteImage);

export default router;
