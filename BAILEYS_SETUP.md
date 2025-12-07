# Baileys WhatsApp Setup Guide

Your GramPay now uses **Baileys** - a free, open-source WhatsApp Web automation library. No official API credentials needed!

## ✅ What is Baileys?

Baileys is a Node.js library that works by:
- Automating WhatsApp Web
- Connecting as a client (like your phone)
- Receiving and sending messages directly
- **100% FREE** - no API costs!

## 🚀 Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
npm run dev
```

You'll see:
```
🤖 Initializing WhatsApp with Baileys...
📱 Scan this QR code with your WhatsApp:
```

### 3. Scan QR Code
**Option A: Terminal QR Code**
- Scan the QR code printed in your terminal with WhatsApp on your phone
- Camera → Link Device

**Option B: Web QR Code**
- Visit `http://localhost:3000/qr` in your browser
- Scan the displayed QR code

### 4. Verify Connection
Once scanned:
```
✅ WhatsApp Connected!
```

Now you can:
- Send messages from your phone to your bot number
- The bot will receive and respond automatically

## 📁 Data Storage

Baileys stores connection data in `baileys_auth_info/` directory:
```
baileys_auth_info/
├── creds.json          (credentials - KEEP SECRET!)
├── msgs-store.json
└── pre-keys.json
```

**⚠️ Important:** Never commit `baileys_auth_info/` to git! Add to `.gitignore`:
```bash
echo "baileys_auth_info/" >> .gitignore
```

## 🔌 API Endpoints

### Check Status
```bash
curl http://localhost:3000/status
```

Response:
```json
{
  "whatsapp": "connected",
  "ready": true,
  "message": "✅ WhatsApp is connected"
}
```

### Get QR Code (Web)
```bash
curl http://localhost:3000/qr
```

Response:
```json
{
  "qr": "00020...",
  "message": "Scan this QR code with WhatsApp to connect"
}
```

## 🛠️ Troubleshooting

### QR Code not appearing?
- Make sure server is running: `npm run dev`
- Check terminal output for errors
- Try refreshing `/qr` page

### Connection keeps dropping?
- Make sure your phone's internet is stable
- Restart the server: `Ctrl+C` then `npm run dev`
- Delete `baileys_auth_info/` and scan QR code again

### Not receiving messages?
1. Verify bot number matches `AUTHORIZED_PHONE_NUMBER` in `.env`
2. Check server logs for errors
3. Restart the server

### "WhatsApp not connected" error?
- The QR code hasn't been scanned yet
- Visit `http://localhost:3000/qr` and scan
- Wait for "✅ WhatsApp Connected!" message

## 🔒 Security Notes

1. **Keep credentials secret:**
   - `baileys_auth_info/creds.json` contains your WhatsApp session
   - Never share or commit this folder
   - Treat it like a password

2. **Single-user enforcement:**
   - Only `AUTHORIZED_PHONE_NUMBER` can use the bot
   - Other numbers get rejected

3. **Persistent session:**
   - Once connected, you won't need to scan QR again
   - Connection persists across server restarts

## 🚀 Usage

Once connected, send WhatsApp messages like:

```
send 2000 to Mom
check balance
list contacts
add contact John 8012345678
```

The bot will respond with confirmations and execute your requests!

## 🔐 Alternative Pairing Method: Phone Number Code

If QR code fails or you're on a restricted network (VPN, corporate WiFi), use the pairing code method:

### Steps:

1. **Visit the pairing code page:**
   ```
   http://localhost:3000/pairing-code
   ```

2. **Enter your phone number:**
   - Include country code (no + symbol)
   - Example: `2348012345678` for Nigeria
   - No spaces or special characters

3. **Generate code:**
   - Click "Generate Pairing Code"
   - An 8-digit code will appear

4. **On your phone:**
   - Open WhatsApp
   - Go to Settings → Linked Devices
   - Tap "Link a Device"
   - Select "Link with Phone Number Instead"
   - Enter the 8-digit code

5. **Wait for connection:**
   - Should connect within 10-15 seconds
   - Watch for "✅ WhatsApp Connected!" message

### When to Use Pairing Code:

- ✅ QR code fails with 405 error
- ✅ Using VPN or corporate network
- ✅ QR code times out repeatedly
- ✅ Network blocks WhatsApp Web WebSocket
- ✅ Prefer manual code entry over camera scan

