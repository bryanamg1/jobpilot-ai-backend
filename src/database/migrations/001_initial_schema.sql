CREATE TABLE IF NOT EXISTS candidate_profiles (
  id VARCHAR(64) PRIMARY KEY,
  display_name VARCHAR(255) NOT NULL,
  headline_json JSON NOT NULL,
  profile_json JSON NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted_at DATETIME NULL
);

CREATE TABLE IF NOT EXISTS candidate_facts (
  id VARCHAR(64) PRIMARY KEY,
  candidate_profile_id VARCHAR(64) NOT NULL,
  fact_key VARCHAR(128) NOT NULL,
  fact_value TEXT NOT NULL,
  certainty VARCHAR(32) NOT NULL,
  source VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted_at DATETIME NULL,
  INDEX idx_candidate_facts_profile_key (candidate_profile_id, fact_key),
  CONSTRAINT fk_candidate_facts_profile FOREIGN KEY (candidate_profile_id) REFERENCES candidate_profiles(id)
);

CREATE TABLE IF NOT EXISTS resumes (
  id VARCHAR(64) PRIMARY KEY,
  candidate_profile_id VARCHAR(64) NOT NULL,
  label VARCHAR(255) NOT NULL,
  file_path TEXT NOT NULL,
  metadata_json JSON NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted_at DATETIME NULL,
  CONSTRAINT fk_resumes_profile FOREIGN KEY (candidate_profile_id) REFERENCES candidate_profiles(id)
);

CREATE TABLE IF NOT EXISTS job_sources (
  id VARCHAR(64) PRIMARY KEY,
  source_type VARCHAR(64) NOT NULL,
  source_label VARCHAR(255) NOT NULL,
  original_url TEXT NULL,
  source_snapshot_id VARCHAR(64) NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS companies (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  normalized_name VARCHAR(255) NOT NULL,
  metadata_json JSON NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted_at DATETIME NULL,
  UNIQUE KEY uk_companies_normalized_name (normalized_name)
);

CREATE TABLE IF NOT EXISTS recruiters (
  id VARCHAR(64) PRIMARY KEY,
  company_id VARCHAR(64) NULL,
  display_name VARCHAR(255) NULL,
  email VARCHAR(255) NULL,
  metadata_json JSON NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted_at DATETIME NULL,
  UNIQUE KEY uk_recruiters_email (email),
  CONSTRAINT fk_recruiters_company FOREIGN KEY (company_id) REFERENCES companies(id)
);

CREATE TABLE IF NOT EXISTS source_snapshots (
  id VARCHAR(64) PRIMARY KEY,
  source_id VARCHAR(64) NULL,
  raw_text LONGTEXT NOT NULL,
  extracted_text LONGTEXT NULL,
  snapshot_hash VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_source_snapshots_hash (snapshot_hash)
);

CREATE TABLE IF NOT EXISTS job_offers (
  id VARCHAR(64) PRIMARY KEY,
  source_id VARCHAR(64) NOT NULL,
  company_name VARCHAR(255) NOT NULL,
  title VARCHAR(255) NOT NULL,
  recruiter_email VARCHAR(255) NULL,
  original_url TEXT NULL,
  status VARCHAR(64) NOT NULL,
  dedupe_fingerprint VARCHAR(64) NOT NULL,
  payload_json JSON NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted_at DATETIME NULL,
  UNIQUE KEY uk_job_offers_fingerprint (dedupe_fingerprint),
  INDEX idx_job_offers_status (status),
  CONSTRAINT fk_job_offers_source FOREIGN KEY (source_id) REFERENCES job_sources(id)
);

CREATE TABLE IF NOT EXISTS job_requirements (
  id VARCHAR(64) PRIMARY KEY,
  job_offer_id VARCHAR(64) NOT NULL,
  requirement_type VARCHAR(64) NOT NULL,
  requirement_value TEXT NOT NULL,
  certainty VARCHAR(32) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted_at DATETIME NULL,
  INDEX idx_job_requirements_offer_type (job_offer_id, requirement_type),
  CONSTRAINT fk_job_requirements_offer FOREIGN KEY (job_offer_id) REFERENCES job_offers(id)
);

CREATE TABLE IF NOT EXISTS job_matches (
  id VARCHAR(64) PRIMARY KEY,
  job_offer_id VARCHAR(64) NOT NULL,
  candidate_profile_id VARCHAR(64) NOT NULL,
  score INT NOT NULL,
  recommendation VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL,
  explanation_json JSON NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_job_matches_offer (job_offer_id),
  CONSTRAINT fk_job_matches_offer FOREIGN KEY (job_offer_id) REFERENCES job_offers(id),
  CONSTRAINT fk_job_matches_profile FOREIGN KEY (candidate_profile_id) REFERENCES candidate_profiles(id)
);

CREATE TABLE IF NOT EXISTS applications (
  id VARCHAR(64) PRIMARY KEY,
  job_offer_id VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL,
  submitted_at DATETIME NULL,
  metadata_json JSON NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted_at DATETIME NULL,
  INDEX idx_applications_status (status),
  CONSTRAINT fk_applications_offer FOREIGN KEY (job_offer_id) REFERENCES job_offers(id)
);

CREATE TABLE IF NOT EXISTS application_answers (
  id VARCHAR(64) PRIMARY KEY,
  application_id VARCHAR(64) NOT NULL,
  question_text TEXT NOT NULL,
  answer_text LONGTEXT NULL,
  certainty VARCHAR(32) NOT NULL,
  source VARCHAR(255) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted_at DATETIME NULL,
  CONSTRAINT fk_application_answers_application FOREIGN KEY (application_id) REFERENCES applications(id)
);

CREATE TABLE IF NOT EXISTS email_drafts (
  id VARCHAR(64) PRIMARY KEY,
  application_id VARCHAR(64) NULL,
  provider VARCHAR(64) NOT NULL,
  draft_external_id VARCHAR(255) NULL,
  to_email VARCHAR(255) NULL,
  subject_line TEXT NOT NULL,
  body_text LONGTEXT NOT NULL,
  metadata_json JSON NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  deleted_at DATETIME NULL,
  CONSTRAINT fk_email_drafts_application FOREIGN KEY (application_id) REFERENCES applications(id)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id VARCHAR(64) PRIMARY KEY,
  source_type VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL,
  metadata_json JSON NOT NULL,
  started_at DATETIME NOT NULL,
  finished_at DATETIME NULL,
  created_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_events (
  id VARCHAR(64) PRIMARY KEY,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  event_name VARCHAR(255) NOT NULL,
  payload_json JSON NOT NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_audit_events_entity (entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS approval_requests (
  id VARCHAR(64) PRIMARY KEY,
  entity_type VARCHAR(64) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  approval_kind VARCHAR(128) NOT NULL,
  status VARCHAR(64) NOT NULL,
  payload_json JSON NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE IF NOT EXISTS browser_sessions (
  id VARCHAR(64) PRIMARY KEY,
  provider VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL,
  started_at DATETIME NOT NULL,
  ended_at DATETIME NULL,
  metadata_json JSON NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);
