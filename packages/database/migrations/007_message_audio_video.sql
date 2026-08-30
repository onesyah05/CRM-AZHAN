ALTER TABLE crm_messages
  MODIFY COLUMN message_type ENUM('text', 'image', 'video', 'audio', 'document') NOT NULL DEFAULT 'text';
