-- yomogi-wholesale: Supabase schema
-- Run this once in the Supabase project's SQL Editor (or via `supabase db push`).
--
-- Auth model:
--   - Each salon gets its own permanent login_code (e.g. yomogi001), assigned
--     automatically at registration and used as both its identifier and its
--     Supabase Auth password (set via signUp() right after register_salon()
--     returns it). Logging in is just "type your code" - find_salon_email_by_code()
--     resolves it to an email, then the app calls signInWithPassword(). A
--     `salons` row is created at registration time (status='pending'); it
--     gets linked to the auth user (user_id) the first time that person
--     actually logs in.
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
  email text unique, -- optional contact address; never used for auth
  auth_email text unique, -- always present; the identifier signUp()/signInWithPassword() actually use
  phone text not null,
  zip text,
  address text not null,
  instagram text,
  salon_url text,
  desired_products text,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  account_type text not null default 'salon' check (account_type in ('salon', 'partner')),
  login_code text unique,
  registered_at timestamptz not null default now()
);

alter table salons enable row level security;

-- Migrating an existing database: these ALTERs are what actually take
-- effect there (the CREATE TABLE above is a no-op once the table exists).
alter table salons add column if not exists auth_email text unique;
alter table salons alter column email drop not null;

-- Each salon's own permanent, individual login code (e.g. yomogi001),
-- assigned automatically on registration - also used (as <code>@yomogi-wholesale.local)
-- for its Supabase Auth identity, so real contact email is optional and
-- never required for login. There is nothing to keep in sync when
-- account_type changes, and no shared list of names for one salon to
-- browse another's info in.
create sequence if not exists salon_login_code_seq;

create or replace function generate_salon_login_code()
returns trigger
language plpgsql
as $$
begin
  if new.login_code is null then
    new.login_code := 'yomogi' || lpad(nextval('salon_login_code_seq')::text, 3, '0');
  end if;
  if new.auth_email is null then
    new.auth_email := new.login_code || '@yomogi-wholesale.local';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_salon_login_code on salons;
create trigger trg_salon_login_code
  before insert on salons
  for each row execute function generate_salon_login_code();

-- One-time backfill for salons registered before login_code/auth_email
-- existed, assigned in registration order, then advance the sequence past
-- them. Existing salons keep their real email as auth_email (that's the
-- address their Supabase Auth account already uses); only rows with no
-- email at all fall back to the synthetic pattern.
with numbered as (
  select id, row_number() over (order by registered_at) as rn
  from salons where login_code is null
)
update salons s set login_code = 'yomogi' || lpad(numbered.rn::text, 3, '0')
from numbered where s.id = numbered.id;

select setval('salon_login_code_seq', (select count(*) from salons where login_code is not null));

update salons set auth_email = email where auth_email is null and email is not null;
update salons set auth_email = login_code || '@yomogi-wholesale.local' where auth_email is null;

-- Public registration form: anyone can create a pending salon row. Prefer
-- the register_salon() RPC below, which also returns the assigned code.
create policy "anyone can register a salon"
  on salons for insert
  to anon, authenticated
  with check (status = 'pending' and user_id is null);

-- A logged-in salon can see its own row (matched by user_id, or by
-- auth_email before it has claimed the row on first login).
drop policy if exists "salon can read own row" on salons;
create policy "salon can read own row"
  on salons for select
  to authenticated
  using (user_id = auth.uid() or (user_id is null and auth_email = auth.email()));

-- Let a freshly-authenticated user claim their pending salon row once.
drop policy if exists "salon can claim own row on first login" on salons;
create policy "salon can claim own row on first login"
  on salons for update
  to authenticated
  using (user_id is null and auth_email = auth.email())
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
  active boolean not null default true,
  sort_order int not null default 0,
  image_url text,
  requires_shipping boolean not null default true
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
  created_at timestamptz not null default now(),
  cancelled_at timestamptz
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

-- Operator-only: the same as place_order(), but for an order the operator
-- is entering on a salon's behalf (phone/in-person orders) - takes the
-- target salon explicitly instead of resolving it from auth.uid().
create or replace function admin_place_order(
  p_salon_id uuid,
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
  v_item jsonb;
  v_order orders;
begin
  if not is_admin() then
    raise exception 'only the operator can do this';
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
  values (p_order_number, p_salon_id, p_items, p_subtotal, p_shipping, p_total)
  returning * into v_order;

  return v_order;
end;
$$;

-- Operator-only: cancel an order and put its items' quantities back into
-- stock. Idempotent (cancelling an already-cancelled order is a no-op).
create or replace function cancel_order(p_order_id uuid)
returns orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_order orders;
begin
  if not is_admin() then
    raise exception 'only the operator can cancel orders';
  end if;

  select * into v_order from orders where id = p_order_id;
  if v_order.id is null then
    raise exception 'order not found';
  end if;
  if v_order.cancelled_at is not null then
    return v_order;
  end if;

  for v_item in select * from jsonb_array_elements(v_order.items) loop
    update products
      set stock = stock + (v_item->>'qty')::int
      where id = (v_item->>'productId')::uuid;
  end loop;

  update orders set cancelled_at = now() where id = p_order_id returning * into v_order;
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
  deadline_days int not null default 7,
  issuer_name text not null default '',
  issuer_address text not null default ''
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

-- Superseded by each salon's individual login_code: no more shared
-- password bucketed by account_type, so nothing to browse and nothing to
-- keep in sync when a salon's type changes.
drop view if exists public_salon_directory;
drop function if exists admin_set_salon_password(uuid, text);

-- ---------------------------------------------------------------------------
-- register_salon: creates the pending salon row and hands back its
-- auto-assigned login_code in one call. A plain client-side insert can't do
-- this and read the row back in the same request (the registrant isn't
-- authenticated yet, so RLS wouldn't let an anon insert select its own new
-- row); running as security definer sidesteps that.
-- ---------------------------------------------------------------------------
create or replace function register_salon(
  p_salon_name text, p_contact_name text, p_email text, p_phone text,
  p_zip text, p_address text, p_instagram text, p_salon_url text,
  p_desired_products text, p_notes text
)
returns salons
language plpgsql
security definer
set search_path = public
as $$
declare
  v_salon salons;
begin
  insert into salons (salon_name, contact_name, email, phone, zip, address, instagram, salon_url, desired_products, notes)
  values (p_salon_name, p_contact_name, p_email, p_phone, p_zip, p_address, p_instagram, p_salon_url, p_desired_products, p_notes)
  returning * into v_salon;
  return v_salon;
end;
$$;

grant execute on function register_salon(text, text, text, text, text, text, text, text, text, text) to anon, authenticated;

-- find_salon_email_by_code: the unauthenticated login screen's only way to
-- turn "the code someone typed" into the auth_email Supabase Auth needs to
-- sign in with (never the optional contact email). Only ever returns an
-- approved salon's auth identifier, never anything else about it, and only
-- for an exact code match.
create or replace function find_salon_email_by_code(p_code text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select auth_email from salons where login_code = p_code and status = 'approved' limit 1;
$$;

grant execute on function find_salon_email_by_code(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- product-images: public bucket for product photos, admin-managed.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('product-images', 'product-images', true)
on conflict (id) do nothing;

create policy "public can view product images"
  on storage.objects for select
  using (bucket_id = 'product-images');

create policy "admin can upload product images"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'product-images' and public.is_admin());

create policy "admin can replace product images"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'product-images' and public.is_admin());

create policy "admin can delete product images"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'product-images' and public.is_admin());
