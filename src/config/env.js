import dotenv from 'dotenv';
dotenv.config();

function getEnv(key, defaultValue = undefined, required = false) {
  const value = process.env[key] || defaultValue;
  if (required && (!value || value.trim() === '')) {
    console.error(`❌ CRITICAL: Missing required environment variable: ${key}`);
    if (process.env.NODE_ENV === 'production') {
      throw new Error(`Missing required environment variable: ${key}`);
    }
  }
  return value;
}

export const config = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  
  adminApiKey: getEnv('ADMIN_API_KEY', 'default_grampay_admin_secret_change_me'),

  supabase: {
    url: getEnv('SUPABASE_URL', '', true),
    serviceRoleKey: getEnv('SUPABASE_SERVICE_ROLE_KEY', '', true),
  },

  meta: {
    whatsappToken: getEnv('META_WHATSAPP_TOKEN', ''),
    phoneNumberId: getEnv('META_PHONE_NUMBER_ID', ''),
    verifyToken: getEnv('META_VERIFY_TOKEN', 'grampay_verify_token'),
    appSecret: getEnv('META_APP_SECRET', ''),
  },

  flutterwave: {
    secretKey: getEnv('FLW_SECRET_KEY', ''),
    publicKey: getEnv('FLW_PUBLIC_KEY', ''),
    webhookSecret: getEnv('FLW_WEBHOOK_SECRET', ''),
  },

  groq: {
    apiKey: getEnv('GROQ_API_KEY', ''),
    model: getEnv('GROQ_MODEL', 'llama-3.3-70b-versatile'),
  },

  bot: {
    defaultDailyLimit: parseInt(process.env.DEFAULT_DAILY_LIMIT || '50000', 10),
  }
};
