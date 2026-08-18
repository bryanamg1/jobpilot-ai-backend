import { describe, expect, it } from 'vitest';
import { buildOfferFingerprint, normalizeUrl } from '../../src/lib/fingerprint.js';

describe('fingerprint normalization', () => {
  it('preserves currentJobId for LinkedIn search-results URLs', () => {
    const firstUrl =
      'https://www.linkedin.com/jobs/search-results/?currentJobId=4448035675&keywords=backend';
    const secondUrl =
      'https://www.linkedin.com/jobs/search-results/?currentJobId=5559931122&keywords=backend';

    expect(normalizeUrl(firstUrl)).toContain('currentJobId=4448035675');
    expect(normalizeUrl(secondUrl)).toContain('currentJobId=5559931122');
    expect(normalizeUrl(firstUrl)).not.toBe(normalizeUrl(secondUrl));
  });

  it('generates different fingerprints for different LinkedIn search-results jobs', () => {
    const common = {
      title: 'Backend Developer',
      company: 'Acme Labs',
      contactEmail: null,
    };

    const first = buildOfferFingerprint({
      ...common,
      sourceUrl:
        'https://www.linkedin.com/jobs/search-results/?currentJobId=4448035675&keywords=backend',
    });
    const second = buildOfferFingerprint({
      ...common,
      sourceUrl:
        'https://www.linkedin.com/jobs/search-results/?currentJobId=5559931122&keywords=backend',
    });

    expect(first).not.toBe(second);
  });
});
