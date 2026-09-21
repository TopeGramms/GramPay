export const CONSTANTS = {
  // Financial Limits (NGN)
  DEFAULT_DAILY_LIMIT: 50000,
  MAX_SINGLE_TRANSFER: 20000,
  MIN_SINGLE_TRANSFER: 100,
  DEFAULT_CURRENCY: 'NGN',

  // Security
  BCRYPT_SALT_ROUNDS: 12,
  CONFIRMATION_TTL_MS: 5 * 60 * 1000, // 5 minutes

  // WhatsApp Meta Cloud API
  META_API_VERSION: 'v21.0',
  META_BASE_URL: 'https://graph.facebook.com',

  // Flutterwave API
  FLUTTERWAVE_BASE_URL: 'https://api.flutterwave.com/v3',

  // Intents
  INTENTS: {
    SEND_MONEY: 'SEND_MONEY',
    CHECK_BALANCE: 'CHECK_BALANCE',
    ADD_RECIPIENT: 'ADD_RECIPIENT',
    LIST_RECIPIENTS: 'LIST_RECIPIENTS',
    SET_PIN: 'SET_PIN',
    HELP: 'HELP',
    UNKNOWN: 'UNKNOWN',
  }
};
