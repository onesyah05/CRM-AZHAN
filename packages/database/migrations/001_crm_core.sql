-- Azhan CRM baseline for MySQL 8.0+
-- ERP identifiers are external references and intentionally have no local foreign keys.

CREATE TABLE crm_stages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  brand_id BIGINT UNSIGNED NOT NULL,
  stage_key VARCHAR(40) NOT NULL,
  name VARCHAR(100) NOT NULL,
  color CHAR(7) NOT NULL,
  position SMALLINT UNSIGNED NOT NULL,
  kind ENUM('open', 'won', 'lost') NOT NULL DEFAULT 'open',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_stages_brand_key (brand_id, stage_key),
  UNIQUE KEY uq_crm_stages_brand_position (brand_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE crm_contacts (
  id BINARY(16) NOT NULL,
  brand_id BIGINT UNSIGNED NOT NULL,
  phone_e164 VARCHAR(20) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  email VARCHAR(190) NULL,
  city VARCHAR(100) NULL,
  source VARCHAR(100) NULL,
  erp_jamaah_id BIGINT UNSIGNED NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_contacts_brand_phone (brand_id, phone_e164),
  KEY idx_crm_contacts_brand_name (brand_id, display_name),
  KEY idx_crm_contacts_brand_erp (brand_id, erp_jamaah_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE crm_leads (
  id BINARY(16) NOT NULL,
  brand_id BIGINT UNSIGNED NOT NULL,
  contact_id BINARY(16) NOT NULL,
  stage_id BIGINT UNSIGNED NOT NULL,
  assignee_erp_user_id BIGINT UNSIGNED NULL,
  assignee_name VARCHAR(120) NULL,
  erp_schedule_id BIGINT UNSIGNED NULL,
  schedule_name VARCHAR(180) NULL,
  departure_plan VARCHAR(120) NULL,
  room_type ENUM('Quad', 'Triple', 'Double') NOT NULL DEFAULT 'Quad',
  pax SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  estimated_value DECIMAL(16,2) NOT NULL DEFAULT 0,
  next_follow_up_at DATETIME(3) NULL,
  notes TEXT NULL,
  deal_substatus ENUM('book_seat', 'book_seat_expired', 'dp_pending', 'dp_confirmed', 'paid') NULL,
  seat_hold_expires_at DATETIME(3) NULL,
  erp_booking_id BIGINT UNSIGNED NULL,
  erp_payment_id BIGINT UNSIGNED NULL,
  lost_reason VARCHAR(500) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_crm_leads_contact FOREIGN KEY (contact_id) REFERENCES crm_contacts (id),
  CONSTRAINT fk_crm_leads_stage FOREIGN KEY (stage_id) REFERENCES crm_stages (id),
  KEY idx_crm_leads_brand_stage (brand_id, stage_id, updated_at),
  KEY idx_crm_leads_brand_followup (brand_id, next_follow_up_at),
  KEY idx_crm_leads_brand_booking (brand_id, erp_booking_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE crm_tags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  brand_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(60) NOT NULL,
  color CHAR(7) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_tags_brand_name (brand_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE crm_lead_tags (
  brand_id BIGINT UNSIGNED NOT NULL,
  lead_id BINARY(16) NOT NULL,
  tag_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (lead_id, tag_id),
  CONSTRAINT fk_crm_lead_tags_lead FOREIGN KEY (lead_id) REFERENCES crm_leads (id) ON DELETE CASCADE,
  CONSTRAINT fk_crm_lead_tags_tag FOREIGN KEY (tag_id) REFERENCES crm_tags (id) ON DELETE CASCADE,
  KEY idx_crm_lead_tags_brand (brand_id, tag_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE crm_conversations (
  id BINARY(16) NOT NULL,
  brand_id BIGINT UNSIGNED NOT NULL,
  contact_id BINARY(16) NOT NULL,
  lead_id BINARY(16) NOT NULL,
  whatsapp_jid VARCHAR(190) NOT NULL,
  last_message_preview VARCHAR(500) NULL,
  last_message_at DATETIME(3) NULL,
  unread_count INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_conversations_brand_jid (brand_id, whatsapp_jid),
  CONSTRAINT fk_crm_conversations_contact FOREIGN KEY (contact_id) REFERENCES crm_contacts (id),
  CONSTRAINT fk_crm_conversations_lead FOREIGN KEY (lead_id) REFERENCES crm_leads (id),
  KEY idx_crm_conversations_brand_last (brand_id, last_message_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE crm_messages (
  id BINARY(16) NOT NULL,
  brand_id BIGINT UNSIGNED NOT NULL,
  conversation_id BINARY(16) NOT NULL,
  whatsapp_message_id VARCHAR(190) NOT NULL,
  direction ENUM('inbound', 'outbound') NOT NULL,
  message_type ENUM('text', 'image', 'document') NOT NULL DEFAULT 'text',
  body TEXT NULL,
  media_object_key VARCHAR(500) NULL,
  status ENUM('pending', 'sent', 'delivered', 'read', 'failed') NOT NULL DEFAULT 'pending',
  failure_code VARCHAR(100) NULL,
  sent_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_messages_brand_wa_id (brand_id, whatsapp_message_id),
  CONSTRAINT fk_crm_messages_conversation FOREIGN KEY (conversation_id) REFERENCES crm_conversations (id),
  KEY idx_crm_messages_conversation_sent (conversation_id, sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE crm_deal_conversions (
  id BINARY(16) NOT NULL,
  brand_id BIGINT UNSIGNED NOT NULL,
  lead_id BINARY(16) NOT NULL,
  idempotency_key CHAR(36) NOT NULL,
  commitment_type ENUM('book_seat', 'dp', 'lunas') NOT NULL,
  status ENUM('pending', 'erp_completed', 'completed', 'failed') NOT NULL DEFAULT 'pending',
  request_payload JSON NOT NULL,
  response_payload JSON NULL,
  erp_jamaah_id BIGINT UNSIGNED NULL,
  erp_booking_id BIGINT UNSIGNED NULL,
  erp_payment_id BIGINT UNSIGNED NULL,
  last_error_code VARCHAR(100) NULL,
  last_error_message VARCHAR(1000) NULL,
  retry_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_deals_idempotency (brand_id, lead_id, idempotency_key),
  CONSTRAINT fk_crm_deals_lead FOREIGN KEY (lead_id) REFERENCES crm_leads (id),
  KEY idx_crm_deals_recovery (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE crm_activities (
  id BINARY(16) NOT NULL,
  brand_id BIGINT UNSIGNED NOT NULL,
  lead_id BINARY(16) NOT NULL,
  activity_type ENUM('message', 'stage', 'note', 'deal', 'assignment') NOT NULL,
  title VARCHAR(180) NOT NULL,
  description VARCHAR(1000) NULL,
  actor_erp_user_id BIGINT UNSIGNED NULL,
  actor_name VARCHAR(120) NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_crm_activities_lead FOREIGN KEY (lead_id) REFERENCES crm_leads (id),
  KEY idx_crm_activities_brand_time (brand_id, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE crm_whatsapp_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  brand_id BIGINT UNSIGNED NOT NULL,
  phone_e164 VARCHAR(20) NULL,
  connection_status VARCHAR(40) NOT NULL DEFAULT 'disconnected',
  encrypted_auth_state LONGBLOB NULL,
  encryption_key_version SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  lock_owner VARCHAR(120) NULL,
  lock_expires_at DATETIME(3) NULL,
  last_connected_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_whatsapp_sessions_brand (brand_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE crm_outbox_jobs (
  id BINARY(16) NOT NULL,
  brand_id BIGINT UNSIGNED NOT NULL,
  job_type VARCHAR(80) NOT NULL,
  dedupe_key VARCHAR(190) NOT NULL,
  payload JSON NOT NULL,
  status ENUM('pending', 'processing', 'completed', 'failed') NOT NULL DEFAULT 'pending',
  attempts SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  available_at DATETIME(3) NOT NULL,
  locked_at DATETIME(3) NULL,
  last_error VARCHAR(1000) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_outbox_dedupe (brand_id, job_type, dedupe_key),
  KEY idx_crm_outbox_claim (status, available_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

