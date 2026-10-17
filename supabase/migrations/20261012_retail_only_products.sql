-- Apply once. Lets a product be sold to retail customers only (e.g. ReOS):
-- wholesale_enabled = false hides it from the wholesale (salon) screens and
-- rejects it in any new wholesale order. The public shop is unaffected (it
-- shows any active product with a general price). Existing products stay
-- wholesale-enabled; no orders are moved or deleted.
begin;

alter table public.products
 add column if not exists wholesale_enabled boolean not null default true;

-- Wholesale orders are created only via place_order / admin_place_order, which
-- INSERT into public.orders. Rejecting there (rather than editing both
-- functions) keeps the existing, tested function bodies untouched; the raised
-- exception rolls back the whole call, including its stock decrement.
-- Insert-only on purpose: editing an old order that predates a product being
-- switched to retail-only should still work.
create or replace function public.reject_retail_only_items()
returns trigger language plpgsql security definer set search_path = public as $$
begin
 if exists (
  select 1 from jsonb_array_elements(new.items) i
  join public.products p on p.id = (i->>'productId')::uuid
  where not p.wholesale_enabled
 ) then raise exception 'NOT_FOR_WHOLESALE'; end if;
 return new;
end;
$$;

drop trigger if exists trg_reject_retail_only_items on public.orders;
create trigger trg_reject_retail_only_items
 before insert on public.orders
 for each row execute function public.reject_retail_only_items();

commit;
