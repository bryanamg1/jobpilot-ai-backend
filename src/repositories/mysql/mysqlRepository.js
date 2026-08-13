import { defaultCandidateProfile } from '../../config/candidateProfileSeed.js';
import { createCandidateFactRows } from '../../domain/candidateProfile.js';
import { getMysqlPool } from './mysqlClient.js';

export function createMysqlRepository() {
  const pool = getMysqlPool();
  const profileId = defaultCandidateProfile.id;

  return {
    mode: 'mysql',
    async getCandidateProfile() {
      await ensureCandidateProfile(pool, defaultCandidateProfile);
      return readCandidateProfile(pool, profileId);
    },
    async updateCandidateProfile(profile) {
      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();
        await upsertCandidateProfile(connection, profile);
        await replaceCandidateFacts(connection, profile.id, profile.facts);
        await connection.commit();
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }

      return readCandidateProfile(pool, profile.id);
    },
    async listResumes() {
      await ensureCandidateProfile(pool, defaultCandidateProfile);

      const [rows] = await pool.query(
        `
          SELECT id, candidate_profile_id, label, file_path, metadata_json, created_at, updated_at
          FROM resumes
          WHERE candidate_profile_id = ? AND deleted_at IS NULL
          ORDER BY updated_at DESC, created_at DESC
          LIMIT 100
        `,
        [profileId],
      );

      return rows.map(mapResumeRow);
    },
    async getResumeById(resumeId) {
      const [rows] = await pool.query(
        `
          SELECT id, candidate_profile_id, label, file_path, metadata_json, created_at, updated_at
          FROM resumes
          WHERE id = ? AND deleted_at IS NULL
          LIMIT 1
        `,
        [resumeId],
      );

      return rows[0] ? mapResumeRow(rows[0]) : null;
    },
    async saveResume(record) {
      await ensureCandidateProfile(pool, defaultCandidateProfile);

      await pool.query(
        `
          INSERT INTO resumes (
            id,
            candidate_profile_id,
            label,
            file_path,
            metadata_json,
            created_at,
            updated_at,
            deleted_at
          ) VALUES (?, ?, ?, ?, ?, NOW(), NOW(), NULL)
        `,
        [
          record.id,
          record.candidateProfileId,
          record.label,
          record.filePath,
          JSON.stringify(record.metadata),
        ],
      );

      return record;
    },
    async getAutomationSettings() {
      const [rows] = await pool.query(
        `
          SELECT id, enabled, mode, timezone, daily_application_limit, daily_discovery_limit,
            minimum_match_score, require_human_approval, unknown_question_policy, captcha_policy,
            mfa_policy, salary_requires_approval, start_time, days_of_week, filters_json,
            source_policies_json, version, last_triggered_at, created_at, updated_at
          FROM automation_settings
          WHERE id = 'default'
          LIMIT 1
        `,
      );

      return rows[0] ? mapAutomationSettingsRow(rows[0]) : null;
    },
    async saveAutomationSettings(record) {
      await pool.query(
        `
          INSERT INTO automation_settings (
            id, enabled, mode, timezone, daily_application_limit, daily_discovery_limit,
            minimum_match_score, require_human_approval, unknown_question_policy, captcha_policy,
            mfa_policy, salary_requires_approval, start_time, days_of_week, filters_json,
            source_policies_json, version, last_triggered_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
          ON DUPLICATE KEY UPDATE
            enabled = VALUES(enabled),
            mode = VALUES(mode),
            timezone = VALUES(timezone),
            daily_application_limit = VALUES(daily_application_limit),
            daily_discovery_limit = VALUES(daily_discovery_limit),
            minimum_match_score = VALUES(minimum_match_score),
            require_human_approval = VALUES(require_human_approval),
            unknown_question_policy = VALUES(unknown_question_policy),
            captcha_policy = VALUES(captcha_policy),
            mfa_policy = VALUES(mfa_policy),
            salary_requires_approval = VALUES(salary_requires_approval),
            start_time = VALUES(start_time),
            days_of_week = VALUES(days_of_week),
            filters_json = VALUES(filters_json),
            source_policies_json = VALUES(source_policies_json),
            version = VALUES(version),
            last_triggered_at = VALUES(last_triggered_at),
            updated_at = NOW()
        `,
        [
          record.id,
          record.enabled ? 1 : 0,
          record.mode,
          record.timezone,
          record.dailyApplicationLimit,
          record.dailyDiscoveryLimit,
          record.minimumMatchScore,
          record.requireHumanApproval ? 1 : 0,
          record.unknownQuestionPolicy,
          record.captchaPolicy,
          record.mfaPolicy,
          record.salaryRequiresApproval ? 1 : 0,
          record.startTime,
          JSON.stringify(record.daysOfWeek),
          JSON.stringify(record.filters),
          JSON.stringify(record.sourcePolicies),
          record.version,
          normalizeMysqlDateTime(record.lastTriggeredAt),
        ],
      );

      return record;
    },
    async listApplications(filters = {}) {
      const clauses = ['deleted_at IS NULL'];
      const params = [];

      if (filters.jobOfferId) {
        clauses.push('job_offer_id = ?');
        params.push(filters.jobOfferId);
      }

      if (filters.status) {
        clauses.push('status = ?');
        params.push(filters.status);
      }

      const [rows] = await pool.query(
        `
          SELECT id, job_offer_id, status, submitted_at, metadata_json, created_at, updated_at
          FROM applications
          WHERE ${clauses.join(' AND ')}
          ORDER BY created_at DESC
          LIMIT ?
        `,
        [...params, filters.limit ?? 50],
      );

      return rows.map(mapApplicationRow);
    },
    async findLatestApplicationByJobId(jobId) {
      const [rows] = await pool.query(
        `
          SELECT id, job_offer_id, status, submitted_at, metadata_json, created_at, updated_at
          FROM applications
          WHERE job_offer_id = ? AND deleted_at IS NULL
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [jobId],
      );

      return rows[0] ? mapApplicationRow(rows[0]) : null;
    },
    async saveApplication(record) {
      await pool.query(
        `
          INSERT INTO applications (
            id,
            job_offer_id,
            status,
            submitted_at,
            metadata_json,
            created_at,
            updated_at,
            deleted_at
          ) VALUES (?, ?, ?, ?, ?, NOW(), NOW(), NULL)
        `,
        [
          record.id,
          record.jobOfferId,
          record.status,
          normalizeMysqlDateTime(record.submittedAt),
          JSON.stringify({
            ...record.metadata,
            mode: record.mode,
            trigger: record.trigger,
          }),
        ],
      );
      return record;
    },
    async countCompletedApplicationsForDate(dateKey) {
      const [rows] = await pool.query(
        `
          SELECT COUNT(*) AS total
          FROM applications
          WHERE deleted_at IS NULL
            AND status = 'COMPLETED'
            AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.dateKey')) = ?
        `,
        [dateKey],
      );

      return Number(rows[0]?.total ?? 0);
    },
    async listAgentRuns(filters = {}) {
      const [rows] = await pool.query(
        `
          SELECT id, source_type, status, metadata_json, started_at, finished_at, created_at
          FROM agent_runs
          ORDER BY started_at DESC, created_at DESC
          LIMIT ?
        `,
        [filters.limit ?? 20],
      );
      return rows.map(mapAgentRunRow);
    },
    async saveAgentRun(record) {
      await pool.query(
        `
          INSERT INTO agent_runs (
            id, source_type, status, metadata_json, started_at, finished_at, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, NOW())
        `,
        [
          record.id,
          record.sourceType,
          record.status,
          JSON.stringify(record.metadata),
          normalizeMysqlDateTime(record.startedAt),
          normalizeMysqlDateTime(record.finishedAt),
        ],
      );
      return record;
    },
    async updateAgentRun(record) {
      await pool.query(
        `
          UPDATE agent_runs
          SET source_type = ?, status = ?, metadata_json = ?, started_at = ?, finished_at = ?
          WHERE id = ?
        `,
        [
          record.sourceType,
          record.status,
          JSON.stringify(record.metadata),
          normalizeMysqlDateTime(record.startedAt),
          normalizeMysqlDateTime(record.finishedAt),
          record.id,
        ],
      );
      return record;
    },
    async listDesktopAgents(filters = {}) {
      const [rows] = await pool.query(
        `
          SELECT id, status, version, os, hostname, metadata_json, last_heartbeat_at, created_at, updated_at
          FROM desktop_agents
          ORDER BY updated_at DESC, created_at DESC
          LIMIT ?
        `,
        [filters.limit ?? 20],
      );

      return rows.map(mapDesktopAgentRow);
    },
    async getDesktopAgentById(agentId) {
      const [rows] = await pool.query(
        `
          SELECT id, status, version, os, hostname, metadata_json, last_heartbeat_at, created_at, updated_at
          FROM desktop_agents
          WHERE id = ?
          LIMIT 1
        `,
        [agentId],
      );

      return rows[0] ? mapDesktopAgentRow(rows[0]) : null;
    },
    async saveDesktopAgent(record) {
      await pool.query(
        `
          INSERT INTO desktop_agents (
            id, status, version, os, hostname, metadata_json, last_heartbeat_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `,
        [
          record.id,
          record.status,
          record.version,
          record.os,
          record.hostname,
          JSON.stringify(record.metadata),
          normalizeMysqlDateTime(record.lastHeartbeatAt),
        ],
      );

      return record;
    },
    async updateDesktopAgent(record) {
      await pool.query(
        `
          UPDATE desktop_agents
          SET status = ?, version = ?, os = ?, hostname = ?, metadata_json = ?, last_heartbeat_at = ?, updated_at = NOW()
          WHERE id = ?
        `,
        [
          record.status,
          record.version,
          record.os,
          record.hostname,
          JSON.stringify(record.metadata),
          normalizeMysqlDateTime(record.lastHeartbeatAt),
          record.id,
        ],
      );

      return record;
    },
    async saveBrowserJob(record) {
      await pool.query(
        `
          INSERT INTO browser_jobs (
            id, session_id, agent_id, job_type, status, payload_json, result_json, error_json, claimed_at, completed_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `,
        [
          record.id,
          record.sessionId,
          record.agentId,
          record.jobType,
          record.status,
          JSON.stringify(record.payload),
          record.result ? JSON.stringify(record.result) : null,
          record.error ? JSON.stringify(record.error) : null,
          normalizeMysqlDateTime(record.claimedAt),
          normalizeMysqlDateTime(record.completedAt),
        ],
      );

      return record;
    },
    async getBrowserJobById(jobId) {
      const [rows] = await pool.query(
        `
          SELECT id, session_id, agent_id, job_type, status, payload_json, result_json, error_json, claimed_at, completed_at, created_at, updated_at
          FROM browser_jobs
          WHERE id = ?
          LIMIT 1
        `,
        [jobId],
      );

      return rows[0] ? mapBrowserJobRow(rows[0]) : null;
    },
    async updateBrowserJob(record) {
      await pool.query(
        `
          UPDATE browser_jobs
          SET session_id = ?, agent_id = ?, job_type = ?, status = ?, payload_json = ?, result_json = ?, error_json = ?, claimed_at = ?, completed_at = ?, updated_at = NOW()
          WHERE id = ?
        `,
        [
          record.sessionId,
          record.agentId,
          record.jobType,
          record.status,
          JSON.stringify(record.payload),
          record.result ? JSON.stringify(record.result) : null,
          record.error ? JSON.stringify(record.error) : null,
          normalizeMysqlDateTime(record.claimedAt),
          normalizeMysqlDateTime(record.completedAt),
          record.id,
        ],
      );

      return record;
    },
    async claimNextBrowserJob(agentId) {
      const connection = await pool.getConnection();

      try {
        await connection.beginTransaction();
        const [rows] = await connection.query(
          `
            SELECT id, session_id, agent_id, job_type, status, payload_json, result_json, error_json, claimed_at, completed_at, created_at, updated_at
            FROM browser_jobs
            WHERE status = 'PENDING'
            ORDER BY created_at ASC
            LIMIT 1
            FOR UPDATE
          `,
        );

        if (!rows[0]) {
          await connection.rollback();
          return null;
        }

        const job = mapBrowserJobRow(rows[0]);
        const claimedAt = new Date().toISOString();
        job.status = 'CLAIMED';
        job.agentId = agentId;
        job.claimedAt = claimedAt;
        job.updatedAt = claimedAt;

        await connection.query(
          `
            UPDATE browser_jobs
            SET status = 'CLAIMED', agent_id = ?, claimed_at = ?, updated_at = NOW()
            WHERE id = ?
          `,
          [agentId, normalizeMysqlDateTime(claimedAt), job.id],
        );

        await connection.commit();
        return job;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    async listBrowserSessions() {
      const [rows] = await pool.query(
        `
          SELECT id, provider, status, started_at, ended_at, metadata_json, created_at, updated_at
          FROM browser_sessions
          ORDER BY
            CASE status
              WHEN 'ACTIVE' THEN 0
              WHEN 'ATTENTION_REQUIRED' THEN 1
              WHEN 'ERROR' THEN 2
              ELSE 3
            END,
            updated_at DESC,
            created_at DESC
          LIMIT 100
        `,
      );

      return rows.map(mapBrowserSessionRow);
    },
    async getBrowserSessionById(sessionId) {
      const [rows] = await pool.query(
        `
          SELECT id, provider, status, started_at, ended_at, metadata_json, created_at, updated_at
          FROM browser_sessions
          WHERE id = ?
          LIMIT 1
        `,
        [sessionId],
      );

      return rows[0] ? mapBrowserSessionRow(rows[0]) : null;
    },
    async saveBrowserSession(record) {
      await pool.query(
        `
          INSERT INTO browser_sessions (
            id,
            provider,
            status,
            started_at,
            ended_at,
            metadata_json,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
        `,
        [
          record.id,
          record.provider,
          record.status,
          normalizeMysqlDateTime(record.startedAt),
          normalizeMysqlDateTime(record.endedAt),
          JSON.stringify(record.metadata),
        ],
      );

      return record;
    },
    async updateBrowserSession(record) {
      await pool.query(
        `
          UPDATE browser_sessions
          SET status = ?, started_at = ?, ended_at = ?, metadata_json = ?, updated_at = NOW()
          WHERE id = ?
        `,
        [
          record.status,
          normalizeMysqlDateTime(record.startedAt),
          normalizeMysqlDateTime(record.endedAt),
          JSON.stringify(record.metadata),
          record.id,
        ],
      );

      return record;
    },
    async listApprovalRequests(filters = {}) {
      const clauses = [];
      const params = [];

      if (filters.entityType) {
        clauses.push('entity_type = ?');
        params.push(filters.entityType);
      }

      if (filters.entityId) {
        clauses.push('entity_id = ?');
        params.push(filters.entityId);
      }

      if (filters.approvalKind) {
        clauses.push('approval_kind = ?');
        params.push(filters.approvalKind);
      }

      if (filters.status) {
        clauses.push('status = ?');
        params.push(filters.status);
      }

      if (filters.search) {
        clauses.push(
          `(approval_kind LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.jobTitle')) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.company')) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.reason')) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.note')) LIKE ? OR JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.sourceUrl')) LIKE ?)`,
        );
        const like = `%${String(filters.search).trim()}%`;
        params.push(like, like, like, like, like, like);
      }

      const [rows] = await pool.query(
        `
          SELECT id, entity_type, entity_id, approval_kind, status, payload_json, created_at, updated_at
          FROM approval_requests
          ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
          ORDER BY
            CASE status
              WHEN 'PENDING' THEN 0
              WHEN 'REJECTED' THEN 1
              ELSE 2
            END,
            updated_at DESC,
            created_at DESC
          LIMIT ?
        `,
        [...params, filters.limit ?? 200],
      );

      return rows.map(mapApprovalRequestRow);
    },
    async listApprovalRequestsByEntity(entityType, entityId) {
      const [rows] = await pool.query(
        `
          SELECT id, entity_type, entity_id, approval_kind, status, payload_json, created_at, updated_at
          FROM approval_requests
          WHERE entity_type = ? AND entity_id = ?
          ORDER BY
            CASE status
              WHEN 'PENDING' THEN 0
              WHEN 'REJECTED' THEN 1
              ELSE 2
            END,
            updated_at DESC,
            created_at DESC
        `,
        [entityType, entityId],
      );

      return rows.map(mapApprovalRequestRow);
    },
    async findApprovalRequest(entityType, entityId, approvalKind) {
      const [rows] = await pool.query(
        `
          SELECT id, entity_type, entity_id, approval_kind, status, payload_json, created_at, updated_at
          FROM approval_requests
          WHERE entity_type = ? AND entity_id = ? AND approval_kind = ?
          ORDER BY updated_at DESC
          LIMIT 1
        `,
        [entityType, entityId, approvalKind],
      );

      return rows[0] ? mapApprovalRequestRow(rows[0]) : null;
    },
    async getApprovalRequestById(requestId) {
      const [rows] = await pool.query(
        `
          SELECT id, entity_type, entity_id, approval_kind, status, payload_json, created_at, updated_at
          FROM approval_requests
          WHERE id = ?
          LIMIT 1
        `,
        [requestId],
      );

      return rows[0] ? mapApprovalRequestRow(rows[0]) : null;
    },
    async saveApprovalRequest(record) {
      await pool.query(
        `
          INSERT INTO approval_requests (
            id,
            entity_type,
            entity_id,
            approval_kind,
            status,
            payload_json,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())
        `,
        [
          record.id,
          record.entityType,
          record.entityId,
          record.approvalKind,
          record.status,
          JSON.stringify(record.payload),
        ],
      );

      return record;
    },
    async updateApprovalRequest(record) {
      await pool.query(
        `
          UPDATE approval_requests
          SET status = ?, payload_json = ?, updated_at = NOW()
          WHERE id = ?
        `,
        [record.status, JSON.stringify(record.payload), record.id],
      );

      return record;
    },
    async listJobAnalyses() {
      const [rows] = await pool.query(
        'SELECT payload_json FROM job_offers WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 100',
      );
      return rows.map((row) => parseStoredJson(row.payload_json));
    },
    async getJobAnalysisById(jobId) {
      const [rows] = await pool.query(
        'SELECT payload_json FROM job_offers WHERE id = ? AND deleted_at IS NULL LIMIT 1',
        [jobId],
      );
      return rows[0] ? parseStoredJson(rows[0].payload_json) : null;
    },
    async updateJobAnalysis(record) {
      await pool.query(
        `
          UPDATE job_offers
          SET status = ?, payload_json = ?, updated_at = NOW()
          WHERE id = ? AND deleted_at IS NULL
        `,
        [record.match.status, JSON.stringify(record), record.id],
      );

      await pool.query(
        `
          UPDATE job_matches
          SET status = ?, explanation_json = ?, updated_at = NOW()
          WHERE job_offer_id = ?
        `,
        [record.match.status, JSON.stringify(record.match), record.id],
      );

      return record;
    },
    async findByFingerprint(fingerprint) {
      const [rows] = await pool.query(
        'SELECT payload_json FROM job_offers WHERE dedupe_fingerprint = ? AND deleted_at IS NULL LIMIT 1',
        [fingerprint],
      );
      return rows[0] ? parseStoredJson(rows[0].payload_json) : null;
    },
    async saveJobAnalysis(record) {
      await ensureCandidateProfile(pool, defaultCandidateProfile);

      await pool.query(
        `
          INSERT INTO job_sources (
            id,
            source_type,
            source_label,
            original_url,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, NOW(), NOW())
          ON DUPLICATE KEY UPDATE
            source_label = VALUES(source_label),
            original_url = VALUES(original_url),
            updated_at = NOW()
        `,
        [record.source.id, record.source.type, record.source.label, record.source.originalUrl],
      );

      await pool.query(
        `
          INSERT INTO job_offers (
            id,
            source_id,
            company_name,
            title,
            recruiter_email,
            original_url,
            status,
            dedupe_fingerprint,
            payload_json,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `,
        [
          record.id,
          record.source.id,
          record.jobOffer.company ?? '',
          record.jobOffer.title,
          record.jobOffer.recruiterEmail,
          record.source.originalUrl,
          record.match.status,
          record.fingerprint,
          JSON.stringify(record),
        ],
      );

      await pool.query(
        `
          INSERT INTO job_matches (
            id,
            job_offer_id,
            candidate_profile_id,
            score,
            recommendation,
            status,
            explanation_json,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
        `,
        [
          record.matchId,
          record.id,
          record.profile.id,
          record.match.score,
          record.match.recommendation,
          record.match.status,
          JSON.stringify(record.match),
        ],
      );

      return record;
    },
    async saveEmailDraft(record) {
      await pool.query(
        `
          INSERT INTO email_drafts (
            id,
            application_id,
            provider,
            draft_external_id,
            to_email,
            subject_line,
            body_text,
            metadata_json,
            created_at,
            updated_at,
            deleted_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NULL)
        `,
        [
          record.id,
          record.applicationId,
          record.provider,
          record.draftExternalId,
          record.toEmail,
          record.subjectLine,
          record.bodyText,
          JSON.stringify(record.metadata),
        ],
      );
      return record;
    },
    async saveAuditEvent(event) {
      await pool.query(
        `
          INSERT INTO audit_events (
            id,
            entity_type,
            entity_id,
            event_name,
            payload_json,
            created_at
          ) VALUES (?, ?, ?, ?, ?, NOW())
        `,
        [event.id, event.entityType, event.entityId, event.eventName, JSON.stringify(event.payload)],
      );
      return event;
    },
    async listAuditEvents(filters = {}) {
      const clauses = [];
      const params = [];

      if (filters.entityType) {
        clauses.push('entity_type = ?');
        params.push(filters.entityType);
      }

      if (filters.entityId) {
        clauses.push('entity_id = ?');
        params.push(filters.entityId);
      }

      if (filters.eventName) {
        clauses.push('event_name = ?');
        params.push(filters.eventName);
      }

      const [rows] = await pool.query(
        `
          SELECT id, entity_type, entity_id, event_name, payload_json, created_at
          FROM audit_events
          ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
          ORDER BY created_at DESC, id DESC
          LIMIT ?
        `,
        [...params, filters.limit ?? 50],
      );

      return rows.map(mapAuditEventRow);
    },
    async getDashboardSummary() {
      const latest = await this.listJobAnalyses();
      const [metricsRows] = await pool.query(
        `
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status IN ('READY_TO_PREPARE', 'APPROVED') THEN 1 ELSE 0 END) AS readyToPrepare,
            SUM(CASE WHEN status = 'AWAITING_APPROVAL' THEN 1 ELSE 0 END) AS awaitingApproval,
            SUM(CASE WHEN status IN ('REJECTED_BY_RULES', 'REJECTED') THEN 1 ELSE 0 END) AS blocked
          FROM job_offers
          WHERE deleted_at IS NULL
        `,
      );

      return {
        storageMode: this.mode,
        metrics: {
          total: Number(metricsRows[0]?.total ?? 0),
          readyToPrepare: Number(metricsRows[0]?.readyToPrepare ?? 0),
          awaitingApproval: Number(metricsRows[0]?.awaitingApproval ?? 0),
          blocked: Number(metricsRows[0]?.blocked ?? 0),
        },
        latest: latest.slice(0, 10),
      };
    },
    async ping() {
      const [rows] = await pool.query('SELECT 1 AS ok');
      return {
        status: rows[0]?.ok === 1 ? 'ok' : 'error',
        mode: this.mode,
      };
    },
  };
}

