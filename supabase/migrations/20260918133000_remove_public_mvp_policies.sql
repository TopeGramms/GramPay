-- Remove the single-user MVP policies that exposed all data to anon/authenticated clients.
drop policy if exists "Allow all operations on recipients" on recipients;
drop policy if exists "Allow all operations on transactions" on transactions;
drop policy if exists "Allow all operations on bot_config" on bot_config;

revoke all on recipients, transactions, bot_config from anon, authenticated;
alter table recipients enable row level security;
alter table transactions enable row level security;
alter table bot_config enable row level security;
