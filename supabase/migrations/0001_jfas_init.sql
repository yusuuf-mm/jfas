-- J-FAS initial schema: products, profiles, orders, order_items.
-- Server-side order creation lives in the SECURITY DEFINER function
-- `public.create_order`, so browser-supplied prices/totals are never trusted.
-- Apply with: supabase db push  (or run this file against the project database).

-- Required for gen_random_uuid()
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- --------------------------------------------------------------- products
create table if not exists public.products (
  id text primary key,
  name text not null,
  category text not null check (category in ('Jewelry', 'Bags', 'Accessories')),
  price integer not null check (price > 0),
  image text not null,
  description text not null default '',
  badge text,
  color text not null default '',
  stock integer not null default 50 check (stock >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------- orders
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  user_id uuid not null references public.profiles (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  phone text not null default '',
  address text not null default '',
  city text not null default '',
  state text not null default '',
  subtotal integer not null check (subtotal >= 0),
  delivery_fee integer not null default 0 check (delivery_fee >= 0),
  total integer not null check (total >= 0),
  status text not null default 'confirmed',
  email_status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------ order_items
create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id text not null references public.products (id) on delete restrict,
  quantity integer not null check (quantity > 0 and quantity <= 99),
  unit_price integer not null check (unit_price > 0),
  line_total integer not null check (line_total >= 0),
  created_at timestamptz not null default now()
);

create index if not exists orders_user_id_created_idx
  on public.orders (user_id, created_at desc);
create index if not exists order_items_order_id_idx
  on public.order_items (order_id);
create index if not exists products_active_idx
  on public.products (active) where active = true;

-- -------------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;

-- Products: public read-only catalogue of active products.
drop policy if exists "products_select_active" on public.products;
create policy "products_select_active"
  on public.products for select
  using (active = true);

-- Profiles: users read/update only their own row.
-- Rows are created by the handle_new_user trigger (SECURITY DEFINER),
-- so no client-side insert policy is needed.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
  on public.profiles for select
  using (auth.uid() = id);
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
  on public.profiles for update
  using (auth.uid() = id);

-- Orders: users read only their own orders. Writes go through the
-- SECURITY DEFINER create_order function / service-role Edge Function,
-- so no direct insert/update/delete policies are granted.
drop policy if exists "orders_select_own" on public.orders;
create policy "orders_select_own"
  on public.orders for select
  using (auth.uid() = user_id);

-- Order items: readable only via an order owned by the caller.
drop policy if exists "order_items_select_own" on public.order_items;
create policy "order_items_select_own"
  on public.order_items for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and o.user_id = auth.uid()
    )
  );

-- --------------------------------------------- auth user -> profile sync
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', ''),
    coalesce(new.raw_user_meta_data ->> 'avatar_url', new.raw_user_meta_data ->> 'picture', '')
  on conflict (id) do update set
    email = excluded.email,
    updated_at = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- --------------------------------------- server-side order creation (RPC)
-- Never trusts browser prices/totals: looks up products, checks stock,
-- computes subtotal + delivery + total, inserts order + items atomically.
-- Delivery rule (matches storefront promise): free over NGN 50,000,
-- otherwise a flat NGN 2,500 fee.
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
  v_product_id text;
  v_qty integer;
  v_price integer;
  v_stock integer;
  v_subtotal integer := 0;
  v_delivery integer := 0;
  v_total integer := 0;
  v_count integer := 0;
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

    select price, stock into v_price, v_stock
    from public.products
    where id = v_product_id and active = true;

    if not found then
      raise exception 'INVALID_PRODUCT:%', v_product_id using errcode = '22000';
    end if;
    if v_stock < v_qty then
      raise exception 'INSUFFICIENT_STOCK:%', v_product_id using errcode = '22000';
    end if;

    update public.products
    set stock = stock - v_qty, updated_at = now()
    where id = v_product_id;

    insert into public.order_items (order_id, product_id, quantity, unit_price, line_total)
    values (v_order_id, v_product_id, v_qty, v_price, v_price * v_qty);

    v_subtotal := v_subtotal + v_price * v_qty;
    v_count := v_count + 1;
  end loop;

  if v_count = 0 then
    raise exception 'EMPTY_CART' using errcode = '22000';
  end if;

  v_delivery := case when v_subtotal >= 50000 then 0 else 2500 end;
  v_total := v_subtotal + v_delivery;

  insert into public.orders (
    id, order_number, user_id, email, full_name, phone, address, city, state,
    subtotal, delivery_fee, total, status, email_status
  )
  values (
    v_order_id, v_order_number, v_user_id,
    left(trim(p_email), 320), left(trim(p_full_name), 200),
    left(trim(p_phone), 40), left(trim(p_address), 500),
    left(trim(p_city), 120), left(trim(p_state), 120),
    v_subtotal, v_delivery, v_total, 'confirmed', 'pending'
  );

  return jsonb_build_object(
    'id', v_order_id,
    'order_number', v_order_number,
    'subtotal', v_subtotal,
    'delivery_fee', v_delivery,
    'total', v_total
  );
