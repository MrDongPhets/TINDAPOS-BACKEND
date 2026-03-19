// src/controllers/client/uploadController.ts - Handle image uploads
import { Request, Response } from 'express';
import { getDb } from '../../config/database';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import sharp from 'sharp';
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';

// Configure R2 client
const r2Client = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT!,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY!,
    secretAccessKey: process.env.R2_SECRET_KEY!,
  },
});

const R2_BUCKET = process.env.R2_BUCKET!;
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL!;

// Folder structure:
// kitapos-storage/
// └── stores/
//     └── {company_id}/
//         ├── products/
//         ├── logos/
//         └── receipts/

const ALLOWED_FOLDERS = ['products', 'logos', 'receipts'] as const;
type UploadFolder = typeof ALLOWED_FOLDERS[number];

// Configure multer for file upload
const storage = multer.memoryStorage();
export const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB — sharp compresses before R2 upload
  },
  fileFilter: (_req: Request, file: Express.Multer.File, cb: multer.FileFilterCallback) => {
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'));
    }
  },
});

async function uploadImage(req: Request, res: Response): Promise<void> {
  try {
    const companyId = req.user!.company_id;
    const userId = req.user!.id;
    const supabase = getDb();

    // Get upload folder from query param, default to 'products'
    const uploadType = (req.query.type as string) || 'products';
    const folder: UploadFolder = ALLOWED_FOLDERS.includes(uploadType as UploadFolder)
      ? (uploadType as UploadFolder)
      : 'products';

    console.log('📸 Starting image upload for company:', companyId, '| folder:', folder);

    if (!req.file) {
      res.status(400).json({ error: 'No file provided', code: 'NO_FILE' });
      return;
    }

    const file = req.file;
    console.log('📸 File details:', {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size
    });

    // Compress image (skip GIF — may be animated)
    let fileBuffer = file.buffer;
    let fileMime = file.mimetype;
    if (file.mimetype !== 'image/gif') {
      fileBuffer = await sharp(file.buffer)
        .resize({ width: 800, height: 800, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80 })
        .toBuffer();
      fileMime = 'image/jpeg';
      console.log(`📸 Compressed: ${file.size} → ${fileBuffer.length} bytes`);
    }

    // Generate unique filename under stores/{companyId}/{folder}/
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(2, 15);
    const fileExt = fileMime === 'image/gif' ? path.extname(file.originalname) : '.jpg';
    const fileName = `stores/${companyId}/${folder}/${timestamp}_${randomString}${fileExt}`;

    console.log('📸 Generated filename:', fileName);

    const isSQLiteMode = (process.env.DB_MODE || 'supabase').toLowerCase() === 'sqlite';

    let publicUrl: string;

    if (isSQLiteMode) {
      // SQLite mode: save file to local uploads directory
      const uploadsDir = path.join(process.cwd(), 'uploads', 'stores', companyId!, folder);
      fs.mkdirSync(uploadsDir, { recursive: true });

      const localFileName = `${timestamp}_${randomString}${fileExt}`;
      const localFilePath = path.join(uploadsDir, localFileName);
      fs.writeFileSync(localFilePath, fileBuffer);

      publicUrl = `/uploads/stores/${companyId!}/${folder}/${localFileName}`;
      console.log('📸 File saved locally:', localFilePath);
    } else {
      // R2 mode: upload to Cloudflare R2
      const uploadCommand = new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: fileName,
        Body: fileBuffer,
        ContentType: fileMime,
      });

      await r2Client.send(uploadCommand);
      console.log('📸 File uploaded to R2:', fileName);

      publicUrl = `${R2_PUBLIC_URL}/${fileName}`;
      console.log('📸 Public URL generated:', publicUrl);

      // Save upload record to database
      try {
        await supabase
          .from('file_uploads')
          .insert([{
            filename: fileName,
            original_name: file.originalname,
            mime_type: fileMime,
            file_size: fileBuffer.length,
            public_url: publicUrl,
            uploaded_by: userId,
            company_id: companyId,
            upload_type: folder,
            created_at: new Date().toISOString()
          }]);

        console.log('📸 Upload record saved to database');
      } catch (dbError) {
        const dbErr = dbError as Error;
        console.warn('⚠️ Failed to save upload record:', dbErr.message);
      }
    }

    res.json({
      message: 'Image uploaded successfully',
      url: publicUrl,
      filename: fileName,
      folder,
      size: fileBuffer.length,
      type: fileMime
    });

  } catch (error) {
    const err = error as Error;
    console.error('Upload image error:', err);

    let statusCode = 500;
    let errorMessage = 'Failed to upload image';

    if (err.message.includes('Invalid file type')) {
      statusCode = 400;
      errorMessage = err.message;
    } else if (err.message.includes('File too large')) {
      statusCode = 400;
      errorMessage = 'File size must be less than 5MB';
    }

    res.status(statusCode).json({ error: errorMessage, code: 'UPLOAD_ERROR' });
  }
}

async function deleteImage(req: Request, res: Response): Promise<void> {
  try {
    const filename = req.params['filename'] as string;
    const companyId = req.user!.company_id;
    const supabase = getDb();

    console.log('🗑️ Deleting image:', filename);

    // Verify the file belongs to this company
    if (!filename.includes(`stores/${companyId}/`)) {
      res.status(403).json({ error: 'Unauthorized to delete this file', code: 'UNAUTHORIZED' });
      return;
    }

    const isSQLiteMode = (process.env.DB_MODE || 'supabase').toLowerCase() === 'sqlite';

    if (isSQLiteMode) {
      // SQLite mode: delete local file
      const localFilePath = path.join(process.cwd(), filename);
      if (fs.existsSync(localFilePath)) {
        fs.unlinkSync(localFilePath);
      }
    } else {
      // R2 mode: delete from Cloudflare R2
      const deleteCommand = new DeleteObjectCommand({
        Bucket: R2_BUCKET,
        Key: filename,
      });

      await r2Client.send(deleteCommand);
      console.log('✅ File deleted from R2:', filename);

      // Update database record
      try {
        await supabase
          .from('file_uploads')
          .update({ deleted_at: new Date().toISOString() })
          .eq('filename', filename)
          .eq('company_id', companyId);
      } catch (dbError) {
        const dbErr = dbError as Error;
        console.warn('⚠️ Failed to update upload record:', dbErr.message);
      }
    }

    res.json({ message: 'Image deleted successfully' });

  } catch (error) {
    console.error('Delete image error:', error);
    res.status(500).json({ error: 'Failed to delete image', code: 'DELETE_ERROR' });
  }
}

export { uploadImage, deleteImage };
