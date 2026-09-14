-- Multi-device WhatsApp per brand. Existing rows remain the primary device.

ALTER TABLE crm_whatsapp_sessions
  ADD COLUMN label VARCHAR(120) NOT NULL DEFAULT 'WhatsApp Utama' AFTER brand_id,
  ADD COLUMN is_default BOOLEAN NOT NULL DEFAULT FALSE AFTER label,
  DROP INDEX uq_crm_whatsapp_sessions_brand,
  ADD KEY idx_crm_whatsapp_sessions_brand (brand_id, is_default, created_at),
  ADD UNIQUE KEY uq_crm_whatsapp_sessions_brand_phone (brand_id, phone_e164);

UPDATE crm_whatsapp_sessions current_session
JOIN (
  SELECT brand_id, MIN(id) AS first_id
  FROM crm_whatsapp_sessions
  GROUP BY brand_id
) first_session ON first_session.brand_id = current_session.brand_id
SET current_session.is_default = current_session.id = first_session.first_id
WHERE current_session.is_default = FALSE;

INSERT INTO crm_whatsapp_sessions (brand_id, label, is_default)
SELECT DISTINCT conversation.brand_id, 'WhatsApp Utama', TRUE
FROM crm_conversations conversation
WHERE NOT EXISTS (
  SELECT 1 FROM crm_whatsapp_sessions existing_session
  WHERE existing_session.brand_id = conversation.brand_id
);

ALTER TABLE crm_conversations
  ADD COLUMN whatsapp_session_id BIGINT UNSIGNED NULL AFTER brand_id;

UPDATE crm_conversations conversation
JOIN crm_whatsapp_sessions whatsapp_session
  ON whatsapp_session.brand_id = conversation.brand_id
 AND whatsapp_session.is_default = TRUE
SET conversation.whatsapp_session_id = whatsapp_session.id
WHERE conversation.whatsapp_session_id IS NULL;

UPDATE crm_conversations conversation
JOIN (
  SELECT brand_id, MIN(id) AS first_id
  FROM crm_whatsapp_sessions
  GROUP BY brand_id
) first_session ON first_session.brand_id = conversation.brand_id
SET conversation.whatsapp_session_id = first_session.first_id
WHERE conversation.whatsapp_session_id IS NULL;

ALTER TABLE crm_conversations
  MODIFY COLUMN whatsapp_session_id BIGINT UNSIGNED NOT NULL,
  DROP INDEX uq_crm_conversations_brand_jid,
  ADD UNIQUE KEY uq_crm_conversations_brand_session_jid (brand_id, whatsapp_session_id, whatsapp_jid),
  ADD KEY idx_crm_conversations_session (brand_id, whatsapp_session_id, last_message_at),
  ADD CONSTRAINT fk_crm_conversations_whatsapp_session
    FOREIGN KEY (whatsapp_session_id) REFERENCES crm_whatsapp_sessions (id);

ALTER TABLE crm_messages
  ADD COLUMN whatsapp_session_id BIGINT UNSIGNED NULL AFTER brand_id;

UPDATE crm_messages message
JOIN crm_conversations conversation ON conversation.id = message.conversation_id
SET message.whatsapp_session_id = conversation.whatsapp_session_id
WHERE message.whatsapp_session_id IS NULL;

ALTER TABLE crm_messages
  MODIFY COLUMN whatsapp_session_id BIGINT UNSIGNED NOT NULL,
  DROP INDEX uq_crm_messages_brand_wa_id,
  ADD UNIQUE KEY uq_crm_messages_brand_session_wa_id (brand_id, whatsapp_session_id, whatsapp_message_id),
  ADD KEY idx_crm_messages_session (brand_id, whatsapp_session_id, sent_at),
  ADD CONSTRAINT fk_crm_messages_whatsapp_session
    FOREIGN KEY (whatsapp_session_id) REFERENCES crm_whatsapp_sessions (id);

ALTER TABLE crm_outbox_jobs
  ADD COLUMN whatsapp_session_id BIGINT UNSIGNED NULL AFTER brand_id,
  ADD KEY idx_crm_outbox_session (brand_id, whatsapp_session_id, status, available_at);

CREATE TABLE crm_whatsapp_session_users (
  brand_id BIGINT UNSIGNED NOT NULL,
  whatsapp_session_id BIGINT UNSIGNED NOT NULL,
  erp_user_id BIGINT UNSIGNED NOT NULL,
  assigned_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (whatsapp_session_id, erp_user_id),
  KEY idx_crm_whatsapp_session_users_brand_user (brand_id, erp_user_id),
  CONSTRAINT fk_crm_whatsapp_session_users_session
    FOREIGN KEY (whatsapp_session_id) REFERENCES crm_whatsapp_sessions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Keep historical outbox jobs on the existing/default device.
UPDATE crm_outbox_jobs job
JOIN crm_conversations conversation
  ON conversation.brand_id = job.brand_id
 AND conversation.id = UNHEX(REPLACE(JSON_UNQUOTE(JSON_EXTRACT(job.payload, '$.conversationId')), '-', ''))
SET job.whatsapp_session_id = conversation.whatsapp_session_id
WHERE job.whatsapp_session_id IS NULL;
