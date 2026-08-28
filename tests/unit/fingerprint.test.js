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

  it('normalizes /jobs/view and /jobs/search-results for the same LinkedIn vacancy to the same canonical URL', () => {
    const directViewUrl = 'https://www.linkedin.com/jobs/view/4448035675/?trackingId=abc123';
    const searchResultsUrl =
      'https://www.linkedin.com/jobs/search-results/?currentJobId=4448035675&keywords=backend&trackingId=xyz';

    expect(normalizeUrl(directViewUrl)).toBe('https://www.linkedin.com/jobs/search-results/?currentJobId=4448035675');
    expect(normalizeUrl(searchResultsUrl)).toBe('https://www.linkedin.com/jobs/search-results/?currentJobId=4448035675');
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

  it('generates the same fingerprint for equivalent LinkedIn view and search-results URLs of the same vacancy', () => {
    const common = {
      title: 'Backend Developer',
      company: 'Acme Labs',
      contactEmail: null,
    };

    const directViewFingerprint = buildOfferFingerprint({
      ...common,
      sourceUrl: 'https://www.linkedin.com/jobs/view/4448035675/?trackingId=abc123',
    });
    const searchResultsFingerprint = buildOfferFingerprint({
      ...common,
      sourceUrl:
        'https://www.linkedin.com/jobs/search-results/?currentJobId=4448035675&keywords=backend&refId=foo',
    });

    expect(directViewFingerprint).toBe(searchResultsFingerprint);
  });

  it('ignores volatile tracking params for the same LinkedIn vacancy', () => {
    const common = {
      title: 'Backend Developer',
      company: 'Acme Labs',
      contactEmail: null,
    };

    const first = buildOfferFingerprint({
      ...common,
      sourceUrl:
        'https://www.linkedin.com/jobs/search-results/?currentJobId=4448035675&trackingId=aaa&refId=bbb&eBP=ccc',
    });
    const second = buildOfferFingerprint({
      ...common,
      sourceUrl:
        'https://www.linkedin.com/jobs/search-results/?currentJobId=4448035675&trackingId=ddd&refId=eee&eBP=fff',
    });

    expect(first).toBe(second);
  });
});
