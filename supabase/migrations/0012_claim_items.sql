-- Part 12: what each claim bought, line by line, for reports by category.
--
-- While the AI receipt check is on, Claude reads a claim's receipts as the claimant attaches them
-- (precheckClaim) and lists each item bought: what it is, its amount as printed, and the spend
-- category it belongs to. The list goes in with the claim (claims.items) and, like the rest of the
-- claim, never changes after (claims has no update grant). Reports share a claim's amount across its
-- items in proportion to their amounts, so taxes and service charges, which the list leaves out, are
-- shared the same way; a claim without items counts whole under its own category
-- (src/lib/claim-items.ts).
--
-- The claimant sends it with the claim, so like everything else they enter it is checked against
-- the receipts, not trusted. A trigger keeps only well-formed items: a description, a whole number of
-- cents or none, and a category that exists or none.

alter table public.claims add column items jsonb;
grant select (items), insert (items) on public.claims to authenticated;

create function private.claims_items_before_insert() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_item jsonb;
  v_items jsonb := '[]';
  v_description text;
  v_amount jsonb;
  v_cents numeric;
  v_category uuid;
begin
  if new.items is null then
    return new;
  end if;
  if jsonb_typeof(new.items) <> 'array' or jsonb_array_length(new.items) not between 1 and 100 then
    raise exception 'A claim lists 1 to 100 items, or none.';
  end if;
  for v_item in select value from jsonb_array_elements(new.items) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Each item needs a description of up to 200 characters.';
    end if;
    v_description := btrim(v_item ->> 'description');
    if v_description is null or length(v_description) not between 1 and 200 then
      raise exception 'Each item needs a description of up to 200 characters.';
    end if;
    v_amount := coalesce(v_item -> 'amount_cents', 'null');
    if jsonb_typeof(v_amount) not in ('number', 'null') then
      raise exception 'An item''s amount is a whole number of cents, or none.';
    end if;
    if jsonb_typeof(v_amount) = 'number' then
      v_cents := v_amount::numeric;
      if v_cents <> trunc(v_cents) or abs(v_cents) > 100000000 then
        raise exception 'An item''s amount is a whole number of cents, or none.';
      end if;
    end if;
    v_category := null;
    if jsonb_typeof(v_item -> 'category_id') = 'string' then
      select c.id into v_category from public.categories c where c.id::text = v_item ->> 'category_id';
    end if;
    v_items := v_items || jsonb_build_array(jsonb_build_object(
      'description', v_description, 'amount_cents', v_amount, 'category_id', v_category));
  end loop;
  new.items := v_items;
  return new;
end $$;
revoke all on function private.claims_items_before_insert() from public, authenticated;

create trigger claims_items_before_insert before insert on public.claims
  for each row execute function private.claims_items_before_insert();
