-- Keep a single create_order_transaction signature (with optional p_client_id).

DROP FUNCTION IF EXISTS public.create_order_transaction(
  text, text, text, jsonb, numeric, text, text, text,
  uuid, uuid, text, text, text, jsonb, numeric, text, text, jsonb
);
