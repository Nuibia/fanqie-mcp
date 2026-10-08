import { type DatabaseSync } from 'node:sqlite';
export function initializeStoreSchema(db: DatabaseSync): void {
  db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      CREATE TABLE IF NOT EXISTS service_lease (id INTEGER PRIMARY KEY CHECK(id = 1), owner_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, owner_id TEXT NOT NULL, kind TEXT NOT NULL,
        operation TEXT NOT NULL, scope TEXT NOT NULL, datasets_json TEXT NOT NULL,
        idempotency_key TEXT, input_hash TEXT NOT NULL, status TEXT NOT NULL,
        requested_at TEXT NOT NULL, started_at TEXT, read_started_at TEXT, write_started_at TEXT,
        ended_at TEXT, updated_at TEXT NOT NULL, result_json TEXT, error_json TEXT,
        target_json TEXT, metadata_json TEXT NOT NULL DEFAULT '{}',
        timeout_ms INTEGER NOT NULL DEFAULT 120000, deadline_at TEXT,
        cancellation_requested_at TEXT, cancellation_reason_json TEXT
      );
      CREATE UNIQUE INDEX IF NOT EXISTS jobs_idempotency ON jobs(account_id, kind, operation, idempotency_key) WHERE idempotency_key IS NOT NULL;
      CREATE INDEX IF NOT EXISTS jobs_account ON jobs(account_id, requested_at);
      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES jobs(id),
        dataset TEXT NOT NULL, captured_at TEXT NOT NULL, path TEXT NOT NULL UNIQUE, sha256 TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS manifests (
        id TEXT PRIMARY KEY, account_id TEXT NOT NULL, job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
        scope TEXT NOT NULL, committed_at TEXT NOT NULL, manifest_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS current_manifests (
        account_id TEXT NOT NULL, scope TEXT NOT NULL, manifest_id TEXT NOT NULL REFERENCES manifests(id),
        PRIMARY KEY(account_id, scope)
      );
      CREATE TABLE IF NOT EXISTS write_reconciliations (
        id TEXT PRIMARY KEY, original_job_id TEXT NOT NULL REFERENCES jobs(id),
        read_job_id TEXT NOT NULL REFERENCES jobs(id), evidence_id TEXT NOT NULL REFERENCES evidence(id),
        status TEXT NOT NULL, created_at TEXT NOT NULL, result_json TEXT NOT NULL,
        UNIQUE(original_job_id, read_job_id)
      );
      CREATE TABLE IF NOT EXISTS native_short_body_attempts (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id), account_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK(ordinal = 1), evidence_id TEXT NOT NULL UNIQUE REFERENCES evidence(id),
        evidence_sha256 TEXT NOT NULL, evidence_captured_at TEXT NOT NULL, event_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS native_short_submission_attempts (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id), account_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK(ordinal = 1),
        evidence_id TEXT NOT NULL UNIQUE REFERENCES evidence(id), evidence_sha256 TEXT NOT NULL,
        evidence_captured_at TEXT NOT NULL, event_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS native_short_trial_attempts (
        job_id TEXT PRIMARY KEY REFERENCES jobs(id), account_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK(ordinal = 1),
        evidence_id TEXT NOT NULL UNIQUE REFERENCES evidence(id), evidence_sha256 TEXT NOT NULL,
        evidence_captured_at TEXT NOT NULL, event_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS native_short_cover_attempts (
        job_id TEXT NOT NULL REFERENCES jobs(id), account_id TEXT NOT NULL,
        phase TEXT NOT NULL CHECK(phase IN ('upload', 'save')), ordinal INTEGER NOT NULL CHECK(ordinal = 1),
        evidence_id TEXT NOT NULL UNIQUE REFERENCES evidence(id), evidence_sha256 TEXT NOT NULL,
        evidence_captured_at TEXT NOT NULL, event_at TEXT NOT NULL,
        PRIMARY KEY(job_id, phase, ordinal)
      );
      CREATE TABLE IF NOT EXISTS creation_repairs (
        recovery_job_id TEXT PRIMARY KEY REFERENCES jobs(id), original_job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
        repair_job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id), bindings_json TEXT NOT NULL, prior_json TEXT NOT NULL,
        created_at TEXT NOT NULL, closed_at TEXT, closure_json TEXT, recovery_closure_json TEXT
      );
      CREATE TABLE IF NOT EXISTS creation_repair_successors (
        previous_repair_job_id TEXT PRIMARY KEY REFERENCES jobs(id), original_job_id TEXT NOT NULL REFERENCES jobs(id),
        recovery_job_id TEXT NOT NULL REFERENCES jobs(id), repair_job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
        bindings_json TEXT NOT NULL, prior_json TEXT NOT NULL, created_at TEXT NOT NULL, closed_at TEXT,
        closure_json TEXT, recovery_closure_json TEXT
      );
      CREATE TABLE IF NOT EXISTS creation_recoveries (
        original_job_id TEXT PRIMARY KEY REFERENCES jobs(id),
        resume_job_id TEXT NOT NULL UNIQUE REFERENCES jobs(id),
        bindings_json TEXT NOT NULL, prior_json TEXT NOT NULL,
        created_at TEXT NOT NULL, closed_at TEXT, closure_json TEXT
      );
    `);
}
