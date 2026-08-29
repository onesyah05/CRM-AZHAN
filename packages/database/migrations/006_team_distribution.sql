CREATE TABLE crm_team_members (
  brand_id BIGINT UNSIGNED NOT NULL,
  erp_user_id BIGINT UNSIGNED NOT NULL,
  email VARCHAR(255) NOT NULL,
  display_name VARCHAR(120) NOT NULL,
  allocation_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
  allocated_in_cycle TINYINT UNSIGNED NOT NULL DEFAULT 0,
  rotation_position SMALLINT UNSIGNED NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (brand_id, erp_user_id),
  UNIQUE KEY uq_crm_team_brand_email (brand_id, email),
  KEY idx_crm_team_rotation (brand_id, is_active, rotation_position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE crm_distribution_state (
  brand_id BIGINT UNSIGNED NOT NULL,
  cycle_number BIGINT UNSIGNED NOT NULL DEFAULT 1,
  assigned_in_cycle TINYINT UNSIGNED NOT NULL DEFAULT 0,
  cursor_position SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (brand_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_crm_leads_brand_assignee
  ON crm_leads (brand_id, assignee_erp_user_id, updated_at);
