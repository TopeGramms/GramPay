# GramPay Troubleshooting Guide

## 🔍 Quick Diagnosis

Use this decision tree to identify and fix your issue:

```
Is the server starting?
├─ NO → See "Server Won't Start"
└─ YES
    │
    Is QR code appearing?
    ├─ NO → See "QR Code Issues"
    └─ YES
        │
        Can you scan the QR?
        ├─ NO (405 error) → See "405 Pairing Errors"
        ├─ NO (timeout) → See "QR Timeout Issues"
        └─ YES
            │
            Does it stay connected?
            ├─ NO → See "Connection Drops"
            └─ YES → ✅ All working!
```

---

## 🚨 Common Issues

### Server Won't Start

**Symptoms:**
- Error on `npm run dev`
- "Module not found" errors
- Port already in use

**Solutions:**

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Check Node.js version:**
   ```bash
   node --version  # Should be 18.0.0 or higher
   ```

3. **Port conflict:**
   ```bash
   # Kill process on port 3000
   netstat -ano | findstr :3000
   taskkill /PID <PID> /F
   ```

4. **Environment variables missing:**
   ```bash
   # Copy example env file
   copy .env.example .env
   # Edit .env and fill in your credentials
   ```

---

### QR Code Issues

#### QR Code Not Appearing

**Symptoms:**
- Page shows "Generating QR Code..."
- Spinner keeps spinning
- No QR after 30+ seconds

**Solutions:**

1. **Check server logs:**
   - Look for initialization errors
   - Check for "WhatsApp service initialized" message

2. **Try pairing code instead:**
   - Visit `http://localhost:3000/pairing-code`
   - Enter your phone number
   - Use the 8-digit code

3. **Check network connectivity:**
   ```bash
   curl http://localhost:3000/connection-health
   ```

4. **Restart server:**
   ```bash
   # Press Ctrl+C to stop
   npm run dev
   ```

#### QR Code Appears but Won't Scan

**Symptoms:**
- QR code visible
- Phone camera won't recognize it
- WhatsApp says "Invalid QR"

**Solutions:**

1. **Ensure QR is clear:**
   - Zoom in on the QR code
   - Increase screen brightness
   - Clean your phone camera

2. **Check WhatsApp app version:**
   - Update WhatsApp to latest version
   - Restart WhatsApp app

3. **Try different device:**
   - Use tablet/iPad if available
   - Try on different phone

4. **Use pairing code method:**
   - More reliable alternative
   - Visit `/pairing-code`

---

### 405 Pairing Errors

**Symptoms:**
- "405 Method Not Allowed" in logs
- "rva method" errors
- QR scan fails immediately

**Root Cause:**
- Outdated Baileys library (FIXED in latest version)

**Solutions:**

1. **Verify Baileys version:**
   ```bash
   npm list @whiskeysockets/baileys
   # Should show 6.7.8 or higher
   ```

2. **Update if needed:**
   ```bash
   npm install @whiskeysockets/baileys@latest
   npm install
   ```

3. **Try pairing code method:**
   - Works better on restricted networks
   - Visit `/pairing-code`

4. **Network troubleshooting:**
   - Disable VPN temporarily
   - Try mobile hotspot instead of WiFi
   - Check firewall settings

---

### QR Timeout Issues

**Symptoms:**
- QR code appears
- Scan succeeds initially
- Connection times out before completing
- "Connection closed" after scan

**Solutions:**

1. **Wait for automatic retry:**
   - New implementation uses exponential backoff
   - Will retry automatically: 3s, 6s, 12s, 24s...
   - Watch server logs for retry attempts

2. **Check network stability:**
   ```bash
   curl http://localhost:3000/connection-health
   ```

3. **Try mobile hotspot:**
   - Some WiFi networks block WhatsApp Web
   - Mobile data often more reliable
   - Disable VPN if active

4. **Use pairing code:**
   - More stable on problematic networks
   - Visit `/pairing-code`

5. **Check phone internet:**
   - Ensure phone has stable connection
   - Try switching between WiFi/mobile data

---

### Connection Drops

**Symptoms:**
- Connects successfully
- Disconnects after few minutes
- Constant reconnection attempts
- "Connection lost" messages

**Solutions:**

1. **Check automatic reconnection:**
   - Server should reconnect automatically
   - Watch logs for reconnection attempts
   - Should succeed within 60 seconds

2. **Verify session persistence:**
   ```bash
   curl http://localhost:3000/session-info
   ```

3. **Check network stability:**
   - Ping test: `ping 8.8.8.8 -t`
   - Check for packet loss
   - Verify router stability

4. **Phone internet stability:**
   - Ensure phone stays connected
   - Disable battery optimization for WhatsApp
   - Keep WhatsApp running in background

5. **ISP blocking:**
   - Some ISPs throttle WhatsApp Web
   - Try different network
   - Use mobile hotspot
   - Contact ISP support

---

### Session Issues

#### Session Corrupted

**Symptoms:**
- Can't connect even after scan
- "Invalid session" errors
- "Session validation failed"

**Solutions:**

1. **Check session status:**
   ```bash
   curl http://localhost:3000/session-info
   ```

2. **Reset session:**
   ```bash
   curl -X POST http://localhost:3000/reset-session
   ```

3. **Manual cleanup:**
   ```bash
   # Stop server (Ctrl+C)
   # Delete session folder
   rm -rf baileys_auth_info
   # Restart server
   npm run dev
   ```

