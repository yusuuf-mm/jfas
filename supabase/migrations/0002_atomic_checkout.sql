-- Correct the initial checkout RPC so every order, its lines, and stock
-- updates commit or roll back as one transaction. This migration is safe to
-- apply after 0001 and replaces the function in place.

create or replace function public.create_order(
  p_items jsonb,
  p_email text default '',
  p_full_name text default '',
  p_phone text default '',
  p_address text default '',
  p_city text default '',
  p_state text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order_id uuid := gen_random_uuid();
  v_order_number text := 'JF-' || upper(substr(replace(v_order_id::text, '-', ''), 1, 7));
  v_item jsonb;
  v_line jsonb;
  v_product_id text;
  v_qty integer;
  v_price integer;
  v_stock integer;
  v_lines jsonb := '[]'::jsonb;
  v_subtotal integer := 0;
  v_delivery integer := 0;
  v_total integer := 0;
begin
  if v_user_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART' using errcode = '22000';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'TOO_MANY_LINES' using errcode = '22000';
  end if;

  -- Validate every item and lock each product before any state changes.
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_product_id := nullif(trim(v_item ->> 'product_id'), '');
    v_qty := (v_item ->> 'quantity')::integer;
    if v_product_id is null then
      raise exception 'INVALID_PRODUCT:%', coalesce(v_item ->> 'product_id', '?') using errcode = '22000';
    end if;
    if v_qty is null or v_qty < 1 or v_qty > 99 then
      raise exception 'INVALID_QUANTITY:%', v_product_id using errcode = '22000';
    end if;
    if exists (select 1 from jsonb_array_elements(v_lines) line where line ->> 'product_id' = v_product_id) then
      raise exception 'DUPLICATE_PRODUCT:%', v_product_id using errcode = '22000';
    end if;

    select price, stock into v_price, v_stock
    from public.products
    where id = v_product_id and active = true
    for update;
    if not found then
      raise exception 'INVALID_PRODUCT:%', v_product_id using errcode = '22000';
    end if;
    if v_stock < v_qty then
      raise exception 'INSUFFICIENT_STOCK:%', v_product_id using errcode = '22000';
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'product_id', v_product_id,
      'quantity', v_qty,
      'unit_price', v_price,
      'line_total', v_price * v_qty
    ));
    v_subtotal := v_subtotal + v_price * v_qty;
  end loop;

  v_delivery := case when v_subtotal >= 50000 then 0 else 2500 end;
  v_total := v_subtotal + v_delivery;

  insert into public.orders (
    id, order_number, user_id, email, full_name, phone, address, city, state,
    subtotal, delivery_fee, total, status, email_status
  ) values (
    v_order_id, v_order_number, v_user_id,
    left(trim(p_email), 320), left(trim(p_full_name), 200),
    left(trim(p_phone), 40), left(trim(p_address), 500),
    left(trim(p_city), 120), left(trim(p_state), 120),
    v_subtotal, v_delivery, v_total, 'confirmed', 'pending'
  );

  for v_line in select * from jsonb_array_elements(v_lines)
  loop
    insert into public.order_items (order_id, product_id, quantity, unit_price, line_total)
    values (
      v_order_id,
      v_line ->> 'product_id',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unit_price')::integer,
      (v_line ->> 'line_total')::integer
    );
    update public.products
    set stock = stock - (v_line ->> 'quantity')::integer, updated_at = now()
    where id = v_line ->> 'product_id';
  end loop;

  return jsonb_build_object(
    'id', v_order_id,
    'order_number', v_order_number,
    'subtotal', v_subtotal,
    'delivery_fee', v_delivery,
    'total', v_total
  );
end;
$$;
