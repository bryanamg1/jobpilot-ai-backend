CREATE TABLE IF NOT EXISTS desktop_agents (
  id VARCHAR(64) PRIMARY KEY,
  status VARCHAR(32) NOT NULL,
  version VARCHAR(64) NULL,
  os VARCHAR(128) NULL,
  hostname VARCHAR(255) NULL,
  metadata_json JSON NOT NULL,
  last_heartbeat_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_desktop_agents_status_heartbeat (status, last_heartbeat_at)
);

CREATE TABLE IF NOT EXISTS browser_jobs (
  id VARCHAR(64) PRIMARY KEY,
  session_id VARCHAR(64) NULL,
  agent_id VARCHAR(64) NULL,
  job_type VARCHAR(64) NOT NULL,
  status VARCHAR(64) NOT NULL,
  payload_json JSON NOT NULL,
  result_json JSON NULL,
  error_json JSON NULL,
  claimed_at DATETIME NULL,
  completed_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_browser_jobs_status_created (status, created_at),
  INDEX idx_browser_jobs_agent_status (agent_id, status),
  CONSTRAINT fk_browser_jobs_agent FOREIGN KEY (agent_id) REFERENCES desktop_agents(id) ON DELETE SET NULL
);
