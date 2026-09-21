import { Router } from 'express';
import { config } from '../config/env.js';

const router = Router();

router.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'grampay-api',
    message: 'Welcome to GramPay API — WhatsApp AI Money Assistant',
    health: '/health',
    status_page: '/status',
  });
});

router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'grampay-api',
    provider: 'meta_cloud_api',
    env: config.env,
  });
});

router.get('/status', (req, res) => {
  res.status(200).json({
    active: true,
    metaConfigured: Boolean(config.meta.whatsappToken && config.meta.phoneNumberId),
    flwConfigured: Boolean(config.flutterwave.secretKey),
    groqConfigured: Boolean(config.groq.apiKey),
    supabaseConfigured: Boolean(config.supabase.url && config.supabase.serviceRoleKey),
  });
});

export default router;
