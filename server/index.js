import express from 'express';
import { config } from './config.js';
import { whatsappService } from './whatsappCloud.js';
import { commandHandler } from './commandHandler.js';
import { recipientService } from './recipients.js';
import { opayService, transactionService } from './payments.js';
import { supabase } from './supabase.js';

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/webhook', (req, res) => {
  const { 'hub.mode': mode, 'hub.verify_token': token, 'hub.challenge': challenge } = req.query;
  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) return res.status(200).send(challenge);
  return res.sendStatus(403);
});
app.post('/webhook', async (req, res) => { res.sendStatus(200); try { await whatsappService.receive(req.body); } catch (error) { console.error('Cloud API message error:', error.message); } });

// ============ WhatsApp Initialization ============
let whatsappReady = false;

async function initializeWhatsApp() {
  try {
    console.log('🤖 Initializing WhatsApp with Baileys...');
    // Don't await - just call it, it sets up event listeners and returns immediately
    whatsappService.initialize();

    // Set up message handler
    whatsappService.onMessage(async (from, message, messageId) => {
      try {
        console.log(`📨 Message from ${from}: ${message}`);
        console.log(`🔍 Checking authorization for: ${from}`);
        console.log(`🔑 Authorized numbers: ${config.authorizedPhoneNumbers.join(', ')}`);

        if (!whatsappService.isAuthorized(from)) {
          console.log(`❌ Unauthorized number: ${from}`);
          await whatsappService.sendMessage(
            from,
            '❌ Unauthorized. This bot is for private use only.'
          );
          return;
        }

        console.log(`✅ Authorized! Processing command...`);
        const response = await commandHandler.handleMessage(from, message, messageId);
        console.log(`📤 Sending response: ${response}`);
        await whatsappService.sendMessage(from, response);
      } catch (error) {
        console.error('Error handling message:', error);
        await whatsappService.sendMessage(
          from,
          '❌ An error occurred processing your request.'
        );
      }
    });

    whatsappReady = true;
    console.log('✅ WhatsApp service initialized!');
  } catch (error) {
    console.error('❌ Failed to initialize WhatsApp:', error);
  }
}

// Initialize WhatsApp on startup (non-blocking)
initializeWhatsApp().catch(err => {
  console.error('WhatsApp init error:', err.message);
  // Continue running server even if WhatsApp init fails
});

// ============ Status & QR Code Endpoints ============
app.get('/status', (req, res) => {
  const status = whatsappService.isConnected() ? 'connected' : 'not_connected';
  res.json({
    whatsapp: status,
    ready: whatsappReady,
    message: whatsappService.isConnected()
      ? '✅ WhatsApp is connected'
      : '⏳ Waiting for QR code scan. Visit /qr'
  });
});