async function ensureCandidateProfile(pool, profile) {
  const [rows] = await pool.query(
    'SELECT id FROM candidate_profiles WHERE id = ? LIMIT 1',
    [profile.id],
  );

  if (rows[0]) {
    return;
  }

  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    await upsertCandidateProfile(connection, profile);
    await replaceCandidateFacts(connection, profile.id, profile.facts);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function readCandidateProfile(pool, profileId) {
  const [profileRows] = await pool.query(
    `
      SELECT profile_json
      FROM candidate_profiles
      WHERE id = ? AND deleted_at IS NULL
      LIMIT 1
    `,
    [profileId],
  );

  const [factRows] = await pool.query(
    `
      SELECT fact_key, fact_value, certainty, source
      FROM candidate_facts
      WHERE candidate_profile_id = ? AND deleted_at IS NULL
      ORDER BY created_at ASC, id ASC
    `,
    [profileId],
  );

  const profile = parseStoredJson(profileRows[0].profile_json);
  profile.facts = factRows.map((row) => ({
    key: row.fact_key,
    value: row.fact_value,
    certainty: row.certainty,
    source: row.source,
  }));

  return profile;
}

async function upsertCandidateProfile(connection, profile) {
  await connection.query(
    `
      INSERT INTO candidate_profiles (
        id,
        display_name,
        headline_json,
        profile_json,
        created_at,
        updated_at,
        deleted_at
      ) VALUES (?, ?, ?, ?, NOW(), NOW(), NULL)
      ON DUPLICATE KEY UPDATE
        display_name = VALUES(display_name),
        headline_json = VALUES(headline_json),
        profile_json = VALUES(profile_json),
        deleted_at = NULL,
        updated_at = NOW()
    `,
    [
      profile.id,
      profile.name,
      JSON.stringify(profile.headlineTargets),
      JSON.stringify(profile),
    ],
  );
}

async function replaceCandidateFacts(connection, profileId, facts) {
  await connection.query(
    `
      UPDATE candidate_facts
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE candidate_profile_id = ? AND deleted_at IS NULL
    `,
    [profileId],
  );

  const factRows = createCandidateFactRows(profileId, facts);

  for (const row of factRows) {
    await connection.query(
      `
        INSERT INTO candidate_facts (
          id,
          candidate_profile_id,
          fact_key,
          fact_value,
          certainty,
          source,
          created_at,
          updated_at,
          deleted_at
        ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), NULL)
      `,
      [
        row.id,
        row.candidateProfileId,
        row.factKey,
        row.factValue,
        row.certainty,
        row.source,
      ],
    );
  }
}

function parseStoredJson(value) {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return JSON.parse(value);
  }

  if (typeof value === 'object') {
    return structuredClone(value);
  }

  throw new TypeError(`Unsupported JSON column type: ${typeof value}`);
}

