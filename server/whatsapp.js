import { default as makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore } from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import qrcode from 'qrcode-terminal';
import { config } from './config.js';
import { SessionManager } from './utils/sessionManager.js';
import { NetworkDiagnostics } from './utils/networkDiagnostics.js';
import fs from 'fs';
import path from 'path';
import pino from 'pino';

// Connection state management
const ConnectionState = {
  DISCONNECTED: 'DISCONNECTED',
  CONNECTING: 'CONNECTING',
  QR_READY: 'QR_READY',
  PAIRING_CODE_READY: 'PAIRING_CODE_READY',
  CONNECTED: 'CONNECTED',
  RECONNECTING: 'RECONNECTING'
};

let qrCode = null;
let pairingCode = null;
let connectionState = ConnectionState.DISCONNECTED;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const BASE_RECONNECT_DELAY = 3000; // Start with 3 seconds

// Logger configuration
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: {
    target: 'pino-pretty',
    options: {
      colorize: true,
      ignore: 'pid,hostname',
      translateTime: 'HH:MM:ss'
    }
  }
});

export class WhatsAppService {
  constructor() {
    this.sock = null;
    this.isReady = false;
    this.messageHandlers = [];
    this.authDir = path.join(process.cwd(), 'baileys_auth_info');
    this.pairingMode = 'qr'; // 'qr' or 'code'
    this.pairingPhoneNumber = null;
    this.connectionHistory = [];
    this.lastConnectionAttempt = null;

    if (!fs.existsSync(this.authDir)) {
      fs.mkdirSync(this.authDir, { recursive: true });
    }
  }

  /**
   * Calculate exponential backoff delay
   */
  getReconnectDelay() {
    // Exponential backoff: 3s, 6s, 12s, 24s, 48s, max 60s
    const delay = Math.min(
      BASE_RECONNECT_DELAY * Math.pow(2, reconnectAttempts),
      60000
    );
    return delay;
  }

  /**
   * Update connection state
   */
  updateConnectionState(newState) {
    const oldState = connectionState;
    connectionState = newState;

    this.connectionHistory.push({
      timestamp: new Date().toISOString(),
      from: oldState,
      to: newState
    });

    // Keep only last 20 state changes
    if (this.connectionHistory.length > 20) {
      this.connectionHistory = this.connectionHistory.slice(-20);
    }

    logger.info(`Connection state: ${oldState} → ${newState}`);
  }

  /**
   * Initialize WhatsApp with QR code pairing (default)
   */
  async initialize() {
    try {
      this.updateConnectionState(ConnectionState.CONNECTING);
      logger.info('🔄 Initializing WhatsApp with Baileys...');

      // Run network diagnostics
      const diagnostics = await NetworkDiagnostics.runDiagnostics();

      if (!diagnostics.recommendation.canProceed) {
        // logger.error('❌ Cannot proceed with pairing:', diagnostics.recommendation.reason);
        // this.updateConnectionState(ConnectionState.DISCONNECTED);
        // return;
      }

      // Validate existing session
      const sessionInfo = await SessionManager.getSessionInfo();
      if (sessionInfo.valid) {
        logger.info('✅ Found valid session, attempting to reconnect...');
      }

      // Get latest Baileys version
      const { version, isLatest } = await fetchLatestBaileysVersion();
      logger.info(`📦 Using Baileys version: ${version.join('.')} ${isLatest ? '(latest)' : ''}`);

      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      // Create socket with enhanced configuration
      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        logger,
        browser: ['Ubuntu', 'Chrome', '20.0.04'],
        syncFullHistory: false,
        markOnlineOnConnect: true,
        generateHighQualityLinkPreview: true,
        getMessage: async (key) => {
          return { conversation: '' };
        },
        // Enhanced connection settings
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        retryRequestDelayMs: 250,
        maxMsgRetryCount: 5,
        // QR code settings
        printQRInTerminal: false, // We'll handle QR display ourselves
        qrTimeout: 60000,
      });

      this.setupEventHandlers(saveCreds);

