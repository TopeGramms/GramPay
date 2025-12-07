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

  // Warn if OPay credentials are missing (optional but needed for money transfers)
  const opayFields = ['OPAY_MERCHANT_ID', 'OPAY_PUBLIC_KEY', 'OPAY_PRIVATE_KEY'];
  const opayMissing = opayFields.filter(key => !process.env[key]);
  if (opayMissing.length > 0) {
    console.warn('⚠️  OPay credentials not configured. Money transfer features will not work.');
    console.warn('   Add OPAY_MERCHANT_ID, OPAY_PUBLIC_KEY, OPAY_PRIVATE_KEY to .env when ready.\n');
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