function mapResumeRow(row) {
  return {
    id: row.id,
    candidateProfileId: row.candidate_profile_id,
    label: row.label,
    filePath: row.file_path,
    metadata: parseStoredJson(row.metadata_json),
    createdAt: serializeDate(row.created_at),
    updatedAt: serializeDate(row.updated_at),
  };
}

function mapAutomationSettingsRow(row) {
  return {
    id: row.id,
    enabled: Boolean(row.enabled),
    mode: row.mode,
    timezone: row.timezone,
    dailyApplicationLimit: Number(row.daily_application_limit),
    dailyDiscoveryLimit: Number(row.daily_discovery_limit),
    minimumMatchScore: Number(row.minimum_match_score),
    requireHumanApproval: Boolean(row.require_human_approval),
    unknownQuestionPolicy: row.unknown_question_policy,
    captchaPolicy: row.captcha_policy,
    mfaPolicy: row.mfa_policy,
    salaryRequiresApproval: Boolean(row.salary_requires_approval),
    startTime: row.start_time,
    daysOfWeek: parseStoredJson(row.days_of_week),
    filters: parseStoredJson(row.filters_json),
    sourcePolicies: parseStoredJson(row.source_policies_json),
    version: Number(row.version),
    lastTriggeredAt: row.last_triggered_at ? serializeDate(row.last_triggered_at) : null,
    createdAt: serializeDate(row.created_at),
    updatedAt: serializeDate(row.updated_at),
  };
}