## 📊 How It Works

```
1. User sends WhatsApp message
   ↓
2. Baileys receives the message
   ↓
3. commandHandler parses with Groq AI
   ↓
4. Bot executes action (transfer, add contact, etc.)
   ↓
5. Response sent back via WhatsApp
```

## 🎯 Advantages of Baileys

| Feature | Baileys | Official API |
|---------|---------|--------------|
| Cost | FREE ✅ | Paid ❌ |
| Setup | Easy (QR scan) ✅ | Complex (OAuth2) ❌ |
| Approval | None needed ✅ | Meta approval ❌ |
| Messages | Unlimited ✅ | Rate limited ❌ |
| File Support | Yes ✅ | Webhooks only ❌ |

## 🔧 New Features (v6.7.8+)

### Enhanced Connection Management
- ✅ Exponential backoff reconnection (3s → 6s → 12s → 24s)
- ✅ Automatic session backup on successful connection
- ✅ Connection state machine tracking
- ✅ Detailed error categorization

### Network Diagnostics
- ✅ Automatic network type detection (WiFi/Mobile/VPN)
- ✅ WhatsApp server reachability tests
- ✅ Pairing method recommendations based on network

### New Endpoints
- `GET /pairing-code` - Alternative pairing method
- `GET /connection-status` - Detailed connection diagnostics
- `GET /connection-health` - Network health report
- `POST /reset-session` - Force re-pairing
- `GET /session-info` - Session metadata

## 🛠️ Troubleshooting

### QR Code not appearing?
- Make sure server is running: `npm run dev`
- Check terminal output for errors
- Try refreshing `/qr` page
- **NEW:** Try pairing code method: `/pairing-code`

### Connection keeps dropping?
- Make sure your phone's internet is stable
- Restart the server: `Ctrl+C` then `npm run dev`
- Delete `baileys_auth_info/` and scan QR code again
- **NEW:** Check `/connection-health` for network issues

### Not receiving messages?
1. Verify bot number matches `AUTHORIZED_PHONE_NUMBER` in `.env`
2. Check server logs for errors
3. Restart the server
4. **NEW:** Check `/connection-status` for diagnostics

### "WhatsApp not connected" error?
- The QR code hasn't been scanned yet
- Visit `http://localhost:3000/qr` and scan
- Wait for "✅ WhatsApp Connected!" message
- **NEW:** Try pairing code if QR fails: `/pairing-code`

### 405 "Method Not Allowed" / rva errors?
- **FIXED** in Baileys v6.7.8+
- Verify version: `npm list @whiskeysockets/baileys`
- Update if needed: `npm install @whiskeysockets/baileys@latest`
- Try pairing code method as alternative
- Try mobile hotspot instead of WiFi
- Disable VPN temporarily during pairing

### QR Code timeout?
- **NEW:** Automatic retry with exponential backoff
- Watch server logs for retry attempts
- Try mobile hotspot instead of WiFi
- Use pairing code method: `/pairing-code`
- Check `/connection-health` for network blocks

### Session corrupted?
- Reset session: `curl -X POST http://localhost:3000/reset-session`
- Or manually: Delete `baileys_auth_info/` folder
- Restart server and re-pair

For more detailed troubleshooting, see `TROUBLESHOOTING.md`.

## 🔗 Useful Links

- [Baileys GitHub](https://github.com/WhiskeySockets/Baileys)
- [Baileys Documentation](https://github.com/WhiskeySockets/Baileys/blob/master/README.md)
- [WhatsApp Web](https://web.whatsapp.com/)
- [Pairing Fixes Documentation](./PAIRING_FIXES.md)
- [Troubleshooting Guide](./TROUBLESHOOTING.md)

## ⚡ Next Steps

1. ✅ Configure `.env` with your phone number
2. ✅ Run `npm install && npm run dev`
3. ✅ Scan QR code at terminal or `http://localhost:3000/qr`
   - OR use pairing code at `http://localhost:3000/pairing-code`
4. ✅ Send test message to verify
5. ✅ Check `/connection-status` for diagnostics
6. ✅ Deploy to cloud (Heroku, Vercel, Railway, etc.)

---

**Enjoy your free, unlimited WhatsApp bot!** 🎉

**Version:** 2.0 (with Baileys 6.7.8+ enhancements)

