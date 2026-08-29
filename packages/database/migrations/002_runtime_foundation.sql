-- Runtime persistence added after the initial CRM schema baseline.

ALTER TABLE crm_leads
  ADD COLUMN erp_jamaah_id BIGINT UNSIGNED NULL AFTER seat_hold_expires_at,
  ADD KEY idx_crm_leads_brand_jamaah (brand_id, erp_jamaah_id);

CREATE TABLE crm_notes (
  id BINARY(16) NOT NULL,
  brand_id BIGINT UNSIGNED NOT NULL,
  lead_id BINARY(16) NOT NULL,
  author_erp_user_id BIGINT UNSIGNED NULL,
  author_name VARCHAR(120) NOT NULL,
  body TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_crm_notes_lead FOREIGN KEY (lead_id) REFERENCES crm_leads (id),
  KEY idx_crm_notes_brand_lead_time (brand_id, lead_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE crm_audit_logs (
  id BINARY(16) NOT NULL,
  brand_id BIGINT UNSIGNED NOT NULL,
  actor_erp_user_id BIGINT UNSIGNED NULL,
  actor_name VARCHAR(120) NOT NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id VARCHAR(190) NOT NULL,
  action VARCHAR(100) NOT NULL,
  before_payload JSON NULL,
  after_payload JSON NULL,
  correlation_id CHAR(36) NULL,
  occurred_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_crm_audit_brand_time (brand_id, occurred_at),
  KEY idx_crm_audit_entity (brand_id, entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE crm_http_sessions (
  session_id VARCHAR(128) NOT NULL,
  encrypted_payload LONGBLOB NOT NULL,
  iv VARBINARY(12) NOT NULL,
  auth_tag VARBINARY(16) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (session_id),
  KEY idx_crm_http_sessions_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