function mapApplicationRow(row) {
  const metadata = parseStoredJson(row.metadata_json);
  return {
    id: row.id,
    jobOfferId: row.job_offer_id,
    status: row.status,
    submittedAt: row.submitted_at ? serializeDate(row.submitted_at) : null,
    createdAt: serializeDate(row.created_at),
    updatedAt: serializeDate(row.updated_at),
    mode: metadata.mode ?? null,
    trigger: metadata.trigger ?? null,
    metadata,
  };
}

function mapAgentRunRow(row) {
  return {
    id: row.id,
    sourceType: row.source_type,
    status: row.status,
    metadata: parseStoredJson(row.metadata_json),
    startedAt: serializeDate(row.started_at),
    finishedAt: row.finished_at ? serializeDate(row.finished_at) : null,
    createdAt: serializeDate(row.created_at),
  };
}

function mapDesktopAgentRow(row) {
  return {
    id: row.id,
    status: row.status,
    version: row.version,
    os: row.os,
    hostname: row.hostname,
    metadata: parseStoredJson(row.metadata_json),
    lastHeartbeatAt: row.last_heartbeat_at ? serializeDate(row.last_heartbeat_at) : null,
    createdAt: serializeDate(row.created_at),
    updatedAt: serializeDate(row.updated_at),
  };
}

