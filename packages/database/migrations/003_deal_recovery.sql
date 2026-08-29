-- Satu lead hanya memiliki satu conversion; retry memakai idempotency key yang sama.

ALTER TABLE crm_deal_conversions
  MODIFY COLUMN status ENUM('pending','erp_completed','completed','requires_retry','failed') NOT NULL DEFAULT 'pending',
  ADD UNIQUE KEY uq_crm_deals_lead (brand_id, lead_id);
