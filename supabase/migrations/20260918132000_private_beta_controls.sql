-- Invite-only GramPay beta. Run this after the original MVP migration.
create table if not exists beta_users (
  phone_number text primary key check (phone_number ~ '^[0-9]{10,15}$'),
  display_name text,
  status text not null default 'invited' check (status in ('invited','active','frozen')),
  daily_limit numeric(15,2) not null default 5000 check (daily_limit >= 0),
  lifetime_limit numeric(15,2) not null default 20000 check (lifetime_limit >= 0),
  pin_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table recipients add column if not exists owner_phone text references beta_users(phone_number);
alter table transactions add column if not exists requester_phone text references beta_users(phone_number);
alter table transactions add column if not exists provider text not null default 'flutterwave';
alter table transactions add column if not exists provider_reference text;

create unique index if not exists recipients_owner_nickname_key
  on recipients(owner_phone, lower(nickname));
create index if not exists transactions_requester_created_at_idx
  on transactions(requester_phone, created_at desc);

create table if not exists beta_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_phone text references beta_users(phone_number),
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table beta_users enable row level security;
alter table beta_audit_events enable row level security;
revoke all on beta_users, beta_audit_events from anon, authenticated;
