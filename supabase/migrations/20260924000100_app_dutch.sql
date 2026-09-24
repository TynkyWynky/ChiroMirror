-- Dutch labels and system notifications. Safe to run after the APP installation.
-- Existing permissions, private content and notification history are preserved.
begin;

update public.event_categories c set label = v.label
from (values ('ACTIVITY','Activiteit'),('MEETING','Vergadering'),('EVENT','Evenement'),
 ('WEEKEND','Weekend'),('CAMP','Kamp'),('DEADLINE','Deadline'),('OTHER','Overig')) as v(key,label)
where c.key=v.key;

create or replace function public.claim_notification_deliveries(batch_size integer default 10) returns jsonb language plpgsql security definer set search_path='' as $$
declare d public.notification_deliveries; j public.notification_jobs; s public.push_subscriptions; n public.notifications; result jsonb:='[]'; details boolean;
begin
 for d in select * from public.notification_deliveries where
  (status='PENDING' and next_attempt_at<=now()) or (status='PROCESSING' and claimed_at<now()-interval '90 seconds')
  order by next_attempt_at,id for update skip locked limit least(greatest(batch_size,1),20) loop
  select * into j from public.notification_jobs where id=d.job_id;
  select * into s from public.push_subscriptions where id=d.subscription_id;
  if not public.notification_job_allowed(j) or not coalesce(s.active,false) or s.user_id is distinct from j.user_id
   or not exists(select 1 from public.notification_preferences p where p.user_id=j.user_id and p.push_enabled) then
   update public.notification_deliveries set status='CANCELLED',claim_token=null where id=d.id; continue;
  end if;
  if d.attempts>=4 then update public.notification_deliveries set status='FAILED',last_error_code='RETRY_LIMIT',claim_token=null where id=d.id; continue; end if;
  select * into n from public.notifications where job_id=j.id;
  select push_details into details from public.notification_preferences where user_id=j.user_id;
  update public.notification_deliveries set status='PROCESSING',attempts=attempts+1,claimed_at=now(),claim_token=gen_random_uuid() where id=d.id returning * into d;
  result:=result||jsonb_build_array(jsonb_build_object('id',d.id,'token',d.claim_token,'subscription_id',s.id,
   'subscription',jsonb_build_object('endpoint',s.endpoint,'keys',jsonb_build_object('p256dh',s.p256dh,'auth',s.auth)),
   'payload',jsonb_build_object('notificationId',n.id,'deliveryId',d.id,'title',case when details then n.title else 'Chiro Negenmanneke' end,
   'body',case when details then n.body else 'Er staat een herinnering voor je klaar in de app.' end)));
 end loop;
 return result;
end $$;

create or replace function public.enqueue_my_notification_test(subscription_id uuid) returns uuid language plpgsql security definer set search_path='' as $$
declare saved uuid;
begin
 if not public.has_app_access() or not exists(select 1 from public.push_subscriptions s where s.id=subscription_id and s.user_id=auth.uid() and s.active)
  or not exists(select 1 from public.notification_preferences p where p.user_id=auth.uid() and p.push_enabled) then raise exception 'Notification permission denied' using errcode='42501'; end if;
 -- Serialize per user and rate-limit tests to one per minute.
 perform 1 from public.notification_preferences where user_id=auth.uid() for update;
 if exists(select 1 from public.notification_jobs where user_id=auth.uid() and source_type='SYSTEM' and created_at>now()-interval '1 minute') then raise exception 'Wait one minute before testing again' using errcode='22023'; end if;
 insert into public.notification_jobs(user_id,source_type,source_id,reminder_id,source_revision,due_at,expires_at,title,body,test_subscription_id)
 values(auth.uid(),'SYSTEM',auth.uid(),'00000000-0000-0000-0000-000000000000',0,now(),now()+interval '10 minutes','Testmelding','Chiro-meldingen zijn klaar voor gebruik.',subscription_id) returning id into saved;
 return saved;
end $$;

-- Keep delivery claims server-only and test notifications limited to signed-in users.
revoke all on function public.claim_notification_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_deliveries(integer) to service_role;
revoke all on function public.enqueue_my_notification_test(uuid) from public, anon;
grant execute on function public.enqueue_my_notification_test(uuid) to authenticated;

commit;
