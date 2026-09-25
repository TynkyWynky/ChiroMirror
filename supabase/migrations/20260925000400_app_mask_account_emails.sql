-- Account selectors only need a stable identity and a masked email.
-- Full Auth email addresses never go to the APP account directory.
begin;

drop function public.list_app_accounts();

create function public.list_app_accounts()
returns table(user_id uuid, email_masked text, full_name text, member_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.has_app_access() or not (
    public.has_app_permission('members.manage') or public.has_app_permission('roles.manage')
  ) then raise exception 'APP account directory forbidden' using errcode = '42501'; end if;
  return query
    select u.id,
      case
        when position('@' in coalesce(u.email, '')) > 1 then
          left(split_part(u.email, '@', 1), 2) || '***@' || split_part(u.email, '@', 2)
        else 'verborgen'
      end,
      p.full_name,
      m.id
    from auth.users u
    left join public.profiles p on p.user_id = u.id
    left join public.members m on m.user_id = u.id
    order by coalesce(p.full_name, ''), u.id;
end;
$$;

revoke all on function public.list_app_accounts() from public, anon;
grant execute on function public.list_app_accounts() to authenticated;

commit;
