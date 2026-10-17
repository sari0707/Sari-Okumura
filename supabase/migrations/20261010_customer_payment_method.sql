-- Apply once AFTER 20261004_customer_orders.sql.
-- Lets a retail customer choose how to pay: 'card' (operator emails a Square
-- payment link, the original flow) or 'bank_transfer' (operator emails the
-- transfer details). Existing customer_orders rows keep the original flow
-- ('card'). No orders are moved or deleted.
begin;

alter table public.customer_orders
 add column payment_method text not null default 'card'
 check (payment_method in ('card','bank_transfer'));

-- The function gains a parameter, so the 4-argument version is replaced.
drop function if exists public.place_customer_order(uuid,jsonb,jsonb,numeric);

create or replace function public.place_customer_order(p_request_id uuid,p_customer jsonb,p_items jsonb,p_expected_subtotal numeric,p_payment_method text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
 v_order public.customer_orders; v_item jsonb; v_product public.products;
 v_qty int; v_items jsonb := '[]'::jsonb; v_subtotal numeric := 0;
 v_name text; v_email text; v_phone text; v_zip text; v_address text; v_notes text;
begin
 if p_request_id is null then raise exception 'INVALID_REQUEST'; end if;
 if jsonb_typeof(p_customer) is distinct from 'object' or jsonb_typeof(p_items) is distinct from 'array' then raise exception 'INVALID_REQUEST'; end if;
 if p_payment_method is null or p_payment_method not in ('card','bank_transfer') then raise exception 'INVALID_PAYMENT_METHOD'; end if;
 if jsonb_array_length(p_items) not between 1 and 50 then raise exception 'INVALID_ITEMS'; end if;
 v_name := trim(coalesce(p_customer->>'name','')); v_email := lower(trim(coalesce(p_customer->>'email','')));
 v_phone := trim(coalesce(p_customer->>'phone','')); v_zip := trim(coalesce(p_customer->>'zip',''));
 v_address := trim(coalesce(p_customer->>'address','')); v_notes := trim(coalesce(p_customer->>'notes',''));
 if length(v_name) not between 1 and 100 or length(v_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or v_phone !~ '^[0-9+() -]{8,30}$' or v_zip !~ '^[0-9]{3}-?[0-9]{4}$'
 or length(v_address) not between 5 and 500 or length(v_notes) > 1000 then raise exception 'INVALID_CUSTOMER'; end if;
 if (select count(distinct x->>'productId') from jsonb_array_elements(p_items) x) <> jsonb_array_length(p_items) then raise exception 'INVALID_ITEMS'; end if;
 -- Serialize retries for the same request, without taking global order locks.
 perform pg_advisory_xact_lock(hashtextextended(p_request_id::text,0));
 select * into v_order from public.customer_orders where request_id = p_request_id;
 if found then
  -- An idempotency key must not be reused for another customer/cart/payment method.
  if v_order.customer_name <> v_name or v_order.email <> v_email or v_order.phone <> v_phone
   or v_order.zip <> v_zip or v_order.address <> v_address or v_order.notes <> v_notes
   or v_order.payment_method <> p_payment_method
   or (select jsonb_agg(jsonb_build_object('productId',x->>'productId','qty',(x->>'qty')::int) order by x->>'productId') from jsonb_array_elements(v_order.items) x)
    is distinct from (select jsonb_agg(jsonb_build_object('productId',x->>'productId','qty',(x->>'qty')::int) order by x->>'productId') from jsonb_array_elements(p_items) x)
  then raise exception 'REQUEST_CHANGED'; end if;
  return jsonb_build_object('orderNumber',v_order.order_number,'subtotal',v_order.subtotal,'paymentMethod',v_order.payment_method);
 end if;
 -- Stable lock order avoids deadlocks between overlapping customer carts.
 for v_item in select x from jsonb_array_elements(p_items) x order by x->>'productId' loop
  if jsonb_typeof(v_item) is distinct from 'object' or coalesce(v_item->>'qty','') !~ '^[0-9]{1,2}$' then raise exception 'INVALID_ITEMS'; end if;
  v_qty := (v_item->>'qty')::int;
  if v_qty not between 1 and 99 then raise exception 'INVALID_ITEMS'; end if;
  select * into v_product from public.products where id=(v_item->>'productId')::uuid for update;
  if not found or not v_product.active or v_product.general_price <= 0 or v_product.stock < v_qty then raise exception 'UNAVAILABLE_PRODUCT'; end if;
  v_items := v_items || jsonb_build_array(jsonb_build_object('productId',v_product.id,'name',v_product.name,'unitPrice',v_product.general_price,'qty',v_qty,'subtotal',v_product.general_price*v_qty));
  v_subtotal := v_subtotal + v_product.general_price*v_qty;
  update public.products set stock=stock-v_qty where id=v_product.id;
 end loop;
 if p_expected_subtotal is null or v_subtotal <> p_expected_subtotal then raise exception 'PRICE_CHANGED'; end if;
 insert into public.customer_orders(request_id,order_number,customer_name,email,phone,zip,address,notes,items,subtotal,payment_method)
 values(p_request_id,'C-'||to_char(now() at time zone 'Asia/Tokyo','YYYYMMDD')||'-'||replace(gen_random_uuid()::text,'-',''),v_name,v_email,v_phone,v_zip,v_address,v_notes,v_items,v_subtotal,p_payment_method)
 returning * into v_order;
 return jsonb_build_object('orderNumber',v_order.order_number,'subtotal',v_order.subtotal,'paymentMethod',v_order.payment_method);
end;
$$;
revoke all on function public.place_customer_order(uuid,jsonb,jsonb,numeric,text) from public;
grant execute on function public.place_customer_order(uuid,jsonb,jsonb,numeric,text) to anon,authenticated;

-- Same signature as before. A Square link is only required (and only allowed
-- to be set) for card orders; bank-transfer orders only need a confirmed
-- shipping amount before the transfer details are sent.
create or replace function public.update_customer_order(p_id uuid,p_shipping numeric,p_payment_link text,p_payment_requested boolean,p_payment_status text,p_ship_status text,p_tracking_number text)
returns void language plpgsql security definer set search_path=public as $$
declare v_order public.customer_orders;
begin
 if not public.is_admin() then raise exception 'ADMIN_ONLY'; end if;
 select * into v_order from public.customer_orders where id=p_id for update;
 if not found or v_order.cancelled_at is not null then raise exception 'ORDER_UNAVAILABLE'; end if;
 if p_shipping is not null and (p_shipping < 0 or p_shipping <> trunc(p_shipping) or p_shipping > 100000) then raise exception 'INVALID_SHIPPING'; end if;
 if p_payment_link is null or length(p_payment_link)>2048 or (p_payment_link <> '' and p_payment_link !~ '^https://(square\.link|checkout\.square\.site)/[A-Za-z0-9/_?=&.%+-]+$') then raise exception 'INVALID_PAYMENT_LINK'; end if;
 if v_order.payment_method='bank_transfer' and p_payment_link <> '' then raise exception 'INVALID_PAYMENT_LINK'; end if;
 if p_payment_status not in ('未入金','入金確認済') or p_ship_status not in ('未発送','発送準備中','発送済') or p_payment_requested is null or p_payment_status is null or p_ship_status is null or p_tracking_number is null or length(p_tracking_number)>100 then raise exception 'INVALID_STATUS'; end if;
 if p_payment_requested and (p_shipping is null or (v_order.payment_method='card' and p_payment_link='')) then raise exception 'QUOTE_REQUIRED'; end if;
 if p_payment_status='入金確認済' and p_shipping is null then raise exception 'QUOTE_REQUIRED'; end if;
 if p_ship_status <> '未発送' and p_payment_status <> '入金確認済' then raise exception 'PAYMENT_REQUIRED'; end if;
 if v_order.payment_status='入金確認済' and p_shipping is distinct from v_order.shipping then raise exception 'PAID_QUOTE_LOCKED'; end if;
 update public.customer_orders set shipping=p_shipping,payment_link=p_payment_link,payment_requested=p_payment_requested,payment_status=p_payment_status,ship_status=p_ship_status,tracking_number=p_tracking_number where id=p_id;
end;
$$;
revoke all on function public.update_customer_order(uuid,numeric,text,boolean,text,text,text) from public;
grant execute on function public.update_customer_order(uuid,numeric,text,boolean,text,text,text) to authenticated;

commit;