function mapBrowserJobRow(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    agentId: row.agent_id,
    jobType: row.job_type,
    status: row.status,
    payload: parseStoredJson(row.payload_json),
    result: parseStoredJson(row.result_json),
    error: parseStoredJson(row.error_json),
    claimedAt: row.claimed_at ? serializeDate(row.claimed_at) : null,
    completedAt: row.completed_at ? serializeDate(row.completed_at) : null,
    createdAt: serializeDate(row.created_at),
    updatedAt: serializeDate(row.updated_at),
  };
}

function mapBrowserSessionRow(row) {
  return {
    id: row.id,
    provider: row.provider,
    status: row.status,
    startedAt: serializeDate(row.started_at),
    endedAt: row.ended_at ? serializeDate(row.ended_at) : null,
    metadata: parseStoredJson(row.metadata_json),
    createdAt: serializeDate(row.created_at),
    updatedAt: serializeDate(row.updated_at),
  };
}

function mapApprovalRequestRow(row) {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    approvalKind: row.approval_kind,
    status: row.status,
    payload: parseStoredJson(row.payload_json),
    createdAt: serializeDate(row.created_at),
    updatedAt: serializeDate(row.updated_at),
  };
}

function mapAuditEventRow(row) {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    eventName: row.event_name,
    payload: parseStoredJson(row.payload_json),
    createdAt: serializeDate(row.created_at),
  };
}

function serializeDate(value) {
  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function normalizeMysqlDateTime(value) {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toISOString().slice(0, 19).replace('T', ' ');
}
