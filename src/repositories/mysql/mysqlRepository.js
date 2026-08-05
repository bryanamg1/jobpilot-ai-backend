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
    async listJobAnalyses() {
      const [rows] = await pool.query(
        'SELECT payload_json FROM job_offers WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT 100',
      );
      return rows.map((row) => JSON.parse(row.payload_json));
    },
    async getJobAnalysisById(jobId) {
      const [rows] = await pool.query(
        'SELECT payload_json FROM job_offers WHERE id = ? AND deleted_at IS NULL LIMIT 1',
        [jobId],
      );
      return rows[0] ? JSON.parse(rows[0].payload_json) : null;
    },
    async findByFingerprint(fingerprint) {
      const [rows] = await pool.query(
        'SELECT payload_json FROM job_offers WHERE dedupe_fingerprint = ? AND deleted_at IS NULL LIMIT 1',
        [fingerprint],
      );
      return rows[0] ? JSON.parse(rows[0].payload_json) : null;
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
          record.jobOffer.company,
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
    async getDashboardSummary() {
      const latest = await this.listJobAnalyses();
      const [metricsRows] = await pool.query(
        `
          SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN status = 'READY_TO_PREPARE' THEN 1 ELSE 0 END) AS readyToPrepare,
            SUM(CASE WHEN status = 'AWAITING_APPROVAL' THEN 1 ELSE 0 END) AS awaitingApproval,
            SUM(CASE WHEN status = 'REJECTED_BY_RULES' THEN 1 ELSE 0 END) AS blocked
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

  const profile = JSON.parse(profileRows[0].profile_json);
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