app.get('/qr', async (req, res) => {
  let qr = whatsappService.getQRCode();

  // If no QR generated after 30 seconds, offer test mode
  if (!qr) {
    const testMode = req.query.test === 'true';
    if (testMode) {
      console.log('📝 Generating test QR for debugging...');
      qr = whatsappService.generateTestQR();
    }
  }

  if (!qr) {
    return res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>GramPay - QR Code</title>
        <style>
          body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
          .container { text-align: center; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 0 10px rgba(0,0,0,0.1); max-width: 500px; }
          h1 { color: #25D366; margin-bottom: 10px; }
          p { color: #666; font-size: 16px; }
          .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #25D366; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 20px auto; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          .debug-btn { margin-top: 30px; padding: 10px 20px; background: #FF6B6B; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 14px; }
          .debug-btn:hover { background: #ff5252; }
          .note { font-size: 12px; color: #999; margin-top: 15px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📱 GramPay</h1>
          <p><strong>Generating QR Code...</strong></p>
          <div class="spinner"></div>
          <p style="margin-top: 20px; font-size: 14px; color: #999;">Ensure your phone is connected to the internet and WhatsApp is running.</p>
          <p style="font-size: 12px; color: #999;">Page will auto-refresh when QR is ready...</p>
          <button class="debug-btn" onclick="location.href='http://localhost:3000/qr?test=true'">🧪 Try Test Mode</button>
          <p class="note">If QR doesn't appear after 30 seconds, click Test Mode to debug.</p>
          <script>
            setInterval(() => { location.reload(); }, 3000);
          </script>
        </div>
      </body>
      </html>
    `);
  }

  try {
    const qrDataUrl = await QRCode.toDataURL(qr, {
      width: 500,
      margin: 2,
      color: { dark: '#000000', light: '#FFFFFF' }
    });

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>GramPay - QR Code</title>
        <style>
          body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #25D366 0%, #128C7E 100%); }
          .container { text-align: center; background: white; padding: 40px; border-radius: 15px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); max-width: 600px; }
          h1 { color: #25D366; margin: 0 0 10px 0; font-size: 32px; }
          .subtitle { color: #666; font-size: 14px; margin-bottom: 30px; }
          img { border: 3px solid #25D366; border-radius: 10px; max-width: 100%; }
          .instructions { text-align: left; margin-top: 30px; color: #666; font-size: 14px; line-height: 1.8; }
          .instructions ol { padding-left: 20px; }
          .instructions li { margin-bottom: 10px; }
          .status { margin-top: 20px; padding: 10px; background: #e8f5e9; border-left: 4px solid #25D366; text-align: left; font-size: 12px; color: #2e7d32; border-radius: 4px; }
          .refresh { font-size: 12px; color: #999; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>📱 GramPay</h1>
          <p class="subtitle">Scan to Connect WhatsApp</p>
          
          <img src="${qrDataUrl}" alt="WhatsApp QR Code">
          
          <div class="instructions">
            <strong>📲 How to Scan:</strong>
            <ol>
              <li>Open <strong>WhatsApp</strong> on your phone</li>
              <li>Go to <strong>Settings</strong> → <strong>Linked Devices</strong></li>
              <li>Tap <strong>Link a Device</strong></li>
              <li>Point your camera at this QR code to scan</li>
            </ol>
          </div>

          <div class="status">
            ✅ Server is running on http://localhost:3000<br>
            🔌 Waiting for WhatsApp connection...
          </div>

          <p class="refresh">🔄 Auto-refresh: Page updates every 5 seconds</p>
          
          <script>
            setInterval(() => { location.reload(); }, 5000);
          </script>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>GramPay - Error</title>
        <style>
          body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
          .container { text-align: center; background: white; padding: 40px; border-radius: 10px; box-shadow: 0 0 10px rgba(0,0,0,0.1); max-width: 500px; }
          h1 { color: #d32f2f; margin-bottom: 10px; }
          p { color: #666; font-size: 16px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>❌ Error</h1>
          <p>Failed to generate QR code. Please try again.</p>
          <p style="font-size: 12px; color: #999; margin-top: 20px;">${error.message}</p>
        </div>
      </body>
      </html>
    `);
  }
});

// ============ Pairing Code Endpoints (Alternative to QR) ============
app.get('/pairing-code', (req, res) => {
  const code = whatsappService.getPairingCode();
  const state = whatsappService.getConnectionState();

  if (code) {
    // Code already generated
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>GramPay - Pairing Code</title>
        <style>
          body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
          .container { text-align: center; background: white; padding: 40px; border-radius: 15px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); max-width: 600px; }
          h1 { color: #667eea; margin: 0 0 10px 0; font-size: 32px; }
          .code { font-size: 48px; font-weight: bold; color: #764ba2; letter-spacing: 8px; margin: 30px 0; padding: 20px; background: #f5f5f5; border-radius: 10px; }
          .instructions { text-align: left; margin-top: 30px; color: #666; font-size: 14px; line-height: 1.8; }
          .instructions ol { padding-left: 20px; }
          .instructions li { margin-bottom: 10px; }
          .note { margin-top: 20px; padding: 15px; background: #fff3cd; border-left: 4px solid #ffc107; text-align: left; font-size: 13px; color: #856404; border-radius: 4px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🔐 GramPay Pairing Code</h1>
          <div class="code">${code}</div>
          <div class="instructions">
            <strong>📲 How to Use:</strong>
            <ol>
              <li>Open <strong>WhatsApp</strong> on your phone</li>
              <li>Go to <strong>Settings</strong> → <strong>Linked Devices</strong></li>
              <li>Tap <strong>Link a Device</strong></li>
              <li>Select <strong>Link with Phone Number Instead</strong></li>
              <li>Enter the 8-digit code shown above</li>
            </ol>
          </div>
          <div class="note">
            💡 <strong>Tip:</strong> This method works better on restricted networks or when QR code fails.
          </div>
        </div>
      </body>
      </html>
    `);
  } else {
    // Show form to request pairing code
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>GramPay - Request Pairing Code</title>
        <style>
          body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
          .container { text-align: center; background: white; padding: 40px; border-radius: 15px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); max-width: 500px; }
          h1 { color: #667eea; margin: 0 0 10px 0; font-size: 28px; }
          .subtitle { color: #666; font-size: 14px; margin-bottom: 30px; }
          input { width: 100%; padding: 15px; font-size: 16px; border: 2px solid #ddd; border-radius: 8px; box-sizing: border-box; margin-bottom: 20px; }
          button { width: 100%; padding: 15px; font-size: 16px; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer; font-weight: bold; }
          button:hover { background: #5568d3; }
          .note { margin-top: 20px; padding: 15px; background: #e3f2fd; border-left: 4px solid #2196f3; text-align: left; font-size: 13px; color: #1565c0; border-radius: 4px; }
          .error { color: #d32f2f; font-size: 14px; margin-top: 10px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🔐 Request Pairing Code</h1>
          <p class="subtitle">Alternative to QR Code Scanning</p>
          <form id="pairingForm">
            <input type="tel" id="phoneNumber" placeholder="Enter phone number (e.g., 2348012345678)" required pattern="[0-9]+" />
            <button type="submit">Generate Pairing Code</button>
          </form>
          <div id="error" class="error"></div>
          <div class="note">
            📱 <strong>Format:</strong> Enter your phone number with country code, no spaces or special characters.<br>
            Example: 2348012345678 (Nigeria)
          </div>
        </div>
        <script>
          document.getElementById('pairingForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            const phoneNumber = document.getElementById('phoneNumber').value;
            const errorDiv = document.getElementById('error');
            
            try {
              const response = await fetch('/pairing-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phoneNumber })
              });
              
              const data = await response.json();
              
              if (data.success) {
                location.reload();
              } else {
                errorDiv.textContent = data.message || 'Failed to generate pairing code';
              }
            } catch (error) {
              errorDiv.textContent = 'Error: ' + error.message;
            }
          });
        </script>
      </body>
      </html>
    `);
  }
});

app.post('/pairing-code', async (req, res) => {
  try {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // Initialize with pairing code
    await whatsappService.initializeWithPairingCode(phoneNumber);

    res.json({
      success: true,
      message: 'Pairing code generated. Check the page for your code.'
    });
  } catch (error) {
    console.error('Error generating pairing code:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate pairing code',
      error: error.message
    });
  }
});

// ============ Connection Diagnostics Endpoints ============
app.get('/connection-status', async (req, res) => {
  try {
    const diagnostics = await whatsappService.getConnectionDiagnostics();
    res.json({
      success: true,
      ...diagnostics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/connection-health', async (req, res) => {
  try {
    const { NetworkDiagnostics } = await import('./utils/networkDiagnostics.js');
    const report = await NetworkDiagnostics.runDiagnostics();

    res.json({
      success: true,
      ...report
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============ Session Management Endpoints ============
app.post('/reset-session', async (req, res) => {
  try {
    const result = await whatsappService.resetConnection();
    res.json(result);
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

app.get('/session-info', async (req, res) => {
  try {
    const { SessionManager } = await import('./utils/sessionManager.js');
    const info = await SessionManager.getSessionInfo();
    res.json({
      success: true,
      ...info
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});


// ============ Recipients API Endpoints ============
app.get('/api/recipients', async (req, res) => {
  try {
    const result = await recipientService.listRecipients();
    res.json(result);
  } catch (error) {
    console.error('Error fetching recipients:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recipients',
      error: error.message
    });
  }
});

app.post('/api/recipients', async (req, res) => {
  try {
    const { nickname, accountNumber, bankName } = req.body;

    if (!nickname || !accountNumber) {
      return res.status(400).json({
        success: false,
        message: 'nickname and accountNumber are required'
      });
    }

    if (!opayService.validateAccountNumber(accountNumber)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid account number. Must be 10 digits.'
      });
    }

    const result = await recipientService.addRecipient(
      nickname,
      accountNumber,
      bankName || 'Unknown Bank'
    );
    res.json(result);
  } catch (error) {
    console.error('Error adding recipient:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to add recipient',
      error: error.message
    });
  }
});

app.get('/api/recipients/:nickname', async (req, res) => {
  try {
    const { nickname } = req.params;
    const recipient = await recipientService.getRecipientByNickname(nickname);

    if (!recipient) {
      return res.status(404).json({
        success: false,
        message: `Recipient "${nickname}" not found`
      });
    }

    res.json({
      success: true,
      data: recipient
    });
  } catch (error) {
    console.error('Error fetching recipient:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch recipient',
      error: error.message
    });
  }
});

app.put('/api/recipients/:nickname', async (req, res) => {
  try {
    const { nickname } = req.params;
    const { accountNumber, bankName } = req.body;

    const result = await recipientService.updateRecipient(
      nickname,
      accountNumber,
      bankName
    );
    res.json(result);
  } catch (error) {
    console.error('Error updating recipient:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update recipient',
      error: error.message
    });
  }
});

app.delete('/api/recipients/:nickname', async (req, res) => {
  try {
    const { nickname } = req.params;
    const result = await recipientService.deleteRecipient(nickname);
    res.json(result);
  } catch (error) {
    console.error('Error deleting recipient:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete recipient',
      error: error.message
    });
  }
});

// ============ Balance & Account API Endpoints ============
app.get('/api/balance', async (req, res) => {
  try {
    const result = await opayService.checkBalance();
    res.json(result);
  } catch (error) {
    console.error('Error checking balance:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to check balance',
      error: error.message
    });
  }
});

// ============ Webhook Endpoints ============
app.post('/api/flutterwave/webhook', async (req, res) => {
  try {
    const signature = req.headers['verif-hash'];
    const result = await opayService.handleWebhook(req.body, signature);

    if (result.success) {
      res.sendStatus(200);
    } else {
      res.sendStatus(401);
    }
  } catch (error) {
    console.error('Webhook endpoint error:', error);
    res.sendStatus(500);
  }
});

// ============ Transactions API Endpoints ============
app.get('/api/transactions', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;
    const result = await transactionService.getTransactionHistory(limit);
    res.json(result);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch transactions',
      error: error.message
    });
  }
});

app.get('/api/transactions/daily-total', async (req, res) => {
  try {
    const total = await transactionService.getTodaysTotalSpent();
    res.json({
      success: true,
      amount: total,
      currency: 'NGN'
    });
  } catch (error) {
    console.error('Error calculating daily total:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to calculate daily total',
      error: error.message
    });
  }
});

// ============ Bot Configuration API Endpoints ============
app.get('/api/config', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('bot_config')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    res.json({
      success: true,
      data: data || { active_status: true, daily_limit: 100000 }
    });
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch config',
      error: error.message
    });
  }
});

app.put('/api/config', async (req, res) => {
  try {
    const { pin, daily_limit, active_status } = req.body;

    const { data: config, error: fetchError } = await supabase
      .from('bot_config')
      .select('*')
      .limit(1)
      .maybeSingle();

    if (fetchError) throw fetchError;

    const updates = {
      updated_at: new Date().toISOString()
    };

    if (pin !== undefined) {
      if (!/^\d{4}$/.test(pin)) {
        return res.status(400).json({
          success: false,
          message: 'PIN must be exactly 4 digits'
        });
      }
      updates.pin = pin;
    }

    if (daily_limit !== undefined) updates.daily_limit = daily_limit;
    if (active_status !== undefined) updates.active_status = active_status;

    if (config) {
      const { data, error } = await supabase
        .from('bot_config')
        .update(updates)
        .eq('id', config.id)
        .select()
        .single();

      if (error) throw error;

      res.json({
        success: true,
        message: 'Config updated successfully',
        data
      });
    } else {
      res.status(404).json({
        success: false,
        message: 'Bot config not found'
      });
    }
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update config',
      error: error.message
    });
  }
});

