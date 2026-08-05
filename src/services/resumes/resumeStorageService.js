import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/httpError.js';

const MIME_BY_EXTENSION = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export function createResumeStorageService(options = {}) {
  const config = options.config ?? env;
  const absoluteStorageDir = path.resolve(process.cwd(), config.RESUME_STORAGE_DIR);
  const normalizedStorageDir = config.RESUME_STORAGE_DIR.replace(/\\/g, '/').replace(/\/+$/u, '');

  return {
    async storeUpload({ fileName, mimeType = '', contentBase64 }) {
      const normalizedFileName = path.basename(String(fileName).trim());
      const extension = path.extname(normalizedFileName).toLowerCase();
      const allowedMimeType = MIME_BY_EXTENSION[extension];

      if (!allowedMimeType) {
        throw new HttpError(400, 'Only PDF, DOC and DOCX resumes are supported');
      }

      const normalizedMimeType = String(mimeType).trim();
      if (normalizedMimeType && normalizedMimeType !== allowedMimeType) {
        throw new HttpError(400, 'Resume mime type does not match the uploaded file extension');
      }

      const normalizedBase64 = String(contentBase64).trim().replace(/^data:[^;]+;base64,/u, '');
      const buffer = Buffer.from(normalizedBase64, 'base64');

      if (!buffer.length) {
        throw new HttpError(400, 'Resume file content is empty');
      }

      if (buffer.byteLength > config.RESUME_MAX_BYTES) {
        throw new HttpError(413, `Resume file exceeds the ${config.RESUME_MAX_BYTES} byte limit`);
      }

      await mkdir(absoluteStorageDir, { recursive: true });

      const storedFileName = `${randomUUID()}${extension}`;
      const relativePath = `${normalizedStorageDir}/${storedFileName}`;
      const absolutePath = path.resolve(process.cwd(), relativePath);

      await writeFile(absolutePath, buffer);

      return {
        relativePath,
        storedFileName,
        originalFileName: normalizedFileName,
        mimeType: allowedMimeType,
        extension: extension.slice(1),
        sizeBytes: buffer.byteLength,
        checksumSha256: createHash('sha256').update(buffer).digest('hex'),
        uploadedAt: new Date().toISOString(),
      };
    },
  };
}
