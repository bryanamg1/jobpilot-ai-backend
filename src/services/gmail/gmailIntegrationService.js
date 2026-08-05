import path from 'node:path';
import { randomUUID, createHmac } from 'node:crypto';
import { google } from 'googleapis';
import { env } from '../../config/env.js';
import { HttpError } from '../../lib/httpError.js';
import { createSealedJsonStore } from '../../lib/sealedJsonStore.js';

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.labels',
];

const DRAFT_LABEL_NOTE =
  'Gmail drafts only support the built-in DRAFT label. The review label is created for future alert-message workflows and internal tracking.';

export function createGmailIntegrationService(repository, auditService, jobDraftService, options = {}) {
  const config = options.config ?? env;
  const tokenStore =
    options.tokenStore ??
    createSealedJsonStore(resolveTokenPath(config), config.ENCRYPTION_KEY ?? 'jobpilot-local-key');
  const oauthClientFactory =
    options.oauthClientFactory ?? (() => createOAuthClient(config));
  const gmailApiFactory = options.gmailApiFactory ?? ((auth) => google.gmail({ version: 'v1', auth }));

  return {
    async getStatus() {
      const configured = isConfigured(config);
      if (!configured) {
        return {
          configured: false,
          connected: false,
          emailAddress: null,
          labelName: config.GOOGLE_GMAIL_LABEL,
          draftLabelNote: DRAFT_LABEL_NOTE,
          alertQuery: config.GOOGLE_GMAIL_ALERT_QUERY,
        };
      }

      const session = await tokenStore.read();
      return {
        configured: true,
        connected: Boolean(session?.tokens),
        emailAddress: session?.emailAddress ?? null,
        labelName: config.GOOGLE_GMAIL_LABEL,
        labelReady: Boolean(session?.labelId),
        draftLabelNote: DRAFT_LABEL_NOTE,
        alertQuery: config.GOOGLE_GMAIL_ALERT_QUERY,
        scopes: GMAIL_SCOPES,
      };
    },

    async getAuthUrl() {
      ensureConfigured(config);
      const oauthClient = oauthClientFactory();
      const state = signState({ nonce: randomUUID(), createdAt: Date.now() }, config.ENCRYPTION_KEY ?? 'jobpilot-local-key');

      return {
        url: oauthClient.generateAuthUrl({
          access_type: 'offline',
          prompt: 'consent',
          scope: GMAIL_SCOPES,
          state,
        }),
      };
    },

    async handleCallback({ code, state }) {
      ensureConfigured(config);
      verifyState(state, config.ENCRYPTION_KEY ?? 'jobpilot-local-key');

      const oauthClient = oauthClientFactory();
      const { tokens } = await oauthClient.getToken(code);
      oauthClient.setCredentials(tokens);

      const gmail = gmailApiFactory(oauthClient);
      const profile = await gmail.users.getProfile({ userId: 'me' });
      const labelId = await ensureLabel(gmail, config.GOOGLE_GMAIL_LABEL);

      await tokenStore.write({
        tokens,
        emailAddress: profile.data.emailAddress ?? null,
        labelId,
        labelName: config.GOOGLE_GMAIL_LABEL,
        connectedAt: new Date().toISOString(),
      });

      await auditService.record('gmail.oauth_connected', 'integration', 'gmail', {
        emailAddress: profile.data.emailAddress ?? null,
        labelId,
      });

      return {
        connected: true,
        emailAddress: profile.data.emailAddress ?? null,
        redirectUrl: `${config.FRONTEND_ORIGIN}/?gmail=connected`,
      };
    },

    async disconnect() {
      await tokenStore.delete();
      await auditService.record('gmail.oauth_disconnected', 'integration', 'gmail', {});
      return { disconnected: true };
    },

    async listAlerts(queryInput, maxResultsInput) {
      const { gmail } = await getAuthenticatedClients(config, tokenStore, oauthClientFactory, gmailApiFactory);
      const query = queryInput || config.GOOGLE_GMAIL_ALERT_QUERY;
      const maxResults = maxResultsInput ?? config.GOOGLE_GMAIL_MAX_RESULTS;

      const listResponse = await gmail.users.messages.list({
        userId: 'me',
        q: query,
        maxResults,
      });

      const messages = await Promise.all(
        (listResponse.data.messages ?? []).map(async (message) => {
          const detail = await gmail.users.messages.get({
            userId: 'me',
            id: message.id,
            format: 'metadata',
            metadataHeaders: ['From', 'Subject', 'Date'],
          });

          const headers = new Map(
            (detail.data.payload?.headers ?? []).map((header) => [header.name, header.value ?? '']),
          );

          return {
            id: message.id,
            threadId: message.threadId,
            from: headers.get('From') ?? '',
            subject: headers.get('Subject') ?? '',
            date: headers.get('Date') ?? '',
            snippet: detail.data.snippet ?? '',
          };
        }),
      );

      await auditService.record('gmail.alerts_listed', 'integration', 'gmail', {
        query,
        count: messages.length,
      });

      return {
        query,
        messages,
      };
    },

    async createDraftFromJob(jobId) {
      const { gmail, session } = await getAuthenticatedClients(config, tokenStore, oauthClientFactory, gmailApiFactory);
      const preview = await jobDraftService.createPreview(jobId);

      if (preview.status === 'BLOCKED') {
        throw new HttpError(409, 'Draft creation is blocked for this offer', {
          blockedReasons: preview.blockedReasons,
        });
      }

      if (!preview.recipient) {
        throw new HttpError(400, 'Recipient email is not visible in the source', {
          warnings: preview.generation.warnings,
        });
      }

      const mimeMessage = buildMimeMessage(preview);
      const response = await gmail.users.drafts.create({
        userId: 'me',
        requestBody: {
          message: {
            raw: Buffer.from(mimeMessage).toString('base64url'),
          },
        },
      });

      const record = {
        id: randomUUID(),
        applicationId: null,
        provider: 'GMAIL',
        draftExternalId: response.data.id ?? null,
        toEmail: preview.recipient,
        subjectLine: preview.subject,
        bodyText: preview.body,
        metadata: {
          jobId,
          jobTitle: preview.jobTitle,
          company: preview.company,
          score: preview.score,
          matchStatus: preview.matchStatus,
          generationMode: preview.generation.mode,
          warnings: [
            ...preview.generation.warnings,
            preview.selectedResume
              ? `Attach the selected CV manually before sending: ${preview.selectedResume.label} (${preview.selectedResume.originalFileName}).`
              : 'No CV is selected for this job yet. Attach the correct CV manually before sending.',
            DRAFT_LABEL_NOTE,
          ],
          selectedResume: preview.selectedResume,
          labelName: session.labelName ?? config.GOOGLE_GMAIL_LABEL,
          labelId: session.labelId ?? null,
        },
      };

      await repository.saveEmailDraft(record);
      await auditService.record('gmail.draft_created', 'job_offer', jobId, {
        draftExternalId: record.draftExternalId,
        recipient: record.toEmail,
      });

      return {
        externalId: record.draftExternalId,
        recipient: record.toEmail,
        subject: record.subjectLine,
        provider: record.provider,
        labelName: config.GOOGLE_GMAIL_LABEL,
        draftLabelNote: DRAFT_LABEL_NOTE,
        attachmentStatus: 'MANUAL_REQUIRED',
        selectedResume: preview.selectedResume,
        warnings: record.metadata.warnings,
      };
    },
  };
}

