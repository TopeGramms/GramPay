// @ts-nocheck
import { default as makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import fs from 'fs';
import path from 'path';

console.log("Initializing WhatsApp with Baileys...");

// Initialize in an async IIFE so we can await auth state
(async function init() {
    try {
        // Use multi-file auth state (directory) to match other server code
        const authDir = path.join(process.cwd(), 'baileys_auth_info');
        if (!fs.existsSync(authDir)) fs.mkdirSync(authDir, { recursive: true });

        const { state, saveCreds } = await useMultiFileAuthState(authDir);

        // Create WhatsApp socket
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false // we handle QR manually
        });

        // Listen for connection updates
        sock.ev.on('connection.update', (update) => {
            const { qr, connection, lastDisconnect } = update;

            if (qr) {
                console.log('📱 Scan this QR code with WhatsApp:');
                qrcode.generate(qr, { small: true }); // prints QR in terminal
            }

            if (connection === 'open') {
                console.log('✅ WhatsApp Connected!');
            }

            if (connection === 'close') {
                console.log('❌ Connection closed:', lastDisconnect?.error || 'Unknown reason');
            }
        });

        // Save credentials when updated
        sock.ev.on('creds.update', saveCreds);
    } catch (err) {
        console.error('Failed to initialize Baileys socket:', err?.message || err);
    }
})();
