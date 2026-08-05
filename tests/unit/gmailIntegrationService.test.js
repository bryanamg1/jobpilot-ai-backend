import { describe, expect, it, vi } from 'vitest';
import { createGmailIntegrationService } from '../../src/services/gmail/gmailIntegrationService.js';

describe('gmailIntegrationService', () => {
  it('returns a disconnected status when there is no stored session', async () => {
    const service = createGmailIntegrationService(
      {
        async saveEmailDraft(record) {
          return record;
        },
      },
      {
        async record() {
          return {};
        },
      },
      {
        async createPreview() {
          return {};
        },
      },
      {
        config: {
          GOOGLE_CLIENT_ID: 'client-id',
          GOOGLE_CLIENT_SECRET: 'client-secret',
          GOOGLE_REDIRECT_URI: 'http://localhost:4300/api/v1/integrations/gmail/callback',
          GOOGLE_GMAIL_LABEL: 'Postulaciones/Por revisar',
          GOOGLE_GMAIL_ALERT_QUERY: 'job alert',
          GOOGLE_GMAIL_MAX_RESULTS: 10,
          GOOGLE_TOKEN_PATH: 'storage/tokens/test.json.enc',
          ENCRYPTION_KEY: 'a'.repeat(64),
        },
        tokenStore: {
          async read() {
            return null;
          },
          async write() {},
          async delete() {},
        },
      },
    );

    const status = await service.getStatus();

    expect(status.configured).toBe(true);
    expect(status.connected).toBe(false);
    expect(status.labelName).toBe('Postulaciones/Por revisar');
  });

  it('creates a gmail draft payload and persists metadata through the repository', async () => {
    const saveEmailDraft = vi.fn(async (record) => record);
    const recordAudit = vi.fn(async () => ({}));
    const gmailApi = {
      users: {
        drafts: {
          create: vi.fn().mockResolvedValue({
            data: { id: 'gmail-draft-1' },
          }),
        },
      },
    };

    const service = createGmailIntegrationService(
      {
        saveEmailDraft,
      },
      {
        record: recordAudit,
      },
      {
        async createPreview() {
          return {
            jobId: 'job-1',
            jobTitle: 'Backend Developer',
            company: 'Acme Labs',
            sourceUrl: 'https://example.com/job-1',
            matchStatus: 'AWAITING_APPROVAL',
            score: 82,
            status: 'REVIEW_REQUIRED',
            recipient: 'jobs@acmelabs.com',
            subject: 'Application for Backend Developer - Bryan Marquez',
            body: 'Hello,\n\nI am interested in the Backend Developer role.\n\nBest regards,\nBryan Marquez',
            generation: { mode: 'deterministic', warnings: [] },
            blockedReasons: [],
            approvalsRequired: ['salary: requires approval'],
          };
        },
      },
      {
        config: {
          GOOGLE_CLIENT_ID: 'client-id',
          GOOGLE_CLIENT_SECRET: 'client-secret',
          GOOGLE_REDIRECT_URI: 'http://localhost:4300/api/v1/integrations/gmail/callback',
          GOOGLE_GMAIL_LABEL: 'Postulaciones/Por revisar',
          GOOGLE_GMAIL_ALERT_QUERY: 'job alert',
          GOOGLE_GMAIL_MAX_RESULTS: 10,
          GOOGLE_TOKEN_PATH: 'storage/tokens/test.json.enc',
          ENCRYPTION_KEY: 'a'.repeat(64),
        },
        tokenStore: {
          async read() {
            return {
              tokens: { access_token: 'token' },
              emailAddress: 'bryanamg181@gmail.com',
              labelId: 'Label_1',
              labelName: 'Postulaciones/Por revisar',
            };
          },
          async write() {},
          async delete() {},
        },
        oauthClientFactory: () => ({
          setCredentials() {},
        }),
        gmailApiFactory: () => gmailApi,
      },
    );

    const payload = await service.createDraftFromJob('job-1');

    expect(payload.provider).toBe('GMAIL');
    expect(payload.externalId).toBe('gmail-draft-1');
    expect(saveEmailDraft).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith('gmail.draft_created', 'job_offer', 'job-1', expect.any(Object));
  });
});
