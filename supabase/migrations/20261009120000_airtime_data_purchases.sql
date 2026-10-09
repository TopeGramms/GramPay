-- Durable records for Flutterwave airtime and mobile-data purchases.
-- The table intentionally has no permissive client policies; the API uses the
-- Supabase service-role key and must fail closed if a record cannot be stored.
create table if not exists bill_transactions (
  id uuid primary key default gen_random_uuid(),
  requester_phone text not null references beta_users(phone_number),
  product text not null check (product in ('airtime', 'data')),
  network text not null check (network in ('mtn', 'airtel', 'glo', '9mobile')),
  customer_phone text not null,
  biller_code text not null,
  item_code text not null,
  plan_name text,
  amount numeric(15,2) not null check (amount > 0),
  provider_fee numeric(15,2) not null default 0 check (provider_fee >= 0),
  status text not null default 'processing'
    check (status in ('processing', 'pending', 'completed', 'failed', 'manual_review')),
  idempotency_key text not null unique,
  provider_reference text not null unique,
  provider_transaction_id text,
  provider_response jsonb not null default '{}'::jsonb,
  error_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bill_transactions_requester_created_idx
  on bill_transactions (requester_phone, created_at desc);
create index if not exists bill_transactions_status_created_idx
  on bill_transactions (status, created_at);

alter table bill_transactions enable row level security;
revoke all on bill_transactions from anon, authenticated;