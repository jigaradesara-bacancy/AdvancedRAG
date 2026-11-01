import fs from 'node:fs/promises';
import multer from 'multer';
import { env, paths } from '../config/env.js';
import { badRequest } from '../utils/errors.js';

await fs.mkdir(paths.uploadsDir, { recursive: true });

export const uploadPdf = multer({
  dest: paths.uploadsDir,
  limits: { fileSize: env.UPLOAD_MAX_SIZE_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname) ? cb(null, true) : cb(badRequest('Only PDF files are accepted'))),
}).single('file');

/** Confirms the PDF magic bytes; the extension and mimetype come from the client and cannot be trusted. */
export async function hasPdfSignature(filePath) {
  const fh = await fs.open(filePath, 'r');
  try {
    const { buffer } = await fh.read(Buffer.alloc(5), 0, 5, 0);
    return buffer.toString('latin1') === '%PDF-';
  } finally {
    await fh.close();
  }
}
