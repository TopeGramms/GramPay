-- Migration: Idempotency and Webhook/Message Replay Protection
-- Enforces unique idempotency keys on transactions and adds deduplication tables.

-- 1. Transactions idempotency key uniqueness
alter table transactions add column if not exists idempotency_key text;
create unique index if not exists transactions_idempotency_key_idx 
  on transactions (idempotency_key) 
  where idempotency_key is not null;

-- 2. Inbound WhatsApp message deduplication table
create table if not exists inbound_messages (
  message_id text primary key,
  sender_phone text,
  created_at timestamptz not null default now()
);

create index if not exists idx_inbound_messages_created_at 
  on inbound_messages (created_at desc);

-- 3. Provider webhook events deduplication table
create table if not exists processed_webhook_events (
  event_id text primary key,
  provider text not null default 'flutterwave',
  event_type text not null,
  reference text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_processed_webhook_events_created_at 
  on processed_webhook_events (created_at desc);

-- 4. Access controls & Row Level Security
alter table inbound_messages enable row level security;
alter table processed_webhook_events enable row level security;

revoke all on inbound_messages, processed_webhook_events from anon, authenticated;
