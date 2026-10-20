-- Part 7: only Finance members have claims against the reserve, imported ones included.
--
-- claims_check_reserve (0006) asked whether the caller is Finance. An import is made by Finance on
-- someone else's behalf, so it let Finance import a volunteer's or lead's claim against the reserve,
-- whose budget they then can't see. The rule now asks about the claimant. For a submitted claim the
-- two are the same person: claims_before_insert has already set claimant_id to the caller, and
-- refused an inactive one.

create or replace function private.claims_check_reserve() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.budgets b where b.id = new.budget_id and b.is_reserve)
     and not exists (select 1 from public.members m where m.id = new.claimant_id and m.role = 'finance') then
    if new.imported then
      raise exception 'Only Finance members can have claims against the reserve, and % isn''t one.', new.claimant_name
        using errcode = '42501';
    end if;
    raise exception 'Only Finance can claim against the reserve.' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function private.claims_check_reserve() from public, authenticated;
