ALTER TABLE crm_leads
  MODIFY deal_substatus ENUM(
    'book_seat',
    'book_seat_expired',
    'dp_pending',
    'dp_confirmed',
    'dp_rejected',
    'paid'
  ) NULL;
