-- Control de stock en ventas por sucursal (delivery_settings.inventoryEnforceOnSale).
-- false => permite vender sin bloquear por stock y no pausa productos automáticamente.

CREATE OR REPLACE FUNCTION public.branch_inventory_enforce_on_sale(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $$
  SELECT COALESCE(
    (b.delivery_settings->>'inventoryEnforceOnSale')::boolean,
    (b.delivery_settings->>'inventory_enforce_on_sale')::boolean,
    true
  )
  FROM public.branches b
  WHERE b.id = p_branch_id;
$$;

CREATE OR REPLACE FUNCTION public.trg_apply_inventory_after_order_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_ds jsonb;
  v_allow_neg boolean;
  v_auto_pause boolean;
  v_enforce boolean;
BEGIN
  IF NEW.branch_id IS NULL OR NEW.company_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT delivery_settings INTO v_ds FROM public.branches WHERE id = NEW.branch_id LIMIT 1;

  v_enforce := COALESCE(public.branch_inventory_enforce_on_sale(NEW.branch_id), true);

  SELECT
    COALESCE((theme_config->'inventory'->>'allowNegativeStock')::boolean, false),
    COALESCE((theme_config->'inventory'->>'autoPauseProducts')::boolean, true)
  INTO v_allow_neg, v_auto_pause
  FROM public.companies WHERE id = NEW.company_id LIMIT 1;

  IF NOT v_enforce THEN
    v_allow_neg := true;
    v_auto_pause := false;
  END IF;

  PERFORM public.apply_inventory_for_order_internal(
    NEW.id,
    NEW.branch_id,
    NEW.company_id,
    NEW.items,
    COALESCE(v_ds, '{}'::jsonb),
    v_allow_neg,
    v_auto_pause
  );
  RETURN NEW;
END;
$function$;
