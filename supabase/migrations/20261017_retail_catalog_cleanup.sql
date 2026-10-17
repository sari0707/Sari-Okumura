-- Apply once (safe to re-run). Tidies what the public shop (/#shop) shows:
--  1) 【業務用】 products: no general price => hidden from the public shop only
--     (still orderable by salons; their wholesale prices are untouched).
--  2) 若よもぎ蒸し products: name gets a 【会員限定】 prefix (not added twice).
--  3) Removes the stray "すいません。" from product descriptions.
-- Nothing is deleted. A copy of the affected rows is kept first.
begin;

create schema if not exists backup_20261004;
create table if not exists backup_20261004.products_before_catalog_cleanup as
 select * from public.products
 where name like '%業務用%' or name like '%若よもぎ蒸し%' or description like '%すいません。%';

update public.products set general_price = 0
 where name like '%業務用%' and general_price <> 0;

update public.products set name = '【会員限定】' || name
 where name like '%若よもぎ蒸し%' and name not like '【会員限定】%';

update public.products set description = replace(description, 'すいません。', '')
 where description like '%すいません。%';

commit;

-- Check the result (should list the changed rows):
select name, general_price, active, left(description, 40) as description
from public.products
where name like '%業務用%' or name like '%若よもぎ蒸し%' or name like '%洗濯洗剤%'
order by sort_order;
