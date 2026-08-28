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
    const hostname = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();
    const isLinkedInJobsUrl = hostname.endsWith('linkedin.com') && pathname.startsWith('/jobs/');
    const canonicalJobId = extractLinkedInJobId(url);

    if (isLinkedInJobsUrl && canonicalJobId) {
      url.pathname = '/jobs/search-results/';
      url.search = '';
      url.searchParams.set('currentJobId', canonicalJobId);
      return url.toString().replace(/\/$/, '');
    }

    url.search = '';

    return url.toString().replace(/\/$/, '');
  } catch {
    return String(value).trim();
  }
}

function extractLinkedInJobId(url) {
  const currentJobId = String(url.searchParams.get('currentJobId') ?? '').trim();
  if (/^\d+$/.test(currentJobId)) {
    return currentJobId;
  }

  const viewMatch = url.pathname.match(/\/jobs\/view\/(\d+)/i);
  if (viewMatch?.[1]) {
    return viewMatch[1];
  }

  return null;
}