function resolveTokenPath(config) {
  return path.resolve(process.cwd(), config.GOOGLE_TOKEN_PATH);
}

function isConfigured(config) {
  return Boolean(config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET && config.GOOGLE_REDIRECT_URI);
}

function ensureConfigured(config) {
  if (!isConfigured(config)) {
    throw new HttpError(400, 'Google OAuth is not fully configured');
  }
}

function createOAuthClient(config) {
  return new google.auth.OAuth2(
    config.GOOGLE_CLIENT_ID,
    config.GOOGLE_CLIENT_SECRET,
    config.GOOGLE_REDIRECT_URI,
  );
}

async function getAuthenticatedClients(config, tokenStore, oauthClientFactory, gmailApiFactory) {
  ensureConfigured(config);

  const session = await tokenStore.read();
  if (!session?.tokens) {
    throw new HttpError(401, 'Gmail is not connected');
  }

  const oauthClient = oauthClientFactory();
  oauthClient.setCredentials(session.tokens);

  return {
    oauthClient,
    gmail: gmailApiFactory(oauthClient),
    session,
  };
}

async function ensureLabel(gmail, labelName) {
  const listResponse = await gmail.users.labels.list({ userId: 'me' });
  const existing = (listResponse.data.labels ?? []).find((label) => label.name === labelName);
  if (existing?.id) {
    return existing.id;
  }

  const createResponse = await gmail.users.labels.create({
    userId: 'me',
    requestBody: {
      name: labelName,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show',
    },
  });

  return createResponse.data.id ?? null;
}

function signState(payload, secret) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
}

function verifyState(state, secret) {
  const [encodedPayload, signature] = String(state).split('.');
  const expectedSignature = createHmac('sha256', secret).update(encodedPayload).digest('base64url');

  if (!encodedPayload || !signature || signature !== expectedSignature) {
    throw new HttpError(400, 'Invalid OAuth state');
  }

  const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
  if (Date.now() - Number(payload.createdAt ?? 0) > 15 * 60_000) {
    throw new HttpError(400, 'OAuth state expired');
  }

  return payload;
}

function buildMimeMessage(preview) {
  return [
    `To: ${preview.recipient}`,
    `Subject: ${sanitizeHeader(preview.subject)}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
    '',
    preview.body,
    '',
    `Original source: ${preview.sourceUrl ?? 'N/A'}`,
    `Compatibility score: ${preview.score}`,
    `Internal reference: ${preview.jobId}`,
  ].join('\r\n');
}

function sanitizeHeader(value) {
  return String(value).replace(/\r?\n/g, ' ').trim();
}
