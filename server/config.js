import dotenv from 'dotenv';

dotenv.config();

// Validate required environment variables at startup
function validateEnv() {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'AUTHORIZED_PHONE_NUMBER',
    'GROQ_API_KEY'
  ];

  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error('\n❌ Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    console.error('\n📋 Copy .env.example to .env and fill in all values.\n');
    process.exit(1);
  }

  if (!process.env.FLW_SECRET_KEY) {
    console.warn('⚠️  Flutterwave is not configured. Payouts are disabled.');
  }
}

validateEnv();

export const config = {
  supabase: {
    url: process.env.SUPABASE_URL,
    anonKey: process.env.SUPABASE_ANON_KEY
  },
  // Support multiple authorized numbers (comma-separated)
  authorizedPhoneNumbers: process.env.AUTHORIZED_PHONE_NUMBER
    .split(',')
    .map(num => num.trim().replace(/\D/g, '')),
  groq: {
    apiKey: process.env.GROQ_API_KEY
  },
  whatsapp: {
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION || 'v22.0'
  },
  flutterwave: {
    secretKey: process.env.FLW_SECRET_KEY,
    webhookSecret: process.env.FLW_WEBHOOK_SECRET,
    transferCallbackUrl: process.env.FLW_TRANSFER_CALLBACK_URL,
    apiBaseUrl: 'https://api.flutterwave.com/v3'
  },
  // Temporary compatibility while the transfer client is migrated.
  opay: {
    merchantId: process.env.OPAY_MERCHANT_ID,
    publicKey: process.env.OPAY_PUBLIC_KEY,
    privateKey: process.env.OPAY_PRIVATE_KEY,
    apiBaseUrl: process.env.OPAY_API_BASE_URL || 'https://api.opay.com'
  },
  server: {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development'
  }
};