      logger.info('✅ WhatsApp service initialized and listening for events');

    } catch (error) {
      logger.error('❌ Baileys init error:', error.message);
      logger.error(error.stack);
      this.updateConnectionState(ConnectionState.DISCONNECTED);

      // Retry with backoff
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        const delay = this.getReconnectDelay();
        reconnectAttempts++;
        logger.warn(`⏳ Retrying in ${delay / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);
        setTimeout(() => this.initialize(), delay);
      }
    }
  }

  /**
   * Initialize with pairing code (alternative method)
   */
  async initializeWithPairingCode(phoneNumber) {
    try {
      this.pairingMode = 'code';
      this.pairingPhoneNumber = phoneNumber.replace(/\D/g, ''); // Remove non-digits

      logger.info(`🔐 Initializing with pairing code for: ${this.pairingPhoneNumber}`);

      this.updateConnectionState(ConnectionState.CONNECTING);

      const { version } = await fetchLatestBaileysVersion();
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);

      this.sock = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        logger,
        browser: ['GramPay', 'Chrome', '120.0.0'],
        syncFullHistory: false,
        printQRInTerminal: false,
        connectTimeoutMs: 60000,
      });

      this.setupEventHandlers(saveCreds);

      // Request pairing code
      if (!this.sock.authState.creds.registered) {
        logger.info('📱 Requesting pairing code...');
        const code = await this.sock.requestPairingCode(this.pairingPhoneNumber);
        pairingCode = code;
        this.updateConnectionState(ConnectionState.PAIRING_CODE_READY);

        console.log('\n' + '='.repeat(70));
        console.log('🔐 PAIRING CODE GENERATED');
        console.log('='.repeat(70));
        console.log(`\n   Your 8-digit pairing code: ${code}\n`);
        console.log('📲 Instructions:');
        console.log('  1. Open WhatsApp on your phone');
        console.log('  2. Go to Settings → Linked Devices');
        console.log('  3. Tap "Link a Device"');
        console.log('  4. Select "Link with Phone Number Instead"');
        console.log(`  5. Enter this code: ${code}`);
        console.log('='.repeat(70) + '\n');
      }

    } catch (error) {
      logger.error('❌ Pairing code init error:', error.message);
      this.updateConnectionState(ConnectionState.DISCONNECTED);
    }
  }

  /**
   * Setup event handlers for the socket
   */
  setupEventHandlers(saveCreds) {
    // Connection update handler
    this.sock.ev.on('connection.update', async (update) => {
      try {
        const { connection, lastDisconnect, qr, isNewLogin } = update;

        // Handle QR code generation
        if (qr && this.pairingMode === 'qr') {
          qrCode = qr;
          reconnectAttempts = 0; // Reset on successful QR generation
          this.updateConnectionState(ConnectionState.QR_READY);

          console.log('\n' + '='.repeat(70));
          console.log('📱 QR CODE GENERATED - SCAN WITH WHATSAPP');
          console.log('='.repeat(70));
          console.log('🖥️  Rendering QR code in terminal below:\n');
          qrcode.generate(qr, { small: true });
          console.log('\n🌐 OR visit: http://localhost:3000/qr');
          console.log('\n📲 Instructions:');
          console.log('  1. Open WhatsApp on your phone');
          console.log('  2. Go to Settings → Linked Devices → Link a Device');
          console.log('  3. Scan the QR code above with your phone camera');
          console.log('\n💡 Tip: If QR fails, try pairing code at /pairing-code');
          console.log('='.repeat(70) + '\n');
        }

        // Handle connection states
        if (connection === 'connecting') {
          logger.info('⏳ Connecting to WhatsApp...');
          this.updateConnectionState(ConnectionState.CONNECTING);
        }
        else if (connection === 'open') {
          this.isReady = true;
          reconnectAttempts = 0; // Reset on successful connection
          this.updateConnectionState(ConnectionState.CONNECTED);

          // Backup session on successful connection
          await SessionManager.backupSession();

          console.log('\n' + '🎉'.repeat(35));
          console.log('✅ WhatsApp Connected Successfully!');
          console.log('🎉'.repeat(35) + '\n');
          logger.info('Ready to receive messages');
        }
        else if (connection === 'close') {
          this.isReady = false;
          qrCode = null;
          pairingCode = null;

          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const reason = lastDisconnect?.error?.output?.payload?.error || 'Unknown';

          logger.warn(`Connection closed. Status: ${statusCode}, Reason: ${reason}`);

          // Handle different disconnect reasons
          if (statusCode === DisconnectReason.loggedOut) {
            logger.error('🔓 Logged out. Clearing session...');
            await SessionManager.cleanSession();
            this.updateConnectionState(ConnectionState.DISCONNECTED);
            console.log('\n⚠️  You have been logged out.');
            console.log('💡 Restart the server to generate a new QR code.\n');
            return;
          }

          if (statusCode === DisconnectReason.restartRequired) {
            logger.info('🔄 Restart required, reconnecting...');
            this.updateConnectionState(ConnectionState.RECONNECTING);
            setTimeout(() => this.initialize(), 2000);
            return;
          }

          if (statusCode === DisconnectReason.timedOut) {
            logger.warn('⏱️ Connection timed out');
          }

          // Implement exponential backoff reconnection
          if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            const delay = this.getReconnectDelay();
            reconnectAttempts++;
            this.updateConnectionState(ConnectionState.RECONNECTING);

            logger.warn(`⚠️ Connection closed. Retrying in ${delay / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})...`);

            setTimeout(() => {
              logger.info('🔄 Attempting to reconnect...');
              this.initialize();
            }, delay);
          } else {
            logger.error('❌ Max reconnection attempts reached.');
            this.updateConnectionState(ConnectionState.DISCONNECTED);
            console.log('\n⛔ Failed to connect after multiple attempts.');
            console.log('💡 Suggestions:');
            console.log('   1. Check your internet connection');
            console.log('   2. Try using mobile hotspot instead of WiFi');
            console.log('   3. Disable VPN if active');
            console.log('   4. Try pairing code method: http://localhost:3000/pairing-code');
            console.log('   5. Restart the server: npm run dev\n');
          }
        }
      } catch (error) {
        logger.error('❌ Connection handler error:', error.message);
      }
    });

    // Message handler
    this.sock.ev.on('messages.upsert', async (m) => {
      try {
        if (!m || !m.messages) return;

        for (const message of m.messages) {
          try {
            if (!message || !message.message) continue;
            if (message.key && message.key.fromMe) continue;

            const messageText =
              (message.message && message.message.conversation) ||
              (message.message && message.message.extendedTextMessage && message.message.extendedTextMessage.text) ||
              '';

            if (!messageText) continue;

            // Extract the REAL phone number (not the "lid" format)
            // Priority: participant > remoteJid, and strip the @s.whatsapp.net or @lid suffix
            let from = message.key.remoteJid.split('@')[0];

            // If it's a "lid" format (linked device ID), try to get the real number
            // from the participant field or pushName
            if (message.key.participant) {
              from = message.key.participant.split('@')[0];
            }

            // Also check for the sender phone number in verifiedBizName format
            // Some messages have the real number in different places
            if (from.length > 15 || !from.startsWith('234')) {
              // This looks like a lid, check if we can get real number elsewhere
              const possibleNumber = message.key.participant?.split('@')[0] ||
                message.pushName ||
                from;
              // If participant has a proper phone format, use it
              if (message.key.participant && message.key.participant.includes('@s.whatsapp.net')) {
                from = message.key.participant.split('@')[0];
              }
            }

            logger.info(`📨 Message from ${from}: ${messageText}`);

            for (const handler of this.messageHandlers) {
              try {
                await handler(from, messageText, message.key.id);
              } catch (handlerError) {
                logger.error('❌ Handler error:', handlerError.message);
              }
            }
          } catch (msgError) {
            logger.error('❌ Message processing error:', msgError.message);
          }
        }
      } catch (error) {
        logger.error('❌ Messages.upsert error:', error.message);
      }
    });

    // Save credentials on update
    this.sock.ev.on('creds.update', saveCreds);

    // Handle connection errors
    this.sock.ev.on('connection.error', (error) => {
      logger.error('⚠️ Connection error:', error?.message || error);
    });
  }

  /**
   * Register message handler
   */
  onMessage(callback) {
    this.messageHandlers.push(callback);
  }

  /**
   * Send message to a phone number
   */
  async sendMessage(to, message) {
    try {
      if (!this.sock) {
        throw new Error('WhatsApp not initialized');
      }
      if (!this.isReady) {
        throw new Error('WhatsApp not connected. Please scan QR code or use pairing code.');
      }

      const phoneNumber = to.replace(/\D/g, '');
      const jid = `${phoneNumber}@s.whatsapp.net`;
      const result = await this.sock.sendMessage(jid, { text: message });
      logger.info(`✅ Message sent to ${phoneNumber}`);
      return result;
    } catch (error) {
      logger.error('❌ Send error:', error.message);
      throw error;
    }
  }

  /**
   * Check if phone number is authorized
   */
  isAuthorized(phoneNumber) {
    const incoming = phoneNumber.replace(/\D/g, '');
    // Check if incoming number matches any authorized number
    return config.authorizedPhoneNumbers.some(authorized => authorized === incoming);
  }

  /**
   * Get current QR code
   */
  getQRCode() {
    return qrCode;
  }

  /**
   * Get current pairing code
   */
  getPairingCode() {
    return pairingCode;
  }

  /**
   * Check if connected
   */
  isConnected() {
    return this.isReady;
  }

  /**
   * Get connection state
   */
  getConnectionState() {
    return connectionState;
  }

  /**
   * Get connection diagnostics
   */
  async getConnectionDiagnostics() {
    const sessionInfo = await SessionManager.getSessionInfo();
    const networkDiag = await NetworkDiagnostics.runDiagnostics();

    return {
      state: connectionState,
      isReady: this.isReady,
      reconnectAttempts,
      maxReconnectAttempts: MAX_RECONNECT_ATTEMPTS,
      pairingMode: this.pairingMode,
      session: sessionInfo,
      network: networkDiag,
      connectionHistory: this.connectionHistory.slice(-5), // Last 5 state changes
      lastAttempt: this.lastConnectionAttempt
    };
  }

  /**
   * Reset connection (force new pairing)
   */
  async resetConnection() {
    try {
      logger.info('🔄 Resetting connection...');

      // Disconnect current socket
      if (this.sock) {
        this.sock.end();
        this.sock = null;
      }

      // Clean session
      await SessionManager.cleanSession();

      // Reset state
      this.isReady = false;
      qrCode = null;
      pairingCode = null;
      reconnectAttempts = 0;
      this.updateConnectionState(ConnectionState.DISCONNECTED);

      logger.info('✅ Connection reset. Ready for new pairing.');

      return { success: true, message: 'Connection reset successfully' };
    } catch (error) {
      logger.error('❌ Reset error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Generate a test QR code (for UI testing)
   */
  generateTestQR() {
    if (!qrCode) {
      qrCode = 'test_qr_' + Date.now();
      logger.info('📝 Generated test QR code for UI testing');
    }
    return qrCode;
  }
}

export const whatsappService = new WhatsAppService();
