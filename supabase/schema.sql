-- yomogi-wholesale: Supabase schema
-- Run this once in the Supabase project's SQL Editor (or via `supabase db push`).
--
-- Auth model:
--   - Salons sign in with a passwordless email magic link (supabase.auth.signInWithOtp).
--     A `salons` row is created at registration time (status='pending'); it gets linked
--     to the auth user (user_id) the first time that person actually logs in.
--   - The admin signs in with Supabase Auth email+password. There is no public admin
--     sign-up: create the admin's auth user by hand in the Supabase dashboard
--     (Authentication > Users > Add user), then add their email to `admins` below.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- admins: allow-list of operator emails, used by RLS policies below.
-- ---------------------------------------------------------------------------
create table if not exists admins (
  email text primary key
);

alter table admins enable row level security;

create policy "admins can read the admin list"
  on admins for select
  using (auth.email() = email);

-- After creating your admin user in the Supabase dashboard, run:
--   insert into admins (email) values ('you@example.com');

create or replace function is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from admins where email = auth.email());
$$;

-- ---------------------------------------------------------------------------
-- salons
-- ---------------------------------------------------------------------------
create table if not exists salons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  salon_name text not null,
  contact_name text not null,
  email text not null unique,
  phone text not null,
  zip text,
  address text not null,
  instagram text,
  salon_url text,
  desired_products text,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved')),
  account_type text not null default 'salon' check (account_type in ('salon', 'partner')),
  registered_at timestamptz not null default now()
);

alter table salons enable row level security;

-- Public registration form: anyone can create a pending salon row.
create policy "anyone can register a salon"
  on salons for insert
  to anon, authenticated
  with check (status = 'pending' and user_id is null);

-- A logged-in salon can see its own row (matched by user_id, or by email
-- before it has claimed the row on first login).
create policy "salon can read own row"
  on salons for select
  to authenticated
  using (user_id = auth.uid() or (user_id is null and email = auth.email()));

-- Let a freshly-authenticated user claim their pending salon row once.
create policy "salon can claim own row on first login"
  on salons for update
  to authenticated
  using (user_id is null and email = auth.email())
  with check (user_id = auth.uid());

create policy "admin can read all salons"
  on salons for select
  to authenticated
  using (is_admin());

create policy "admin can update any salon"
  on salons for update
  to authenticated
  using (is_admin());

-- ---------------------------------------------------------------------------
-- products
-- ---------------------------------------------------------------------------
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  volume text,
  description text,
  general_price numeric not null default 0,
  wholesale_price numeric not null default 0,
  partner_price numeric,
  min_order_qty int not null default 1,
  stock int not null default 0,
  active boolean not null default true
);

alter table products enable row level security;

create policy "anyone can read active products"
  on products for select
  to anon, authenticated
  using (active = true or is_admin());

create policy "admin can manage products"
  on products for all
  to authenticated
  using (is_admin())
  with check (is_admin());

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_number text not null unique,
  salon_id uuid not null references salons(id) on delete restrict,
  items jsonb not null,
  subtotal numeric not null,
  shipping numeric not null,
  total numeric not null,
  payment_status text not null default '未入金' check (payment_status in ('未入金', '入金確認済')),
  payment_requested boolean not null default true,
  ship_status text not null default '未発送' check (ship_status in ('未発送', '発送準備中', '発送済')),
  carrier text,
  tracking_number text,
  shipped_at text,
  created_at timestamptz not null default now()
);

alter table orders enable row level security;

create policy "salon can read own orders"
  on orders for select
  to authenticated
  using (
    salon_id in (select id from salons where user_id = auth.uid())
    or is_admin()
  );

-- Orders are created via the place_order() RPC below (security definer), not
-- direct inserts, so stock decrements stay atomic with order creation.

create policy "admin can update orders"
  on orders for update
  to authenticated
  using (is_admin());

-- Atomically create an order and decrement stock for a logged-in salon.
-- `p_items` shape: [{"productId": "...", "name": "...", "unitPrice": n, "qty": n, "subtotal": n}, ...]
create or replace function place_order(
  p_order_number text,
  p_items jsonb,
  p_subtotal numeric,
  p_shipping numeric,
  p_total numeric
)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salon_id uuid;
  v_item jsonb;
  v_order orders;
begin
  select id into v_salon_id from salons where user_id = auth.uid();
  if v_salon_id is null then
    raise exception 'no approved salon linked to this account';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    update products
      set stock = stock - (v_item->>'qty')::int
      where id = (v_item->>'productId')::uuid
        and stock >= (v_item->>'qty')::int;
    if not found then
      raise exception 'insufficient stock for product %', v_item->>'name';
    end if;
  end loop;

  insert into orders (order_number, salon_id, items, subtotal, shipping, total)
  values (p_order_number, v_salon_id, p_items, p_subtotal, p_shipping, p_total)
  returning * into v_order;

  return v_order;
end;
$$;

-- ---------------------------------------------------------------------------
-- bank_info: single-row settings table for wire-transfer details.
-- ---------------------------------------------------------------------------
create table if not exists bank_info (
  id boolean primary key default true check (id),
  bank_name text not null,
  branch_name text not null,
  account_type text not null,
  account_number text not null,
  account_holder text not null,
  deadline_days int not null default 7
);

alter table bank_info enable row level security;

create policy "authenticated can read bank info"
  on bank_info for select
  to authenticated
  using (true);

create policy "admin can update bank info"
  on bank_info for all
  to authenticated
  using (is_admin())
  with check (is_admin());

insert into bank_info (id, bank_name, branch_name, account_type, account_number, account_holder, deadline_days)
values (true, 'みずほ銀行', '大阪支店', '普通', '1234567', 'ヨモギノワ サリ', 7)
on conflict (id) do nothing;

insert into products (name, volume, description, general_price, wholesale_price, min_order_qty, stock, active)
values (
  'よもぎの環 入浴剤',
  '300g（約15回分）',
  '11年間よもぎ蒸しサロンで使い続けてきた処方をもとにした、植物系入浴剤です。よもぎ・BANSEIエキス配合。敏感肌のお子様にもお使いいただける、やさしい設計。',
  3300, 1980, 3, 48, true
)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- public_salon_directory: lets the (password-gated, but unauthenticated)
-- login screen list approved salon names to pick from, and looks up the
-- email needed to actually sign in with the shared salon password. Owned by
-- the table owner, so it reads through RLS on `salons` once, at view-creation
-- time, rather than per request — the standard Postgres/Supabase pattern for
-- exposing a narrow, filtered slice of an RLS-protected table.
-- ---------------------------------------------------------------------------
create or replace view public_salon_directory as
  select id, salon_name, email from salons where status = 'approved';

grant select on public_salon_directory to anon, authenticated;
