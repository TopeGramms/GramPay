/*
  # WhatsApp Money Assistant Database Schema

  ## Overview
  This migration creates the core database schema for the WhatsApp AI Money Assistant MVP.
  The system allows a single user to send money from their Opay wallet via WhatsApp commands.

  ## Tables Created

  ### 1. recipients
  Stores nickname-to-account-number mappings for quick money transfers.
  - `id` (uuid, primary key): Unique identifier for each recipient
  - `nickname` (text, unique): Friendly name for the recipient (e.g., "Mom", "John")
  - `account_number` (text): Nigerian bank account number
  - `bank_name` (text): Name of the recipient's bank
  - `created_at` (timestamptz): When the recipient was added
  - `updated_at` (timestamptz): Last time the recipient info was modified

  ### 2. transactions
  Logs all payment attempts, successful or failed.
  - `id` (uuid, primary key): Unique transaction identifier
  - `amount` (decimal): Transfer amount in NGN
  - `recipient_nickname` (text): Nickname used in the command
  - `account_number` (text): Actual account number used for transfer
  - `bank_name` (text): Bank name
  - `status` (text): Transaction status - 'pending', 'completed', 'failed'
  - `opay_reference` (text): Opay API transaction reference ID
  - `message_from_user` (text): Original WhatsApp message from user
  - `error_message` (text): Error details if transaction failed
  - `created_at` (timestamptz): Transaction timestamp

  ### 3. bot_config
  Stores bot configuration and security settings.
  - `id` (uuid, primary key): Config identifier (single row)
  - `pin` (text): Optional 4-digit PIN for payment confirmation
  - `daily_limit` (decimal): Maximum daily spending limit in NGN
  - `active_status` (boolean): Whether bot is active or paused
  - `created_at` (timestamptz): Configuration creation time
  - `updated_at` (timestamptz): Last configuration update

  ## Security
  - All tables have RLS (Row Level Security) enabled
  - Public access policies allow operations (single-user MVP)
  - Future versions will add user authentication

  ## Indexes
  - Index on recipients.nickname for fast lookups
  - Index on transactions.created_at for chronological queries
  - Index on transactions.status for filtering

  ## Notes
  - This is a single-user MVP design
  - No user authentication in this version
  - All operations are logged for audit trail
  - Default values ensure data integrity
*/

-- Create recipients table
CREATE TABLE IF NOT EXISTS recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nickname text UNIQUE NOT NULL,
  account_number text NOT NULL,
  bank_name text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  amount decimal(15,2) NOT NULL,
  recipient_nickname text NOT NULL,
  account_number text NOT NULL,
  bank_name text,
  status text NOT NULL DEFAULT 'pending',
  opay_reference text,
  message_from_user text NOT NULL,
  error_message text,
  created_at timestamptz DEFAULT now()
);

-- Create bot_config table
CREATE TABLE IF NOT EXISTS bot_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pin text,
  daily_limit decimal(15,2) DEFAULT 100000,
  active_status boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Insert default bot configuration
INSERT INTO bot_config (daily_limit, active_status)
VALUES (100000, true)
ON CONFLICT DO NOTHING;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_recipients_nickname ON recipients(nickname);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);

-- Enable Row Level Security
ALTER TABLE recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_config ENABLE ROW LEVEL SECURITY;

-- Create RLS policies (public access for MVP - single user)
CREATE POLICY "Allow all operations on recipients"
  ON recipients
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations on transactions"
  ON transactions
  FOR ALL
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Allow all operations on bot_config"
  ON bot_config
  FOR ALL
  USING (true)
  WITH CHECK (true);