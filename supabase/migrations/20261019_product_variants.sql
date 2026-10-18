-- Apply once (safe to re-run) BEFORE deploying the product-variants UI.
-- Lets several products be shown as ONE menu with a variant picker
-- (e.g. 若よもぎ蒸し → 改 / 美 / 艶 / A / C / Dダッシュ). Each variant stays its
-- own product row, so stock, wholesale/partner/general prices and old orders
-- are untouched. Only two display columns are added.
begin;

alter table public.products
 add column if not exists group_name text,
 add column if not exists variant_label text;

-- Group the existing 若よもぎ蒸し products: "【会員限定】若よもぎ蒸し【改】"
-- → group "【会員限定】若よもぎ蒸し", variant "改". Names are not changed.
update public.products
 set group_name = regexp_replace(name, '【[^】]*】$', ''),
     variant_label = substring(name from '【([^】]*)】$')
 where name like '【会員限定】若よもぎ蒸し【%】'
   and group_name is null;

-- The public catalogue now also returns the grouping columns.
drop function if exists public.customer_products();
create function public.customer_products()
returns table(id uuid, name text, volume text, description text, general_price numeric, stock int, image_url text, group_name text, variant_label text)
language sql stable security definer set search_path = public as $$
 select p.id,p.name,p.volume,p.description,p.general_price,p.stock,p.image_url,p.group_name,p.variant_label
 from public.products p where p.active and p.general_price > 0 order by p.sort_order,p.id;
$$;
revoke all on function public.customer_products() from public;
grant execute on function public.customer_products() to anon, authenticated;

commit;

-- Check (should list 6 rows with group_name and variant_label filled):
select name, group_name, variant_label from public.products where group_name is not null order by sort_order;
