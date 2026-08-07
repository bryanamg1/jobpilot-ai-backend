import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { defaultCandidateProfile } from '../../src/config/candidateProfileSeed.js';
import { JOB_STATUS } from '../../src/constants/jobStatus.js';
import { getInMemoryRuntime } from '../../src/repositories/inMemory/inMemoryRuntime.js';
import { resetRepositoryForTests } from '../../src/repositories/repositoryFactory.js';

const fixture = (name) =>
  fs.readFileSync(path.join(import.meta.dirname, '../fixtures', name), 'utf8');

describe('jobs routes', () => {
  beforeEach(() => {
    resetRepositoryForTests();
    const runtime = getInMemoryRuntime();
    runtime.profile = structuredClone(defaultCandidateProfile);
    runtime.automationSettings = null;
    runtime.applications = [];
    runtime.agentRuns = [];
    runtime.resumes = [];
    runtime.offers = [];
    runtime.approvalRequests = [];
    runtime.audits = [];
  });

  it('creates a manual job analysis and exposes it on the dashboard', async () => {
    const app = buildApp();

    const createResponse = await request(app).post('/api/v1/jobs/manual').send({
      rawText: fixture('manual-job-spanish.txt'),
      sourceUrl: 'https://example.com/backend-job',
      sourceLabel: 'Manual test',
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.match.score).toBeGreaterThan(0);
    expect(createResponse.body.data.match.status).toBe(JOB_STATUS.AWAITING_APPROVAL);
    expect(createResponse.body.data.analysis.extraction.mode).toBe('deterministic');

    const dashboardResponse = await request(app).get('/api/v1/dashboard');
    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.body.data.metrics.total).toBe(1);
    expect(dashboardResponse.body.data.metrics.awaitingApproval).toBe(1);
  });

  it('rejects duplicate manual jobs', async () => {
    const app = buildApp();
    const payload = {
      rawText: fixture('manual-job-spanish.txt'),
      sourceUrl: 'https://example.com/backend-job',
      sourceLabel: 'Manual test',
    };

    await request(app).post('/api/v1/jobs/manual').send(payload);
    const duplicateResponse = await request(app).post('/api/v1/jobs/manual').send(payload);

    expect(duplicateResponse.status).toBe(409);
  });

  it('merges OpenAI enrichment when the adapter is enabled', async () => {
    const app = buildApp({
      openAiEnrichmentService: {
        async enrichManualJob() {
          return {
            applied: true,
            mode: 'hybrid',
            provider: 'openai',
            model: 'gpt-5.6-terra',
            warnings: [],
            extracted: {
              title: 'Backend Developer',
              company: 'Acme Labs',
              location: 'Remote LATAM',
              recruiterEmail: 'jobs@acmelabs.com',
              modality: ['remote'],
              seniority: 'junior',
              englishRequirement: 'basic',
              technologies: ['Redis', 'Node.js'],
              requirements: ['Experience with Redis queues'],
              instructions: ['Send your resume to jobs@acmelabs.com'],
              salary: null,
              flags: {
                requiresVisa: false,
                asksForSalary: false,
                legalQuestions: false,
                visibleContactCallToAction: true,
                requiresRelocation: false,
                requiresTravel: false,
                requiresImmediateAvailability: false,
              },
              certaintyMap: [
                {
                  field: 'technology',
                  value: 'Redis',
                  certainty: 'INFERRED',
                  source: 'raw_text',
                },
              ],
              summary: 'Remote backend role aligned with Node.js stack',
            },
          };
        },
      },
    });

    const createResponse = await request(app).post('/api/v1/jobs/manual').send({
      rawText: fixture('manual-job-spanish.txt'),
      sourceUrl: 'https://example.com/backend-job-openai',
      sourceLabel: 'Manual test',
    });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.data.analysis.extraction.mode).toBe('hybrid');
    expect(createResponse.body.data.jobOffer.technologies).toContain('Redis');
    expect(createResponse.body.data.jobOffer.analysisSummary).toContain('Remote backend role');
  });

  it('generates a reviewable draft preview for a compatible analyzed job', async () => {
    const app = buildApp();

    const createResponse = await request(app).post('/api/v1/jobs/manual').send({
      rawText: fixture('manual-job-spanish.txt'),
      sourceUrl: 'https://example.com/backend-job-preview',
      sourceLabel: 'Manual preview',
    });

    const previewResponse = await request(app)
      .post(`/api/v1/jobs/${createResponse.body.data.id}/draft-preview`)
      .send({});

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body.data.status).toBe('REVIEW_REQUIRED');
    expect(previewResponse.body.data.subject).toContain('Backend Developer');
    expect(previewResponse.body.data.body).toContain('Bryan Marquez');
    expect(previewResponse.body.data.generation.mode).toBe('deterministic');
    expect(previewResponse.body.data.suggestedAnswers.some((item) => item.kind === 'salaryExpectation')).toBe(true);
    expect(previewResponse.body.data.suggestedAnswers.some((item) => item.kind === 'englishLevel')).toBe(true);
    expect(previewResponse.body.data.pendingApprovalRequests.length).toBeGreaterThan(0);
  });

  it('blocks draft preview generation when the offer is rejected by rules', async () => {
    const app = buildApp();

    const createResponse = await request(app).post('/api/v1/jobs/manual').send({
      rawText: fixture('manual-job-incompatible.txt'),
      sourceUrl: 'https://example.com/wordpress-job-preview',
      sourceLabel: 'Manual preview',
    });

    const previewResponse = await request(app)
      .post(`/api/v1/jobs/${createResponse.body.data.id}/draft-preview`)
      .send({});

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body.data.status).toBe('BLOCKED');
    expect(previewResponse.body.data.subject).toBeNull();
    expect(previewResponse.body.data.blockedReasons.length).toBeGreaterThan(0);
  });

  it('approves a job that is awaiting human review', async () => {
    const app = buildApp();

    const createResponse = await request(app).post('/api/v1/jobs/manual').send({
      rawText: fixture('manual-job-spanish.txt'),
      sourceUrl: 'https://example.com/backend-job-approve',
      sourceLabel: 'Manual approval',
    });

    const approveResponse = await request(app)
      .post(`/api/v1/jobs/${createResponse.body.data.id}/approve`)
      .send({ reason: 'Salario y alcance revisados manualmente.' });

    expect(approveResponse.status).toBe(200);
    expect(approveResponse.body.data.match.status).toBe(JOB_STATUS.APPROVED);
    expect(approveResponse.body.data.analysis.review.decision).toBe('approved');
  });

  it('rejects a job that is awaiting human review', async () => {
    const app = buildApp();

    const createResponse = await request(app).post('/api/v1/jobs/manual').send({
      rawText: fixture('manual-job-spanish.txt'),
      sourceUrl: 'https://example.com/backend-job-reject',
      sourceLabel: 'Manual rejection',
    });

    const rejectResponse = await request(app)
      .post(`/api/v1/jobs/${createResponse.body.data.id}/reject`)
      .send({ reason: 'No es una prioridad en este momento.' });

    expect(rejectResponse.status).toBe(200);
    expect(rejectResponse.body.data.match.status).toBe(JOB_STATUS.REJECTED);
    expect(rejectResponse.body.data.analysis.review.decision).toBe('rejected');
  });

  it('assigns a selected resume to a job and exposes it in the preview', async () => {
    const app = buildApp();

    const resumeResponse = await request(app).post('/api/v1/resumes').send({
      label: 'Backend CV',
      fileName: 'Bryan-Marquez-Backend.pdf',
      mimeType: 'application/pdf',
      contentBase64: Buffer.from('resume content', 'utf8').toString('base64'),
    });

    const createResponse = await request(app).post('/api/v1/jobs/manual').send({
      rawText: fixture('manual-job-spanish.txt'),
      sourceUrl: 'https://example.com/backend-job-resume',
      sourceLabel: 'Manual with resume',
    });

    const assignResponse = await request(app)
      .post(`/api/v1/jobs/${createResponse.body.data.id}/select-resume`)
      .send({ resumeId: resumeResponse.body.data.id });

    expect(assignResponse.status).toBe(200);
    expect(assignResponse.body.data.selectedResume.label).toBe('Backend CV');

    const previewResponse = await request(app)
      .post(`/api/v1/jobs/${createResponse.body.data.id}/draft-preview`)
      .send({});

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body.data.selectedResume.label).toBe('Backend CV');
    expect(previewResponse.body.data.generation.warnings).toContain(
      'CV seleccionado: Backend CV. Antes de enviar, adjuntalo manualmente en Gmail.',
    );
  });

  it('creates a manual dry-run application and records a duplicate on a repeated trigger', async () => {
    const app = buildApp();

    const createResponse = await request(app).post('/api/v1/jobs/manual').send({
      rawText: [
        'Junior Backend Developer - Remote at Acme Labs',
        'Company: Acme Labs',
        'Location: Remote LATAM',
        'We are hiring a Junior Backend Developer with Node.js, Express, MySQL, Docker and REST APIs.',
        'Requirements: JavaScript, testing, Git and remote collaboration.',
        'Send your resume to jobs@acmelabs.com',
      ].join('\n'),
      sourceUrl: 'https://example.com/backend-job-dry-run',
      sourceLabel: 'Manual dry run',
    });

    const firstResponse = await request(app)
      .post(`/api/v1/jobs/${createResponse.body.data.id}/dry-run-application`)
      .send({});

    expect(firstResponse.status).toBe(201);
    expect(firstResponse.body.data.status).toBe('COMPLETED');
    expect(firstResponse.body.data.metadata.result).toBe('COMPLETED');
    expect(firstResponse.body.data.metadata.dryRunEvidence.recipient).toBe('jobs@acmelabs.com');

    const duplicateResponse = await request(app)
      .post(`/api/v1/jobs/${createResponse.body.data.id}/dry-run-application`)
      .send({});

    expect(duplicateResponse.status).toBe(201);
    expect(duplicateResponse.body.data.status).toBe('BLOCKED_BY_CONFIGURATION');
    expect(duplicateResponse.body.data.metadata.result).toBe('DUPLICATE');
  });

  it('keeps a dry-run application awaiting approval when sensitive approvals are unresolved', async () => {
    const app = buildApp();

    const createResponse = await request(app).post('/api/v1/jobs/manual').send({
      rawText: fixture('manual-job-spanish.txt'),
      sourceUrl: 'https://example.com/backend-job-awaiting-approval',
      sourceLabel: 'Manual dry run approval',
    });

    const dryRunResponse = await request(app)
      .post(`/api/v1/jobs/${createResponse.body.data.id}/dry-run-application`)
      .send({});

    expect(dryRunResponse.status).toBe(201);
    expect(dryRunResponse.body.data.status).toBe('AWAITING_APPROVAL');
    expect(dryRunResponse.body.data.metadata.result).toBe('AWAITING_APPROVAL');
  });
});
