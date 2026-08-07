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
            subject: 'Postulacion para Backend Developer - Bryan Marquez',
            body: 'Hola,\n\nMe interesa la vacante de Backend Developer.\n\nSaludos,\nBryan Marquez',
            generation: { mode: 'deterministic', warnings: [] },
            blockedReasons: [],
            approvalsRequired: ['salary: requiere aprobacion'],
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
    expect(payload.attachmentStatus).toBe('MANUAL_REQUIRED');
    expect(saveEmailDraft).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith('gmail.draft_created', 'job_offer', 'job-1', expect.any(Object));
  });

  it('attaches the selected local resume automatically when the stored file is available', async () => {
    const saveEmailDraft = vi.fn(async (record) => record);
    const recordAudit = vi.fn(async () => ({}));
    const gmailApi = {
      users: {
        drafts: {
          create: vi.fn().mockResolvedValue({
            data: { id: 'gmail-draft-2' },
          }),
        },
      },
    };
    const readFileFn = vi.fn(async () => Buffer.from('fake-pdf-content'));

    const service = createGmailIntegrationService(
      {
        getResumeById: vi.fn(async () => ({
          id: 'resume-1',
          label: 'Backend CV EN',
          filePath: 'storage/resumes/backend-cv-en.pdf',
          metadata: {
            originalFileName: 'Bryan-Marquez-Backend-CV.pdf',
            mimeType: 'application/pdf',
            sizeBytes: 2048,
          },
        })),
        saveEmailDraft,
      },
      {
        record: recordAudit,
      },
      {
        async createPreview() {
          return {
            jobId: 'job-attach-1',
            jobTitle: 'Backend Developer',
            company: 'Acme Labs',
            sourceUrl: 'https://example.com/job-attach-1',
            matchStatus: 'APPROVED',
            score: 90,
            status: 'READY',
            recipient: 'jobs@acmelabs.com',
            subject: 'Postulacion para Backend Developer - Bryan Marquez',
            body: 'Hola,\n\nMe interesa la vacante de Backend Developer.\n\nSaludos,\nBryan Marquez',
            generation: { mode: 'deterministic', warnings: [] },
            blockedReasons: [],
            approvalsRequired: [],
            selectedResume: {
              id: 'resume-1',
              label: 'Backend CV EN',
              originalFileName: 'Bryan-Marquez-Backend-CV.pdf',
            },
            approvalRequests: [],
            pendingApprovalRequests: [],
            rejectedApprovalRequests: [],
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
        readFileFn,
      },
    );

    const payload = await service.createDraftFromJob('job-attach-1');

    expect(readFileFn).toHaveBeenCalledTimes(1);
    expect(payload.attachmentStatus).toBe('ATTACHED');
    expect(payload.attachedResume).toEqual({
      id: 'resume-1',
      label: 'Backend CV EN',
      originalFileName: 'Bryan-Marquez-Backend-CV.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 2048,
    });
    expect(payload.warnings).toContain(
      'CV adjunto automaticamente: Backend CV EN (Bryan-Marquez-Backend-CV.pdf).',
    );
    expect(gmailApi.users.drafts.create).toHaveBeenCalledTimes(1);
    expect(saveEmailDraft).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          attachedResume: expect.objectContaining({
            id: 'resume-1',
          }),
        }),
      }),
    );
    expect(recordAudit).toHaveBeenCalledWith('gmail.draft_created', 'job_offer', 'job-attach-1', {
      draftExternalId: 'gmail-draft-2',
      recipient: 'jobs@acmelabs.com',
      attachmentStatus: 'ATTACHED',
      attachedResumeId: 'resume-1',
    });
  });

  it('blocks draft creation when there are unresolved sensitive approval requests', async () => {
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
          return {
            jobId: 'job-2',
            jobTitle: 'Backend Developer',
            company: 'Acme Labs',
            sourceUrl: 'https://example.com/job-2',
            matchStatus: 'AWAITING_APPROVAL',
            score: 78,
            status: 'REVIEW_REQUIRED',
            recipient: 'jobs@acmelabs.com',
            subject: 'Postulacion para Backend Developer - Bryan Marquez',
            body: 'Hola,\n\nMe interesa la vacante de Backend Developer.\n\nSaludos,\nBryan Marquez',
            generation: { mode: 'deterministic', warnings: [] },
            blockedReasons: [],
            approvalsRequired: ['salary: requiere aprobacion'],
            pendingApprovalRequests: [
              {
                id: 'approval-1',
                approvalKind: 'salaryExpectation',
                status: 'PENDING',
              },
            ],
            rejectedApprovalRequests: [],
            approvalRequests: [
              {
                id: 'approval-1',
                approvalKind: 'salaryExpectation',
                status: 'PENDING',
              },
            ],
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
        gmailApiFactory: () => ({
          users: {
            drafts: {
              create: vi.fn(),
            },
          },
        }),
      },
    );

    await expect(service.createDraftFromJob('job-2')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Antes de crear el borrador de Gmail debes resolver las aprobaciones sensibles pendientes.',
    });
  });
});

