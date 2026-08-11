import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import { createMysqlRepository } from '../../src/repositories/mysql/mysqlRepository.js';
import { getMysqlPool } from '../../src/repositories/mysql/mysqlClient.js';

const runMysqlTests =
  process.env.JOBPILOT_RUN_MYSQL_TESTS === 'true' &&
  env.mysqlConfigured &&
  process.env.JOBPILOT_MYSQL_TEST_ACK === 'true' &&
  /\b(test|ci)\b/i.test(env.MYSQL_DATABASE ?? '');

const describeMysql = runMysqlTests ? describe : describe.skip;

describeMysql('automation routes (mysql opt-in)', () => {
  let app;
  let repository;
  let pool;
  let baselineSettings;
  const jobIds = new Set();
  const sourceIds = new Set();
  const applicationIds = new Set();
  const agentRunIds = new Set();

  beforeAll(async () => {
    repository = createMysqlRepository();
    pool = getMysqlPool();
    baselineSettings = await repository.getAutomationSettings();
    app = buildApp({
      repository,
      startAutomationScheduler: false,
      openAiEnrichmentService: {
        async enrichManualJob() {
          return {
            applied: false,
            mode: 'deterministic',
            provider: 'test',
            model: null,
            warnings: [],
          };
        },
      },
      jobDraftService: {
        async createPreview(jobId) {
          const jobAnalysis = await repository.getJobAnalysisById(jobId);
          return {
            jobId,
            company: jobAnalysis.jobOffer.company,
            status: 'READY',
            recipient: jobAnalysis.jobOffer.recruiterEmail,
            subject: `Postulacion para ${jobAnalysis.jobOffer.title} - Bryan Marquez`,
            body: 'Vista previa de prueba MySQL con activacion manual',
            generation: {
              mode: 'deterministic',
              warnings: [],
            },
            highlightedFacts: [],
            highlights: [],
            blockedReasons: [],
            approvalsRequired: [],
            approvalRequests: [],
            pendingApprovalRequests: [],
            rejectedApprovalRequests: [],
            suggestedAnswers: [],
            factsUsed: [],
            selectedResume: null,
          };
        },
      },
    });
  });

  afterAll(async () => {
    await cleanupArtifacts(pool, {
      jobIds: [...jobIds],
      sourceIds: [...sourceIds],
      applicationIds: [...applicationIds],
      agentRunIds: [...agentRunIds],
    });

    if (baselineSettings) {
      await repository.saveAutomationSettings(baselineSettings);
    } else {
      await pool.query(`DELETE FROM automation_settings WHERE id = 'default'`);
    }
  });

  it('persists a DRY_RUN automation cycle in MySQL when explicitly enabled', async () => {
    const uniqueKey = `mysql-optin-${Date.now()}`;
    const timezone = 'America/Argentina/Buenos_Aires';
    const baselineDailyCompleted = await repository.countCompletedApplicationsForDate(
      buildDateKey(timezone),
    );
    const createResponse = await request(app).post('/api/v1/jobs/manual').send({
      rawText: [
        'Junior Backend Developer - Remote at MySQL Validation Labs',
        'Company: MySQL Validation Labs',
        'Location: Remote LATAM',
        'We are hiring a Junior Backend Developer with Node.js, Express, MySQL and Docker.',
        'Requirements: JavaScript, REST APIs, Git and remote collaboration.',
        `Send your resume to ${uniqueKey}@jobs.example`,
      ].join('\n'),
      sourceUrl: `https://example.com/jobpilot/${uniqueKey}`,
      sourceLabel: 'Prueba MySQL de automatizacion con activacion manual',
    });

    expect(createResponse.status).toBe(201);
    jobIds.add(createResponse.body.data.id);
    sourceIds.add(createResponse.body.data.source.id);

    const settingsResponse = await request(app).put('/api/v1/automation/settings').send({
      enabled: true,
      mode: 'DRY_RUN',
      timezone,
      dailyApplicationLimit: baselineDailyCompleted + 1,
      dailyDiscoveryLimit: 3,
      minimumMatchScore: 50,
      requireHumanApproval: true,
      unknownQuestionPolicy: 'PAUSE',
      captchaPolicy: 'PAUSE',
      mfaPolicy: 'PAUSE',
      salaryRequiresApproval: true,
      startTime: '00:00',
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      filters: {
        allowedSources: ['MANUAL'],
        allowedRoles: ['backend'],
        allowedSeniorities: ['junior', 'unknown'],
        allowedWorkModes: ['remote', 'hybrid', 'onsite'],
        blockedCompanies: [],
        blockedKeywords: [],
      },
      sourcePolicies: {
        MANUAL: 'AUTO_PREPARE',
        LINKEDIN_JOBS_SUPERVISED: 'AUTO_PREPARE',
        LINKEDIN_FEED_SUPERVISED: 'AUTO_PREPARE',
        LINKEDIN_POST_SEARCH_SUPERVISED: 'AUTO_PREPARE',
      },
    });

    expect(settingsResponse.status).toBe(200);

    const runResponse = await request(app).post('/api/v1/automation/runs').send({
      reason: 'Validacion de integracion MySQL con activacion manual',
    });

    expect(runResponse.status).toBe(201);
    expect(runResponse.body.data.status).toBe('COMPLETED');
    expect(runResponse.body.data.metadata.summary.total).toBe(1);
    expect(runResponse.body.data.metadata.summary.completed).toBe(1);

    agentRunIds.add(runResponse.body.data.id);
    for (const processed of runResponse.body.data.metadata.processed ?? []) {
      applicationIds.add(processed.applicationId);
    }

    const dashboardResponse = await request(app).get('/api/v1/dashboard');

    expect(dashboardResponse.status).toBe(200);
    expect(dashboardResponse.body.data.storageMode).toBe('mysql');
    expect(dashboardResponse.body.data.automation.settings).toBeTruthy();
    expect(dashboardResponse.body.data.automation.dailyCompleted).toBeGreaterThanOrEqual(1);
    expect(
      dashboardResponse.body.data.applications.some(
        (item) => item.jobOfferId === createResponse.body.data.id && item.status === 'COMPLETED',
      ),
    ).toBe(true);
    expect(
      dashboardResponse.body.data.agentRuns.some((item) => item.id === runResponse.body.data.id && item.status === 'COMPLETED'),
    ).toBe(true);
  });
});

