import { createHash } from 'node:crypto';

export function buildOfferFingerprint({ title, company, contactEmail, sourceUrl }) {
  const normalized = [title, company, contactEmail, normalizeUrl(sourceUrl)]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase())
    .join('|');

  return createHash('sha256').update(normalized).digest('hex');
}

export function normalizeUrl(value) {
  if (!value) {
    return '';
  }

  try {
    const url = new URL(value);
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return String(value).trim();
  }
}
