import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Go up two levels to root (server/scripts -> server -> root)
const rootDir = path.join(__dirname, '../../');

console.log('Current directory:', process.cwd());
console.log('Root directory:', rootDir);

dotenv.config({ path: path.join(rootDir, '.env') });

console.log('Environment Check:');
console.log('SUPABASE_URL:', process.env.SUPABASE_URL ? '✅ Set' : '❌ Missing');
console.log('SUPABASE_ANON_KEY:', process.env.SUPABASE_ANON_KEY ? '✅ Set' : '❌ Missing');
console.log('AUTHORIZED_PHONE_NUMBER:', process.env.AUTHORIZED_PHONE_NUMBER ? '✅ Set' : '❌ Missing');
console.log('GROQ_API_KEY:', process.env.GROQ_API_KEY ? '✅ Set' : '❌ Missing');
console.log('OPAY_MERCHANT_ID:', process.env.OPAY_MERCHANT_ID ? '✅ Set' : '❌ Missing');
console.log('OPAY_PUBLIC_KEY:', process.env.OPAY_PUBLIC_KEY ? '✅ Set' : '❌ Missing');
console.log('OPAY_PRIVATE_KEY:', process.env.OPAY_PRIVATE_KEY ? '✅ Set' : '❌ Missing');

import { config } from '../config.js';
console.log('Config loaded successfully:', !!config);
