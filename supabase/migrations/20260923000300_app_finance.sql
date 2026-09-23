-- APP Comptes: independent of SITE finance_transactions. EUR, exact integer cents.
begin;
insert into public.app_permissions(key,description) values
 ('finance.access','Consulter ses comptes'),('finance.treasury.read','Lire la trésorerie'),('finance.treasury.manage','Gérer la trésorerie');
insert into public.app_role_permissions(role_key,permission_key)
 select key,'finance.access' from public.app_roles where key in ('APP_ADMIN','RESPONSIBLE','TREASURER','MEMBER');
-- Technical administration grants no treasury or private financial super-reader rights.
insert into public.app_role_permissions(role_key,permission_key) values
 ('TREASURER','finance.treasury.read'),('TREASURER','finance.treasury.manage');

create table public.app_financial_entities (
 id uuid primary key default gen_random_uuid(),
 type text not null check(type in ('MEMBER','CHIRO')),
 member_id uuid unique references public.members(id) on delete restrict,
 check((type='MEMBER' and member_id is not null) or (type='CHIRO' and member_id is null))
);
create unique index app_financial_single_chiro on public.app_financial_entities(type) where type='CHIRO';
insert into public.app_financial_entities(type) values('CHIRO');
insert into public.app_financial_entities(type,member_id) select 'MEMBER',id from public.members;
create function public.app_finance_member_entity() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.app_financial_entities(type,member_id) values('MEMBER',new.id); return new; end $$;
create trigger app_finance_member_entity after insert on public.members for each row execute function public.app_finance_member_entity();

create table public.app_finance_transactions (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('EXPENSE','DIRECT_DEBT')),
 title text not null check(title=btrim(title) and title ~ '[^[:space:]]' and char_length(title)<=200),
 description text check(char_length(description)<=10000),
 amount_cents bigint not null check(amount_cents between 1 and 999999999999),
 currency text not null default 'EUR' check(currency='EUR'),
 paid_by_entity_id uuid references public.app_financial_entities(id) on delete restrict,
 debtor_entity_id uuid references public.app_financial_entities(id) on delete restrict,
 creditor_entity_id uuid references public.app_financial_entities(id) on delete restrict,
 split_mode text check(split_mode in ('EQUAL','CUSTOM_AMOUNT')),
 expense_date date not null check(expense_date between date '2000-01-01' and date '2100-12-31'),
 visibility text not null check(visibility in ('PRIVATE','TREASURY')),
 status text not null default 'ACTIVE' check(status in ('ACTIVE','CANCELLED')),
 created_by uuid references auth.users(id) on delete set null,
 updated_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 revision bigint not null default 1 check(revision>0),
 check((kind='EXPENSE' and paid_by_entity_id is not null and split_mode is not null and debtor_entity_id is null and creditor_entity_id is null)
  or (kind='DIRECT_DEBT' and paid_by_entity_id is null and split_mode is null and debtor_entity_id is not null and creditor_entity_id is not null and debtor_entity_id<>creditor_entity_id))
);
create index app_finance_transactions_date on public.app_finance_transactions(expense_date,id);
create index app_finance_transactions_visibility on public.app_finance_transactions(visibility,status);
create table public.app_expense_shares (
 transaction_id uuid not null references public.app_finance_transactions(id) on delete restrict,
 entity_id uuid not null references public.app_financial_entities(id) on delete restrict,
 amount_cents bigint not null check(amount_cents between 0 and 999999999999),
 primary key(transaction_id,entity_id)
);
create index app_expense_shares_entity on public.app_expense_shares(entity_id,transaction_id);
create table public.app_finance_obligations (
 id uuid primary key default gen_random_uuid(),
 transaction_id uuid not null references public.app_finance_transactions(id) on delete restrict,
 debtor_entity_id uuid not null references public.app_financial_entities(id) on delete restrict,
 creditor_entity_id uuid not null references public.app_financial_entities(id) on delete restrict,
 original_amount_cents bigint not null check(original_amount_cents between 1 and 999999999999),
 check(debtor_entity_id<>creditor_entity_id),
 unique(transaction_id,debtor_entity_id,creditor_entity_id)
);
create index app_finance_obligations_debtor on public.app_finance_obligations(debtor_entity_id,transaction_id);
create index app_finance_obligations_creditor on public.app_finance_obligations(creditor_entity_id,transaction_id);
create table public.app_finance_payments (
 id uuid primary key default gen_random_uuid(),
 transaction_id uuid not null references public.app_finance_transactions(id) on delete restrict,
 from_entity_id uuid not null references public.app_financial_entities(id) on delete restrict,
 to_entity_id uuid not null references public.app_financial_entities(id) on delete restrict,
 amount_cents bigint not null check(amount_cents between 1 and 999999999999),
 payment_date date not null check(payment_date between date '2000-01-01' and date '2100-12-31'),
 comment text check(char_length(comment)<=2000),
 status text not null default 'ACTIVE' check(status in ('ACTIVE','CANCELLED')),
 created_by uuid references auth.users(id) on delete set null,
 created_at timestamptz not null default clock_timestamp(),
 cancelled_by uuid references auth.users(id) on delete set null,
 cancelled_at timestamptz, cancellation_reason text,
 check(from_entity_id<>to_entity_id)
);
create index app_finance_payments_transaction on public.app_finance_payments(transaction_id);
-- V1: one obligation per payment RPC. Separate allocations allow future multi-debt payments.
create table public.app_payment_allocations (
 payment_id uuid not null references public.app_finance_payments(id) on delete restrict,
 obligation_id uuid not null references public.app_finance_obligations(id) on delete restrict,
 amount_cents bigint not null check(amount_cents between 1 and 999999999999),
 primary key(payment_id,obligation_id)
);
create index app_payment_allocations_obligation on public.app_payment_allocations(obligation_id,payment_id);
create table public.app_finance_activity (
 id uuid primary key default gen_random_uuid(),
 transaction_id uuid not null references public.app_finance_transactions(id) on delete restrict,
 actor_id uuid references auth.users(id) on delete set null,
 action text not null check(action in ('EXPENSE_CREATED','DIRECT_DEBT_CREATED','TRANSACTION_UPDATED','TRANSACTION_CANCELLED','PAYMENT_RECORDED','PAYMENT_CANCELLED')),
 metadata jsonb not null default '{}' check(jsonb_typeof(metadata)='object'),
 created_at timestamptz not null default clock_timestamp()
);
create index app_finance_activity_transaction on public.app_finance_activity(transaction_id,created_at,id);

