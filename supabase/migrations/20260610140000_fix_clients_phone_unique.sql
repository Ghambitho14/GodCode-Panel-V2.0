-- Allow duplicate client phones (e.g. test data). Drop global unique; add lookup column only.

ALTER TABLE public.clients DROP CONSTRAINT IF EXISTS clients_phone_key;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS phone_normalized text
  GENERATED ALWAYS AS (public.normalize_cl_phone_digits(phone)) STORED;

CREATE INDEX IF NOT EXISTS idx_clients_company_phone_normalized
  ON public.clients (company_id, phone_normalized)
  WHERE phone_normalized <> '';
