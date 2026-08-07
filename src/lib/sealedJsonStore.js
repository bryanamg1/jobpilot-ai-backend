import fs from 'node:fs/promises';
import path from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

export function createSealedJsonStore(filePath, secret) {
  const resolvedPath = path.resolve(filePath);
  const key = deriveKey(secret);

  return {
    async read() {
      try {
        const payload = await fs.readFile(resolvedPath, 'utf8');
        const parsed = JSON.parse(payload);
        if (parsed.mode === 'plain') {
          return parsed.value;
        }
        return decryptJson(parsed, key);
      } catch (error) {
        if (error.code === 'ENOENT') {
          return null;
        }
        throw error;
      }
    },
    async write(value) {
      await fs.mkdir(path.dirname(resolvedPath), { recursive: true });
      const payload = JSON.stringify(encryptJson(value, key), null, 2);
      await fs.writeFile(resolvedPath, payload, 'utf8');
    },
    async delete() {
      try {
        await fs.unlink(resolvedPath);
      } catch (error) {
        if (error.code !== 'ENOENT') {
          throw error;
        }
      }
    },
    path: resolvedPath,
  };
}

function deriveKey(secret = '') {
  if (/^[0-9a-fA-F]{64}$/.test(secret)) {
    return Buffer.from(secret, 'hex');
  }

  return createHash('sha256').update(String(secret)).digest();
}

function encryptJson(value, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    version: 1,
    mode: 'aes-256-gcm',
    iv: iv.toString('base64url'),
    tag: tag.toString('base64url'),
    ciphertext: ciphertext.toString('base64url'),
  };
}

function decryptJson(payload, key) {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(payload.iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64url'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64url')),
    decipher.final(),
  ]);
  return JSON.parse(plaintext.toString('utf8'));
}