// ============ Health & Info Endpoints ============
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'WhatsApp Money Assistant'
  });
});

app.get('/', (req, res) => {
  res.json({
    service: 'WhatsApp Money Assistant API',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      webhook_verification: 'GET /webhook',
      webhook_handler: 'POST /webhook',
      health_check: 'GET /health',
      recipients: {
        list: 'GET /api/recipients',
        create: 'POST /api/recipients',
        get: 'GET /api/recipients/:nickname',
        update: 'PUT /api/recipients/:nickname',
        delete: 'DELETE /api/recipients/:nickname'
      },
      account: {
        balance: 'GET /api/balance'
      },
      transactions: {
        list: 'GET /api/transactions',
        daily_total: 'GET /api/transactions/daily-total'
      },
      config: {
        get: 'GET /api/config',
        update: 'PUT /api/config'
      }
    }
  });
});

const PORT = config.server.port;

app.listen(PORT, () => {
  console.log(`🚀 WhatsApp Money Assistant server running on port ${PORT}`);
  console.log(`🚀 WhatsApp Money Assistant server running on port ${PORT}`);
  console.log(`\n💳 Payment Webhook:`);
  console.log(`   URL: POST http://localhost:${PORT}/api/payment-webhook`);
  console.log(`\n🔌 REST API Endpoints:`);
  console.log(`   Recipients: GET/POST /api/recipients`);
  console.log(`   Balance: GET /api/balance`);
  console.log(`   Transactions: GET /api/transactions`);
  console.log(`   Config: GET/PUT /api/config`);
  console.log(`\n🏥 Health check: http://localhost:${PORT}/health`);
  console.log(`\n⚙️  Environment: ${config.server.nodeEnv}`);
  console.log(`🔒 Authorized numbers: ${config.authorizedPhoneNumbers.join(', ')}`);
  console.log('\n✅ Server ready!\n');
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error.message);
  console.error(error.stack);
  // Don't exit - keep the process running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
  // Don't exit - keep the process running
});
