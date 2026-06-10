-- create_order_transaction: allow duplicate phones, optional p_client_id, skip phone rewrite on update

CREATE OR REPLACE FUNCTION public.create_order_transaction(
  p_client_name text,
  p_client_phone text,
  p_client_rut text,
  p_items jsonb,
  p_total numeric,
  p_payment_type text,
  p_payment_ref text,
  p_note text,
  p_branch_id uuid,
  p_company_id uuid,
  p_status text,
  p_payment_method_specific text DEFAULT NULL::text,
  p_order_type text DEFAULT 'pickup'::text,
  p_delivery_address jsonb DEFAULT NULL::jsonb,
  p_delivery_fee numeric DEFAULT 0,
  p_coupon_code text DEFAULT NULL::text,
  p_order_origin text DEFAULT NULL::text,
  p_payment_breakdown jsonb DEFAULT NULL::jsonb,
  p_client_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_client_id uuid;
  v_new_order jsonb;
  v_existing_client_id uuid;
  v_company_id uuid;
  v_canonical_phone text;
  v_phone_normalized text;
  v_normalized jsonb;
  v_items jsonb;
  v_subtotal numeric;
  v_final_total numeric;
  v_delivery_fee numeric := 0;
  v_fulfillment text;
  v_channel text;
  v_handoff text;
  i int;
  v_discount_amount numeric := 0;
  v_coupon_id uuid;
  v_coupon_result jsonb;
  v_order_id bigint;
  v_shift_id uuid;
  v_shift_sequence int;
  v_payment_breakdown jsonb;
  v_user_role text;
  v_delivery_km numeric;
BEGIN
  IF p_branch_id IS NULL THEN RAISE EXCEPTION 'branch_required' USING errcode = '22000'; END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) IS NULL THEN RAISE EXCEPTION 'items_required' USING errcode = '22000'; END IF;
  IF p_company_id IS NULL THEN
    SELECT company_id INTO v_company_id FROM public.branches WHERE id = p_branch_id;
  ELSE
    v_company_id := p_company_id;
  END IF;
  IF v_company_id IS NULL THEN RAISE EXCEPTION 'company_not_found' USING errcode = 'P0001'; END IF;

  v_canonical_phone := public.format_cl_phone_display(p_client_phone);
  v_phone_normalized := public.normalize_cl_phone_digits(p_client_phone);

  SELECT lower(btrim(u.role)) INTO v_user_role
  FROM public.users u
  WHERE u.auth_user_id = auth.uid() AND coalesce(u.is_active, true) = true
  LIMIT 1;

  v_normalized := public.validate_and_normalize_order_items(p_branch_id, p_items);
  v_items := v_normalized -> 'items';
  v_subtotal := (v_normalized ->> 'subtotal')::numeric;

  SELECT id INTO v_shift_id
  FROM public.cash_shifts
  WHERE branch_id = p_branch_id AND status = 'open'
  ORDER BY opened_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_shift_id IS NOT NULL THEN
    SELECT coalesce(max(shift_sequence), 0) + 1 INTO v_shift_sequence
    FROM public.orders WHERE shift_id = v_shift_id;
  END IF;

  IF p_client_id IS NOT NULL THEN
    SELECT id INTO v_existing_client_id
    FROM public.clients
    WHERE id = p_client_id
      AND company_id = v_company_id
    LIMIT 1;
    IF v_existing_client_id IS NULL THEN
      RAISE EXCEPTION 'client_not_found_or_not_allowed' USING errcode = '22000';
    END IF;
  ELSIF v_phone_normalized <> '' THEN
    SELECT id INTO v_existing_client_id
    FROM public.clients
    WHERE company_id = v_company_id
      AND phone_normalized = v_phone_normalized
    ORDER BY coalesce(last_order_at, created_at) DESC NULLS LAST
    LIMIT 1;
  END IF;

  v_fulfillment := lower(btrim(coalesce(nullif(btrim(p_order_type), ''), 'pickup')));
  IF v_fulfillment IN ('envio', 'envío', 'despacho') THEN v_fulfillment := 'delivery'; END IF;

  IF v_fulfillment = 'delivery' THEN
    IF p_delivery_address IS NULL OR p_delivery_address = 'null'::jsonb THEN
      RAISE EXCEPTION 'delivery_address_required' USING errcode = '22000';
    END IF;
    v_delivery_fee := public.resolve_delivery_fee_for_role(
      v_user_role, p_branch_id, p_delivery_address, v_subtotal, p_delivery_fee, NULL
    );
    v_handoff := NULL;
    FOR i IN 1..20 LOOP
      v_handoff := lpad((floor(random() * 900000) + 100000)::text, 6, '0');
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.orders o WHERE o.handoff_code IS NOT NULL AND o.handoff_code = v_handoff
      );
    END LOOP;
    IF EXISTS (
      SELECT 1 FROM public.orders o WHERE o.handoff_code IS NOT NULL AND o.handoff_code = v_handoff
    ) THEN
      RAISE EXCEPTION 'handoff_code_collision' USING errcode = '22000';
    END IF;
  ELSE
    v_delivery_fee := 0;
    v_handoff := NULL;
    v_fulfillment := 'pickup';
  END IF;

  IF p_order_origin IS NOT NULL AND lower(btrim(p_order_origin)) IN ('web', 'online', 'menu') THEN
    v_channel := 'online';
  ELSIF v_fulfillment = 'delivery' THEN
    v_channel := 'delivery';
  ELSE
    v_channel := 'pickup';
  END IF;

  v_coupon_result := public.compute_order_coupon_discount(
    v_company_id, p_coupon_code, v_subtotal, v_canonical_phone, NULL
  );
  v_discount_amount := coalesce((v_coupon_result ->> 'discount_amount')::numeric, 0);
  v_coupon_id := (v_coupon_result ->> 'coupon_id')::uuid;
  v_final_total := greatest(0::numeric, v_subtotal - v_discount_amount) + v_delivery_fee;
  v_final_total := round(v_final_total, 2);

  IF abs(coalesce(p_total, 0) - v_final_total) > 1 THEN
    RAISE EXCEPTION 'invalid_item_price' USING errcode = '22000';
  END IF;

  v_payment_breakdown := public.normalize_payment_breakdown_for_total(p_payment_breakdown, v_final_total);

  IF v_existing_client_id IS NOT NULL THEN
    UPDATE public.clients
    SET name = coalesce(p_client_name, name),
        rut = CASE WHEN length(p_client_rut) > 6 THEN p_client_rut ELSE rut END,
        total_spent = coalesce(total_spent, 0) + v_final_total,
        total_orders = coalesce(total_orders, 0) + 1,
        last_order_at = now(),
        updated_at = now()
    WHERE id = v_existing_client_id
    RETURNING id INTO v_client_id;
  ELSE
    BEGIN
      INSERT INTO public.clients (name, phone, rut, total_spent, total_orders, last_order_at, company_id)
      VALUES (
        p_client_name,
        v_canonical_phone,
        coalesce(p_client_rut, 'SIN-RUT-' || floor(extract(epoch FROM now()))::text),
        v_final_total,
        1,
        now(),
        v_company_id
      )
      RETURNING id INTO v_client_id;
    EXCEPTION
      WHEN unique_violation THEN
        RAISE EXCEPTION 'duplicate_client_phone' USING errcode = '23505';
    END;
  END IF;

  INSERT INTO public.orders (
    client_id, client_name, client_phone, client_rut, items, total, subtotal, discount_total,
    discount_coupon_id, payment_type, payment_ref, payment_method_specific, note, status,
    branch_id, company_id, created_at, order_type, channel, delivery_address, delivery_fee,
    handoff_code, shift_id, shift_sequence, payment_breakdown
  ) VALUES (
    v_client_id, p_client_name, v_canonical_phone, p_client_rut, v_items, v_final_total, v_subtotal,
    v_discount_amount, v_coupon_id, p_payment_type, p_payment_ref, p_payment_method_specific, p_note,
    p_status, p_branch_id, v_company_id, now(), 'sale', v_channel,
    CASE WHEN v_fulfillment = 'delivery' THEN p_delivery_address ELSE NULL END,
    CASE WHEN v_fulfillment = 'delivery' THEN v_delivery_fee ELSE 0 END,
    v_handoff, v_shift_id, v_shift_sequence, v_payment_breakdown
  )
  RETURNING id INTO v_order_id;

  IF v_fulfillment = 'delivery' AND v_client_id IS NOT NULL THEN
    v_delivery_km := NULL;
    IF p_delivery_address ? 'delivery_km' THEN
      v_delivery_km := NULLIF((p_delivery_address ->> 'delivery_km')::numeric, 0);
    END IF;
    PERFORM public.upsert_client_delivery_address(
      v_client_id, v_company_id, p_delivery_address, v_delivery_km
    );
  END IF;

  SELECT to_jsonb(o.*) INTO v_new_order FROM public.orders o WHERE o.id = v_order_id;

  IF v_coupon_id IS NOT NULL THEN
    INSERT INTO public.discount_coupon_redemptions (
      coupon_id, order_id, company_id, amount_saved, client_phone
    ) VALUES (
      v_coupon_id, v_order_id, v_company_id, v_discount_amount, v_canonical_phone
    );
    UPDATE public.discount_coupons
    SET redemptions_count = redemptions_count + 1, updated_at = now()
    WHERE id = v_coupon_id;
  END IF;

  RETURN v_new_order;
END;
$function$;
