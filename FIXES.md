Fixes Applied

## Summary

### Root Cause
The codebase had **two competing Baileys initializers** running in parallel:
1. Root `index.js` — standalone socket startup
2. `server/whatsapp.js` — Express-integrated service

This caused socket conflicts, duplicate QR codes, and race conditions on every restart, leading to repeated `405 / rva` pairing failures.

### Changes Made

#### 1. **Consolidated Baileys Initialization**
- Renamed root `index.js` → `index.standalone.js` (removed from auto-run path)
- Now **only** `server/whatsapp.js` manages the WhatsApp socket (with robust error handling, reconnection logic, and QR management)

#### 2. **Single Entry Point**
- `server-simple.js` now explicitly documents and enforces the sole boot path: `./server/index.js`
- Prevents accidental dual initialization
- Added clear comments to prevent future confusion

#### 3. **Environment Validation**
- Added startup validation in `server/config.js` to check for required env vars
- Fails fast with a clear error message if credentials are missing
- Prevents silent hangs and confusing runtime errors

#### 4. **Env Example**
- `.env.example` already existed and is well-documented
- Copy it to `.env` and fill in your actual Supabase, Groq, OPay, and WhatsApp credentials

## How to Run

```powershell
# 1. Copy env template
Copy-Item .env.example .env

# 2. Edit .env with your actual credentials
# (open in your editor and fill in all required values)

# 3. Start the dev server
cd "c:\Users\DELL\OneDrive\Desktop\Grampay\Grampay"
npm run dev
```

## What Happens on Startup
1. `npm run dev` → `server-simple.js` (sole entry point)
2. Loads `server/index.js` → Express API starts
3. Loads `server/whatsapp.js` → Baileys initializes with QR generation
4. Visit `http://localhost:3000/qr` to scan and pair WhatsApp
5. Scan with your phone's camera → WhatsApp Web links
6. API endpoints and WhatsApp integration are now ready

## Troubleshooting

### "405 Method Not Allowed / rva" during pairing
- Try connecting via **mobile hotspot** instead of Wi-Fi
- Temporarily disable VPN/firewall during initial pairing
- Some ISPs block WhatsApp Web socket routes; hotspot often bypasses this

### Missing environment variables error
- Copy `.env.example` to `.env`
- Fill in **all** required values (Supabase, Groq, OPay, phone number)
- Restart with `npm run dev`

### Socket connection hangs
- Ensure your authorized phone number matches the WhatsApp account scanning the QR
- Wait up to 30 seconds for initial pairing
- Check server logs for explicit error messages (no longer silent failures)