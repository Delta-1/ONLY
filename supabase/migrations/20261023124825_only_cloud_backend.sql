-- ONLY data is private and isolated from the other applications in this project.
create schema if not exists only_app;
revoke all on schema only_app from public, anon, authenticated;
grant usage on schema only_app to service_role;

create table only_app.workspaces (
  id uuid primary key,
  code text unique not null,
  body jsonb not null check (jsonb_typeof(body)='object'),
  version bigint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index only_workspaces_links_gin on only_app.workspaces using gin (body jsonb_path_ops);
create table only_app.accounts (
  id uuid primary key,
  business uuid not null references only_app.workspaces(id) on delete cascade,
  email text unique not null check (email=lower(email)),
  name text not null,
  password_hash text not null,
  role text not null check (role in ('owner','cashier')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index only_accounts_business_idx on only_app.accounts(business);
create table only_app.sessions (
  token_hash text primary key,
  account_id uuid not null references only_app.accounts(id) on delete cascade,
  expires timestamptz not null default (now()+interval '7 days'),
  created_at timestamptz not null default now()
);
create index only_sessions_account_idx on only_app.sessions(account_id);
create index only_sessions_expiry_idx on only_app.sessions(expires);
create table only_app.rate_limits (
  key text primary key,
  window_start timestamptz not null default now(),
  attempts integer not null default 1
);
create index only_rate_limits_expiry_idx on only_app.rate_limits(window_start);
alter table only_app.workspaces enable row level security;
alter table only_app.accounts enable row level security;
alter table only_app.sessions enable row level security;
alter table only_app.rate_limits enable row level security;
revoke all on all tables in schema only_app from public, anon, authenticated;
grant select, insert, update, delete on all tables in schema only_app to service_role;

-- The browser cannot call this gateway: EXECUTE is granted only to service_role.
-- It is SECURITY INVOKER, with no search_path or definer privilege escalation.
create function public.only_gateway(p_op text,p_data jsonb default '{}'::jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  result jsonb;
  changed bigint;
  n integer;
  row_workspace only_app.workspaces%rowtype;
  actor only_app.accounts%rowtype;
begin
  if current_user not in ('service_role','postgres','supabase_admin') then
    raise exception 'forbidden' using errcode='42501';
  end if;
  case p_op
  when 'health' then
    return jsonb_build_object('ok',true);
  when 'rate_limit' then
    delete from only_app.rate_limits where window_start < now()-interval '1 day';
    insert into only_app.rate_limits as r(key,window_start,attempts)
    values(p_data->>'key',now(),1)
    on conflict(key) do update set
      attempts=case when r.window_start < now()-interval '10 minutes' then 1 else r.attempts+1 end,
      window_start=case when r.window_start < now()-interval '10 minutes' then now() else r.window_start end
    returning attempts into n;
    return jsonb_build_object('allowed',n <= (p_data->>'maximum')::integer);
  when 'account_email' then
    select to_jsonb(a) into result from only_app.accounts a where a.email=lower(p_data->>'email') and a.active;
    return result;
  when 'account_session' then
    select to_jsonb(a)-'password_hash' into result from only_app.sessions s
    join only_app.accounts a on a.id=s.account_id
    where s.token_hash=p_data->>'hash' and s.expires>now() and a.active;
    return result;
  when 'create_company' then
    insert into only_app.workspaces(id,code,body)
    values((p_data->>'business')::uuid,p_data->>'code',p_data->'state');
    insert into only_app.accounts(id,business,email,name,password_hash,role)
    values((p_data->>'id')::uuid,(p_data->>'business')::uuid,lower(p_data->>'email'),p_data->>'name',p_data->>'password_hash','owner')
    returning to_jsonb(accounts)-'password_hash' into result;
    insert into only_app.sessions(token_hash,account_id) values(p_data->>'session_hash',(p_data->>'id')::uuid);
    return result;
  when 'new_session' then
    delete from only_app.sessions where expires<now();
    insert into only_app.sessions(token_hash,account_id) values(p_data->>'hash',(p_data->>'id')::uuid);
    return jsonb_build_object('ok',true);
  when 'logout' then
    delete from only_app.sessions where token_hash=p_data->>'hash';
    return jsonb_build_object('ok',true);
  when 'read_workspace' then
    if p_data ? 'id' then
      select * into row_workspace from only_app.workspaces w where w.id=(p_data->>'id')::uuid;
    elsif p_data ? 'code' then
      select * into row_workspace from only_app.workspaces w where w.code=upper(p_data->>'code');
    else
      select * into row_workspace from only_app.workspaces w
      where w.body @> jsonb_build_object('links',jsonb_build_array(jsonb_build_object('token',p_data->>'token_hash')))
        or w.body @> jsonb_build_object('links',jsonb_build_array(jsonb_build_object('kind','mobile','code',upper(p_data->>'mobile_code'))))
      limit 1;
    end if;
    if row_workspace.id is null then return null; end if;
    return jsonb_build_object('id',row_workspace.id,'version',row_workspace.version,'body',row_workspace.body);
  when 'write_workspace' then
    if jsonb_typeof(p_data->'body') <> 'object' then raise exception 'invalidBody'; end if;
    update only_app.workspaces w set body=p_data->'body',version=w.version+1,updated_at=now()
    where w.id=(p_data->>'id')::uuid and w.version=(p_data->>'version')::bigint;
    get diagnostics changed = row_count;
    return jsonb_build_object('updated',changed=1);
  when 'list_users' then
    select coalesce(jsonb_agg(to_jsonb(a)-'password_hash'),'[]'::jsonb) into result
    from only_app.accounts a where a.business=(p_data->>'business')::uuid and a.active;
    return result;
  when 'add_user' then
    select * into actor from only_app.accounts a where a.id=(p_data->>'actor')::uuid and a.business=(p_data->>'business')::uuid and a.active and a.role='owner';
    if actor.id is null then raise exception 'forbidden' using errcode='42501'; end if;
    insert into only_app.accounts(id,business,email,name,password_hash,role)
    values((p_data->>'id')::uuid,actor.business,lower(p_data->>'email'),p_data->>'name',p_data->>'password_hash','cashier')
    returning to_jsonb(accounts)-'password_hash' into result;
    return result;
  when 'change_password' then
    update only_app.accounts set password_hash=p_data->>'password_hash' where id=(p_data->>'id')::uuid;
    delete from only_app.sessions where account_id=(p_data->>'id')::uuid and token_hash<>p_data->>'keep_hash';
    return jsonb_build_object('ok',true);
  else
    raise exception 'invalidOperation';
  end case;
exception when unique_violation then
  raise exception 'emailUsed' using errcode='23505';
end;
$$;
revoke all on function public.only_gateway(text,jsonb) from public, anon, authenticated;
grant execute on function public.only_gateway(text,jsonb) to service_role;

-- Explicit server-only policies document the private backend access model.
create policy only_server_access on only_app.workspaces for all to service_role using (true) with check (true);
create policy only_server_access on only_app.accounts for all to service_role using (true) with check (true);
create policy only_server_access on only_app.sessions for all to service_role using (true) with check (true);
create policy only_server_access on only_app.rate_limits for all to service_role using (true) with check (true);
