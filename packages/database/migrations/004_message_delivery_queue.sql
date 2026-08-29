ALTER TABLE crm_messages
  ADD COLUMN media_mime_type VARCHAR(150) NULL AFTER media_object_key,
  ADD COLUMN media_file_name VARCHAR(255) NULL AFTER media_mime_type;

ALTER TABLE crm_outbox_jobs
  ADD COLUMN locked_by VARCHAR(120) NULL AFTER locked_at;