create function public.app_finance_access() returns boolean language sql stable security definer set search_path='' as $$
 select public.has_app_access() and public.has_app_permission('finance.access');
$$;
create function public.app_finance_own_entity() returns uuid language sql stable security definer set search_path='' as $$
 select e.id from public.app_financial_entities e join public.members m on m.id=e.member_id where m.user_id=auth.uid();
$$;
create function public.can_read_app_finance(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.app_finance_access() and exists(select 1 from public.app_finance_transactions t where t.id=target and (
  public.app_finance_own_entity() in (t.paid_by_entity_id,t.debtor_entity_id,t.creditor_entity_id)
  or exists(select 1 from public.app_expense_shares s where s.transaction_id=t.id and s.entity_id=public.app_finance_own_entity())
  or (t.visibility='TREASURY' and (public.has_app_permission('finance.treasury.read') or public.has_app_permission('finance.treasury.manage')))
 ));
$$;
create function public.can_manage_app_finance(target uuid) returns boolean language sql stable security definer set search_path='' as $$
 select public.can_read_app_finance(target) and exists(select 1 from public.app_finance_transactions t where t.id=target and (
  (t.visibility='PRIVATE' and t.created_by=auth.uid())
  or (t.visibility='TREASURY' and public.has_app_permission('finance.treasury.manage'))
 ));
$$;

alter table public.app_financial_entities enable row level security;
alter table public.app_finance_transactions enable row level security;
alter table public.app_expense_shares enable row level security;
alter table public.app_finance_obligations enable row level security;
alter table public.app_finance_payments enable row level security;
alter table public.app_payment_allocations enable row level security;
alter table public.app_finance_activity enable row level security;
revoke all on public.app_financial_entities,public.app_finance_transactions,public.app_expense_shares,public.app_finance_obligations,
 public.app_finance_payments,public.app_payment_allocations,public.app_finance_activity from public,anon,authenticated;
grant select on public.app_financial_entities,public.app_finance_transactions,public.app_expense_shares,public.app_finance_obligations,
 public.app_finance_payments,public.app_payment_allocations,public.app_finance_activity to authenticated;
create policy app_financial_entities_read on public.app_financial_entities for select to authenticated using(public.app_finance_access());
create policy app_finance_transactions_read on public.app_finance_transactions for select to authenticated using(public.can_read_app_finance(id));
create policy app_expense_shares_read on public.app_expense_shares for select to authenticated using(public.can_read_app_finance(transaction_id));
create policy app_finance_obligations_read on public.app_finance_obligations for select to authenticated using(public.can_read_app_finance(transaction_id));
create policy app_finance_payments_read on public.app_finance_payments for select to authenticated using(public.can_read_app_finance(transaction_id));
create policy app_payment_allocations_read on public.app_payment_allocations for select to authenticated using(exists(
 select 1 from public.app_finance_payments p where p.id=payment_id and public.can_read_app_finance(p.transaction_id)));
create policy app_finance_activity_read on public.app_finance_activity for select to authenticated using(public.can_read_app_finance(transaction_id));

create function public.save_app_finance(target_id uuid, expected_revision bigint, details jsonb, shares jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare candidate public.app_finance_transactions; previous public.app_finance_transactions; saved public.app_finance_transactions;
 own_entity uuid:=public.app_finance_own_entity(); entities uuid[]; count_shares bigint; chiro_involved boolean;
begin
 if not public.app_finance_access() then raise exception 'Finance permission denied' using errcode='42501'; end if;
 if jsonb_typeof(details) is distinct from 'object' or jsonb_typeof(shares) is distinct from 'array' then raise exception 'Invalid finance input' using errcode='22023'; end if;
 -- Check the original text before bigint coercion (JSON fractional numbers must never round).
 if coalesce(details->>'amount_cents','') !~ '^[0-9]{1,12}$' then raise exception 'Invalid integer cents' using errcode='22023'; end if;
 candidate:=jsonb_populate_record(null::public.app_finance_transactions,details);
 if target_id is not null then
  if not public.can_manage_app_finance(target_id) then raise exception 'Finance permission denied' using errcode='42501'; end if;
  select * into previous from public.app_finance_transactions where id=target_id for update;
  if not public.can_manage_app_finance(target_id) then raise exception 'Finance permission denied' using errcode='42501'; end if;
  if previous.revision is distinct from expected_revision then raise exception 'Finance changed; reload' using errcode='40001'; end if;
  if previous.status<>'ACTIVE' or exists(select 1 from public.app_finance_payments where transaction_id=target_id) then
   raise exception 'Payments exist or transaction cancelled; cancel and replace explicitly' using errcode='55000'; end if;
  if candidate.kind is distinct from previous.kind or candidate.visibility is distinct from previous.visibility then
   raise exception 'Kind and visibility are immutable' using errcode='22023'; end if;
 end if;
 count_shares:=jsonb_array_length(shares);
 if count_shares>5000 or exists(select 1 from jsonb_array_elements(shares) s where jsonb_typeof(s) is distinct from 'object') then raise exception 'Invalid shares' using errcode='22023'; end if;
 if candidate.kind='EXPENSE' then
  if count_shares=0 or candidate.split_mode is null or candidate.split_mode not in ('EQUAL','CUSTOM_AMOUNT') then raise exception 'Invalid split' using errcode='22023'; end if;
  if exists(select 1 from jsonb_to_recordset(shares) as s(entity_id uuid) where s.entity_id is null)
   or count_shares<>(select count(distinct s.entity_id) from jsonb_to_recordset(shares) as s(entity_id uuid)) then raise exception 'Duplicate or missing entity' using errcode='22023'; end if;
  if candidate.split_mode='CUSTOM_AMOUNT' then
   if exists(select 1 from jsonb_array_elements(shares) s where coalesce(s->>'amount_cents','') !~ '^[0-9]{1,12}$') then raise exception 'Invalid share cents' using errcode='22023'; end if;
   if (select sum(s.amount_cents) from jsonb_to_recordset(shares) as s(amount_cents bigint))<>candidate.amount_cents then raise exception 'Shares must equal total' using errcode='22023'; end if;
  end if;
  select array_agg(s.entity_id) || array[candidate.paid_by_entity_id] into entities from jsonb_to_recordset(shares) as s(entity_id uuid);
 elsif candidate.kind='DIRECT_DEBT' then
  if count_shares<>0 then raise exception 'Direct debt cannot have shares' using errcode='22023'; end if;
  entities:=array[candidate.debtor_entity_id,candidate.creditor_entity_id];
 else raise exception 'Invalid kind' using errcode='22023'; end if;
 if exists(select 1 from unnest(entities) x left join public.app_financial_entities e on e.id=x left join public.members m on m.id=e.member_id
  where e.id is null or (e.type='MEMBER' and not m.active and not (target_id is not null and
   (coalesce(e.id in (previous.paid_by_entity_id,previous.debtor_entity_id,previous.creditor_entity_id),false)
     or exists(select 1 from public.app_expense_shares s where s.transaction_id=target_id and s.entity_id=e.id))))) then
  raise exception 'Entity missing or archived' using errcode='22023'; end if;
 select exists(select 1 from public.app_financial_entities e where e.id=any(entities) and e.type='CHIRO') into chiro_involved;
 if candidate.visibility='PRIVATE' then
  if chiro_involved or own_entity is null or (candidate.kind='EXPENSE' and candidate.paid_by_entity_id<>own_entity)
   or (candidate.kind='DIRECT_DEBT' and not (own_entity=any(entities))) then raise exception 'Private finance permission denied' using errcode='42501'; end if;
 elsif candidate.visibility='TREASURY' then
  if not chiro_involved or not public.has_app_permission('finance.treasury.manage') then raise exception 'Treasury permission denied' using errcode='42501'; end if;
 else raise exception 'Invalid visibility' using errcode='22023'; end if;
 if target_id is null then
  insert into public.app_finance_transactions(kind,title,description,amount_cents,paid_by_entity_id,debtor_entity_id,creditor_entity_id,split_mode,expense_date,visibility,created_by,updated_by)
  values(candidate.kind,candidate.title,candidate.description,candidate.amount_cents,candidate.paid_by_entity_id,candidate.debtor_entity_id,candidate.creditor_entity_id,candidate.split_mode,candidate.expense_date,candidate.visibility,auth.uid(),auth.uid()) returning * into saved;
 else
  update public.app_finance_transactions set title=candidate.title,description=candidate.description,amount_cents=candidate.amount_cents,
   paid_by_entity_id=candidate.paid_by_entity_id,debtor_entity_id=candidate.debtor_entity_id,creditor_entity_id=candidate.creditor_entity_id,
   split_mode=candidate.split_mode,expense_date=candidate.expense_date,updated_by=auth.uid(),updated_at=clock_timestamp(),revision=revision+1
   where id=target_id returning * into saved;
  -- No payment (even cancelled) exists. Record the former distribution before replacement.
  insert into public.app_finance_activity(transaction_id,actor_id,action,metadata) values(saved.id,auth.uid(),'TRANSACTION_UPDATED',
   jsonb_build_object('before_amount_cents',previous.amount_cents::text,'after_amount_cents',saved.amount_cents::text,
    'before_payer',previous.paid_by_entity_id,'before_debtor',previous.debtor_entity_id,'before_creditor',previous.creditor_entity_id,
    'before_shares',coalesce((select jsonb_agg(jsonb_build_object('entity_id',s.entity_id,'amount_cents',s.amount_cents::text)) from public.app_expense_shares s where s.transaction_id=target_id),'[]'::jsonb)));
  delete from public.app_finance_obligations where transaction_id=target_id;
  delete from public.app_expense_shares where transaction_id=target_id;
 end if;
 if saved.kind='EXPENSE' then
  insert into public.app_expense_shares(transaction_id,entity_id,amount_cents)
   select saved.id,s.entity_id,case when saved.split_mode='CUSTOM_AMOUNT' then s.amount_cents
    else saved.amount_cents/count_shares + case when row_number() over(order by s.entity_id)<=saved.amount_cents%count_shares then 1 else 0 end end
   from jsonb_to_recordset(shares) as s(entity_id uuid,amount_cents bigint);
  insert into public.app_finance_obligations(transaction_id,debtor_entity_id,creditor_entity_id,original_amount_cents)
   select saved.id,s.entity_id,saved.paid_by_entity_id,s.amount_cents from public.app_expense_shares s
   where s.transaction_id=saved.id and s.entity_id<>saved.paid_by_entity_id and s.amount_cents>0;
 else
  insert into public.app_finance_obligations(transaction_id,debtor_entity_id,creditor_entity_id,original_amount_cents)
   values(saved.id,saved.debtor_entity_id,saved.creditor_entity_id,saved.amount_cents);
 end if;
 if target_id is null then insert into public.app_finance_activity(transaction_id,actor_id,action) values(saved.id,auth.uid(),
  case when saved.kind='EXPENSE' then 'EXPENSE_CREATED' else 'DIRECT_DEBT_CREATED' end); end if;
 return saved.id;
end $$;

create function public.record_app_finance_payment(obligation_id uuid, expected_revision bigint, details jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare obligation public.app_finance_obligations; parent public.app_finance_transactions; payment public.app_finance_payments;
 remaining bigint; own_entity uuid:=public.app_finance_own_entity();
begin
 select * into obligation from public.app_finance_obligations o where o.id=obligation_id;
 if not found or not public.can_read_app_finance(obligation.transaction_id) then raise exception 'Finance permission denied' using errcode='42501'; end if;
 -- Same lock order for all mutations: parent first. Re-read obligation after acquiring the lock.
 select * into parent from public.app_finance_transactions where id=obligation.transaction_id for update;
 select * into obligation from public.app_finance_obligations o where o.id=obligation_id;
 if not found or not public.can_read_app_finance(parent.id) then raise exception 'Finance permission denied' using errcode='42501'; end if;
 if (parent.visibility='TREASURY' and not public.has_app_permission('finance.treasury.manage'))
  or (parent.visibility='PRIVATE' and (own_entity is null or own_entity not in (obligation.debtor_entity_id,obligation.creditor_entity_id))) then raise exception 'Payment permission denied' using errcode='42501'; end if;
 if parent.status<>'ACTIVE' then raise exception 'Transaction cancelled' using errcode='55000'; end if;
 if parent.revision is distinct from expected_revision then raise exception 'Finance changed; reload' using errcode='40001'; end if;
 if jsonb_typeof(details) is distinct from 'object' or coalesce(details->>'amount_cents','') !~ '^[0-9]{1,12}$' then raise exception 'Invalid payment cents' using errcode='22023'; end if;
 payment:=jsonb_populate_record(null::public.app_finance_payments,details);
 select obligation.original_amount_cents-coalesce(sum(a.amount_cents),0) into remaining from public.app_payment_allocations a
  join public.app_finance_payments p on p.id=a.payment_id where a.obligation_id=obligation.id and p.status='ACTIVE';
 if payment.amount_cents>remaining then raise exception 'Payment exceeds remaining balance' using errcode='22003',detail=remaining::text; end if;
 insert into public.app_finance_payments(transaction_id,from_entity_id,to_entity_id,amount_cents,payment_date,comment,created_by)
  values(parent.id,obligation.debtor_entity_id,obligation.creditor_entity_id,payment.amount_cents,payment.payment_date,payment.comment,auth.uid()) returning * into payment;
 insert into public.app_payment_allocations(payment_id,obligation_id,amount_cents) values(payment.id,obligation.id,payment.amount_cents);
 update public.app_finance_transactions set revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=parent.id;
 insert into public.app_finance_activity(transaction_id,actor_id,action,metadata) values(parent.id,auth.uid(),'PAYMENT_RECORDED',
  jsonb_build_object('payment_id',payment.id,'obligation_id',obligation.id,'amount_cents',payment.amount_cents::text));
 return payment.id;
end $$;

create function public.cancel_app_finance_payment(target_id uuid, expected_revision bigint, reason text)
returns void language plpgsql security definer set search_path='' as $$
declare payment public.app_finance_payments; parent public.app_finance_transactions; own_entity uuid:=public.app_finance_own_entity();
begin
 select * into payment from public.app_finance_payments where id=target_id;
 if not found or not public.can_read_app_finance(payment.transaction_id) then raise exception 'Finance permission denied' using errcode='42501'; end if;
 select * into parent from public.app_finance_transactions where id=payment.transaction_id for update;
 select * into payment from public.app_finance_payments where id=target_id;
 if not public.can_read_app_finance(parent.id) or (parent.visibility='TREASURY' and not public.has_app_permission('finance.treasury.manage'))
  or (parent.visibility='PRIVATE' and (own_entity is null or own_entity not in (payment.from_entity_id,payment.to_entity_id))) then raise exception 'Payment permission denied' using errcode='42501'; end if;
 if parent.revision is distinct from expected_revision then raise exception 'Finance changed; reload' using errcode='40001'; end if;
 if payment.status<>'ACTIVE' or parent.status<>'ACTIVE' then raise exception 'Already cancelled' using errcode='55000'; end if;
 if reason is null or btrim(reason) !~ '[^[:space:]]' or char_length(reason)>2000 then raise exception 'Cancellation reason required' using errcode='22023'; end if;
 update public.app_finance_payments set status='CANCELLED',cancelled_at=clock_timestamp(),cancelled_by=auth.uid(),cancellation_reason=btrim(reason) where id=target_id;
 update public.app_finance_transactions set revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=parent.id;
 insert into public.app_finance_activity(transaction_id,actor_id,action,metadata) values(parent.id,auth.uid(),'PAYMENT_CANCELLED',jsonb_build_object('payment_id',payment.id,'reason',btrim(reason)));
end $$;

create function public.cancel_app_finance_transaction(target_id uuid, expected_revision bigint, reason text)
returns void language plpgsql security definer set search_path='' as $$
declare parent public.app_finance_transactions;
begin
 if not public.can_manage_app_finance(target_id) then raise exception 'Finance permission denied' using errcode='42501'; end if;
 select * into parent from public.app_finance_transactions where id=target_id for update;
 if not public.can_manage_app_finance(target_id) then raise exception 'Finance permission denied' using errcode='42501'; end if;
 if parent.revision is distinct from expected_revision then raise exception 'Finance changed; reload' using errcode='40001'; end if;
 if parent.status<>'ACTIVE' or exists(select 1 from public.app_finance_payments where transaction_id=target_id and status='ACTIVE') then
  raise exception 'Active payments exist or transaction already cancelled' using errcode='55000'; end if;
 if reason is null or btrim(reason) !~ '[^[:space:]]' or char_length(reason)>2000 then raise exception 'Cancellation reason required' using errcode='22023'; end if;
 update public.app_finance_transactions set status='CANCELLED',revision=revision+1,updated_by=auth.uid(),updated_at=clock_timestamp() where id=target_id;
 insert into public.app_finance_activity(transaction_id,actor_id,action,metadata) values(target_id,auth.uid(),'TRANSACTION_CANCELLED',jsonb_build_object('reason',btrim(reason)));
end $$;

-- One statement, one MVCC snapshot: balances never combine pre-payment and post-payment rows.
-- SECURITY INVOKER deliberately retains every underlying RLS policy.
create function public.get_app_finance_snapshot() returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object(
  'entities',coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.app_financial_entities e),'[]'::jsonb),
  'members',coalesce((select jsonb_agg(to_jsonb(m) order by m.last_name,m.id) from public.members m),'[]'::jsonb),
  'transactions',coalesce((select jsonb_agg(to_jsonb(t) order by t.expense_date desc,t.id) from public.app_finance_transactions t),'[]'::jsonb),
  'shares',coalesce((select jsonb_agg(to_jsonb(s)) from public.app_expense_shares s),'[]'::jsonb),
  'obligations',coalesce((select jsonb_agg(to_jsonb(o)) from public.app_finance_obligations o),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg(to_jsonb(p) order by p.payment_date desc,p.id) from public.app_finance_payments p),'[]'::jsonb),
  'allocations',coalesce((select jsonb_agg(to_jsonb(a)) from public.app_payment_allocations a),'[]'::jsonb)
 ) where public.app_finance_access();
$$;
revoke all on function public.get_app_finance_snapshot() from public,anon,authenticated;
grant execute on function public.get_app_finance_snapshot() to authenticated;

revoke all on function public.app_finance_member_entity(),public.app_finance_access(),public.app_finance_own_entity(),
 public.can_read_app_finance(uuid),public.can_manage_app_finance(uuid),public.save_app_finance(uuid,bigint,jsonb,jsonb),
 public.record_app_finance_payment(uuid,bigint,jsonb),public.cancel_app_finance_payment(uuid,bigint,text),public.cancel_app_finance_transaction(uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.app_finance_access(),public.can_read_app_finance(uuid),public.can_manage_app_finance(uuid),
 public.save_app_finance(uuid,bigint,jsonb,jsonb),public.record_app_finance_payment(uuid,bigint,jsonb),
 public.cancel_app_finance_payment(uuid,bigint,text),public.cancel_app_finance_transaction(uuid,bigint,text) to authenticated;
commit;
