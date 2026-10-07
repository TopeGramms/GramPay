-- Migration: Add onboarding progress tracking and persistent conversation memory for AI
alter table beta_users add column if not exists onboarding_step text not null default 'AWAITING_NAME';
alter table beta_users add column if not exists display_name text;

-- Create conversation_history table for long-term memory
create table if not exists conversation_history (
  id uuid primary key default gen_random_uuid(),
  user_phone text not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_conversation_history_phone_created_at
  on conversation_history(user_phone, created_at desc);

alter table conversation_history enable row level security;
revoke all on conversation_history from anon, authenticated;