function buildDateKey(timezone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

async function cleanupArtifacts(pool, artifacts) {
  if (artifacts.applicationIds.length) {
    await pool.query(
      `DELETE FROM email_drafts WHERE application_id IN (${artifacts.applicationIds.map(() => '?').join(', ')})`,
      artifacts.applicationIds,
    );
    await pool.query(
      `DELETE FROM application_answers WHERE application_id IN (${artifacts.applicationIds.map(() => '?').join(', ')})`,
      artifacts.applicationIds,
    );
    await pool.query(
      `DELETE FROM audit_events WHERE entity_type = 'application' AND entity_id IN (${artifacts.applicationIds.map(() => '?').join(', ')})`,
      artifacts.applicationIds,
    );
    await pool.query(
      `DELETE FROM applications WHERE id IN (${artifacts.applicationIds.map(() => '?').join(', ')})`,
      artifacts.applicationIds,
    );
  }

  if (artifacts.agentRunIds.length) {
    await pool.query(
      `DELETE FROM audit_events WHERE entity_type = 'agent_run' AND entity_id IN (${artifacts.agentRunIds.map(() => '?').join(', ')})`,
      artifacts.agentRunIds,
    );
    await pool.query(
      `DELETE FROM agent_runs WHERE id IN (${artifacts.agentRunIds.map(() => '?').join(', ')})`,
      artifacts.agentRunIds,
    );
  }

  if (artifacts.jobIds.length) {
    await pool.query(
      `DELETE FROM approval_requests WHERE entity_type = 'job_offer' AND entity_id IN (${artifacts.jobIds.map(() => '?').join(', ')})`,
      artifacts.jobIds,
    );
    await pool.query(
      `DELETE FROM audit_events WHERE entity_type = 'job_offer' AND entity_id IN (${artifacts.jobIds.map(() => '?').join(', ')})`,
      artifacts.jobIds,
    );
    await pool.query(
      `DELETE FROM job_matches WHERE job_offer_id IN (${artifacts.jobIds.map(() => '?').join(', ')})`,
      artifacts.jobIds,
    );
    await pool.query(
      `DELETE FROM job_offers WHERE id IN (${artifacts.jobIds.map(() => '?').join(', ')})`,
      artifacts.jobIds,
    );
  }

  if (artifacts.sourceIds.length) {
    await pool.query(
      `DELETE FROM job_sources WHERE id IN (${artifacts.sourceIds.map(() => '?').join(', ')})`,
      artifacts.sourceIds,
    );
  }
}
