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
    const isLinkedInJobSearchResults =
      url.hostname.toLowerCase().endsWith('linkedin.com') &&
      url.pathname.toLowerCase().startsWith('/jobs/search-results/');

    if (isLinkedInJobSearchResults) {
      const currentJobId = url.searchParams.get('currentJobId');
      url.search = '';
      if (currentJobId) {
        url.searchParams.set('currentJobId', currentJobId);
      }
    } else {
      url.search = '';
    }

    return url.toString().replace(/\/$/, '');
  } catch {
    return String(value).trim();
  }
}