end;
$$;

revoke all on function public.create_order(jsonb, text, text, text, text, text, text) from public;
grant execute on function public.create_order(jsonb, text, text, text, text, text, text) to authenticated;

-- Stock decrement helper for the create-order Edge Function (service role
-- only; never exposed to anon/authenticated roles).
create or replace function public.decrement_stock(p_product_id text, p_qty integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.products
  set stock = greatest(0, stock - greatest(1, p_qty)), updated_at = now()
  where id = p_product_id;
end;
$$;

revoke all on function public.decrement_stock(text, integer) from public;

-- ------------------------------------------------------------------ seed
insert into public.products (id, name, category, price, image, description, badge, color, stock)
values
  ('sol-chain', 'Sol Chain Necklace', 'Jewelry', 28500, 'https://images.unsplash.com/photo-1599643478518-a784e5dc4c8f?auto=format&fit=crop&w=900&q=85', 'A delicate gold-plated chain with a softly sculpted pendant. Made for everyday, kept forever.', 'Bestseller', 'Gold', 50),
  ('arc-earrings', 'Arc Stud Earrings', 'Jewelry', 18500, 'https://images.unsplash.com/photo-1535632066927-ab7c9ab60908?auto=format&fit=crop&w=900&q=85', 'An organic silhouette with a subtle, polished glow. Your new everyday signature.', null, 'Gold', 50),
  ('muse-bag', 'Muse Mini Bag', 'Bags', 42000, 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?auto=format&fit=crop&w=900&q=85', 'A sculptural little companion in supple leather-look finish, sized for the essentials.', 'New', 'Chocolate', 30),
  ('pearl-drop', 'Pearl Drop Necklace', 'Jewelry', 32000, 'https://images.unsplash.com/photo-1611085583191-a3b181a88401?auto=format&fit=crop&w=900&q=85', 'Freshwater-inspired pearls meet a fine, luminous chain for a modern heirloom.', null, 'Pearl', 40),
  ('luna-cuff', 'Luna Cuff', 'Accessories', 24000, 'https://images.unsplash.com/photo-1611591437281-460bfbe1220a?auto=format&fit=crop&w=900&q=85', 'A clean, open cuff with a gentle curve. Beautiful worn alone or layered.', null, 'Gold', 40),
  ('woven-tote', 'Sunday Woven Tote', 'Bags', 38500, 'https://images.unsplash.com/photo-1590874103328-eac38a683ce7?auto=format&fit=crop&w=900&q=85', 'Room for the day, shape for the season. Thoughtful texture, easy elegance.', null, 'Natural', 25),
  ('halo-ring', 'Halo Signet Ring', 'Jewelry', 21500, 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=900&q=85', 'A softly rounded signet with a light-catching finish. A small piece with presence.', null, 'Gold', 40),
  ('terra-hoops', 'Terra Hoops', 'Jewelry', 19500, 'https://images.unsplash.com/photo-1630019852942-f89202989a59?auto=format&fit=crop&w=900&q=85', 'Lightweight sculpted hoops with a satisfyingly smooth, substantial feel.', null, 'Gold', 40)
on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  price = excluded.price,
  image = excluded.image,
  description = excluded.description,
  badge = excluded.badge,
  color = excluded.color,
  active = true,
  updated_at = now();