4. **Re-pair:**
   - Visit `/qr` or `/pairing-code`
   - Complete pairing process

#### Session Won't Persist

**Symptoms:**
- Need to scan QR every restart
- Session doesn't save
- `baileys_auth_info` folder empty

**Solutions:**

1. **Check folder permissions:**
   - Ensure write permissions
   - Check folder exists: `baileys_auth_info/`

2. **Check disk space:**
   ```bash
   # Windows
   wmic logicaldisk get size,freespace,caption
   ```

3. **Verify session backup:**
   ```bash
   curl http://localhost:3000/session-info
   ```

4. **Check for errors:**
   - Review server logs
   - Look for "creds.update" errors

---

### Pairing Code Issues

#### Code Not Generated

**Symptoms:**
- Form submitted but no code appears
- Error message shown
- Page doesn't reload

**Solutions:**

1. **Check phone number format:**
   - Must include country code
   - No + symbol
   - No spaces or dashes
   - Example: `2348012345678` (Nigeria)

2. **Check server logs:**
   - Look for pairing code errors
   - Verify initialization succeeded

3. **Try QR code instead:**
   - Visit `/qr`
   - May work better on your network

#### Code Rejected by WhatsApp

**Symptoms:**
- Code generated successfully
- WhatsApp says "Invalid code"
- Can't complete pairing

**Solutions:**

1. **Request new code:**
   - Codes expire after ~60 seconds
   - Refresh page and try again

2. **Verify WhatsApp version:**
   - Update to latest WhatsApp
   - Pairing code requires recent version

3. **Check phone number:**
   - Must match WhatsApp account number
   - Include country code correctly

4. **Try QR code:**
   - May be more compatible
   - Visit `/qr`

---

## 🔧 Advanced Troubleshooting

### Enable Debug Logging

Add to `.env`:
```env
LOG_LEVEL=debug
```

Restart server to see detailed logs.

### Check Connection Diagnostics

```bash
# Full diagnostics
curl http://localhost:3000/connection-status

# Network health
curl http://localhost:3000/connection-health

# Session info
curl http://localhost:3000/session-info
```

### Monitor Connection State

Watch server logs for state transitions:
```
DISCONNECTED → CONNECTING → QR_READY → CONNECTED
```

### Test Network Connectivity

```bash
# Test WhatsApp servers
curl https://web.whatsapp.com

# Test WebSocket capability
curl http://localhost:3000/connection-health
```

### Backup and Restore Session

**Backup:**
```bash
# Session automatically backed up on successful connection
# Manual backup:
curl http://localhost:3000/session-info
```

**Restore:**
```bash
# If session corrupted, restore from backup
# Copy baileys_auth_backup/* to baileys_auth_info/
```

---

## 📊 Error Code Reference

| Error Code | Meaning | Solution |
|------------|---------|----------|
| 405 | Method not allowed | Update Baileys, try pairing code |
| 401 | Unauthorized | Session expired, re-pair |
| 408 | Timeout | Network issue, retry with backoff |
| 500 | Server error | Check logs, restart server |
| 503 | Service unavailable | WhatsApp servers down, wait |

---

## 🆘 Still Having Issues?

If none of the above solutions work:

1. **Collect diagnostic info:**
   ```bash
   # Save diagnostics to file
   curl http://localhost:3000/connection-status > diagnostics.json
   curl http://localhost:3000/connection-health >> diagnostics.json
   ```

2. **Check server logs:**
   - Copy last 50 lines of console output
   - Look for ERROR or WARN messages

3. **Try clean install:**
   ```bash
   # Backup your .env file
   copy .env .env.backup
   
   # Clean install
   rm -rf node_modules
   rm package-lock.json
   npm install
   
   # Restore .env
   copy .env.backup .env
   
   # Start fresh
   npm run dev
   ```

4. **Test on different environment:**
   - Try different computer
   - Try different network
   - Try different phone

5. **Verify prerequisites:**
   - Node.js 18+ installed
   - WhatsApp installed on phone
   - Phone has internet connection
   - No firewall blocking ports

---

## ✅ Prevention Checklist

To avoid future issues:

- [ ] Keep Baileys updated: `npm update @whiskeysockets/baileys`
- [ ] Monitor connection health regularly
- [ ] Backup session after successful pairing
- [ ] Use stable network for pairing
- [ ] Keep WhatsApp app updated on phone
- [ ] Don't commit `baileys_auth_info/` to git
- [ ] Set up proper error monitoring
- [ ] Test both QR and pairing code methods
- [ ] Document your network setup
- [ ] Keep server logs for debugging

---

## 📚 Useful Commands

```bash
# Start server
npm run dev

# Check Baileys version
npm list @whiskeysockets/baileys

# Update dependencies
npm update

# Clean install
rm -rf node_modules && npm install

# Check port usage
netstat -ano | findstr :3000

# Test endpoints
curl http://localhost:3000/status
curl http://localhost:3000/qr
curl http://localhost:3000/pairing-code
curl http://localhost:3000/connection-status
curl http://localhost:3000/connection-health

# Reset session
curl -X POST http://localhost:3000/reset-session

# Session info
curl http://localhost:3000/session-info
```

---

**Last Updated:** December 2, 2024  
**Version:** 1.0  
**For:** GramPay WhatsApp Money Assistant
