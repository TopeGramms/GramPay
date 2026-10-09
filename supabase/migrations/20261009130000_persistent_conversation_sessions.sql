-- Persist short-lived WhatsApp conversation state across Render restarts/deploys.
-- PIN candidates and one-time secure authorization tokens are never stored here.
create table if not exists conversation_sessions (
  phone_number text primary key references beta_users(phone_number) on delete cascade,
  session_state jsonb not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create index if not exists conversation_sessions_expires_at_idx
  on conversation_sessions (expires_at);

alter table conversation_sessions enable row level security;
revoke all on conversation_sessions from anon, authenticated;