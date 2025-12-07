

# GramPay API Endpoints

This document describes all available REST API endpoints for the WhatsApp Money Assistant server.

## Base URL
```
http://localhost:3000
```

---

## 1. Health & Info Endpoints

### 1.1 Root Info
**GET** `/`

Returns API information and available endpoints.

**Response:**
```json
{
  "service": "WhatsApp Money Assistant API",
  "version": "1.0.0",
  "status": "running",
  "endpoints": { ... }
}
```

---

### 1.2 Health Check
**GET** `/health`

Check if the server is running.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-30T10:00:00.000Z",
  "service": "WhatsApp Money Assistant"
}
```

---

## 2. Recipients API

### 2.1 List All Recipients
**GET** `/api/recipients`

Fetch all saved recipients.

**Response:**
```json
{
  "success": true,
  "message": "📋 Your Recipients:\n\n1. Mom: 8012345678 (Access Bank)\n2. John: 8023456789 (GTBank)",
  "data": [
    {
      "id": "uuid",
      "nickname": "Mom",
      "account_number": "8012345678",
      "bank_name": "Access Bank",
      "created_at": "2025-11-30T10:00:00.000Z",
      "updated_at": "2025-11-30T10:00:00.000Z"
    }
  ]
}
```

---

### 2.2 Add New Recipient
**POST** `/api/recipients`

Add a new recipient to the contact list.

**Request Body:**
```json
{
  "nickname": "Mom",
  "accountNumber": "8012345678",
  "bankName": "Access Bank"
}
```

**Parameters:**
- `nickname` (string, required): Contact name
- `accountNumber` (string, required): 10-digit Nigerian bank account number
- `bankName` (string, optional): Bank name (default: "Unknown Bank")

**Response:**
```json
{
  "success": true,
  "message": "✅ Added Mom: 8012345678 (Access Bank)",
  "data": {
    "id": "uuid",
    "nickname": "Mom",
    "account_number": "8012345678",
    "bank_name": "Access Bank",
    "created_at": "2025-11-30T10:00:00.000Z"
  }
}
```

**Error Response (duplicate):**
```json
{
  "success": false,
  "message": "Recipient \"Mom\" already exists with account 8012345678"
}
```

---

### 2.3 Get Recipient by Nickname
**GET** `/api/recipients/:nickname`

Fetch a specific recipient by nickname.

**Parameters:**
- `nickname` (string, path): Contact nickname (case-insensitive)

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "nickname": "Mom",
    "account_number": "8012345678",
    "bank_name": "Access Bank",
    "created_at": "2025-11-30T10:00:00.000Z"
  }
}
```

**Error Response (not found):**
```json
{
  "success": false,
  "message": "Recipient \"Mom\" not found"
}
```

---

### 2.4 Update Recipient
**PUT** `/api/recipients/:nickname`

Update an existing recipient's details.

**Parameters:**
- `nickname` (string, path): Current contact nickname

**Request Body:**
```json
{
  "accountNumber": "8023456789",
  "bankName": "GTBank"
}
```

**Response:**
```json
{
  "success": true,
  "message": "✅ Updated Mom",
  "data": {
    "id": "uuid",
    "nickname": "Mom",
    "account_number": "8023456789",
    "bank_name": "GTBank",
    "updated_at": "2025-11-30T10:00:00.000Z"
  }
}
```

---

### 2.5 Delete Recipient
**DELETE** `/api/recipients/:nickname`

Remove a recipient from the contact list.

**Parameters:**
- `nickname` (string, path): Contact nickname

**Response:**
```json
{
  "success": true,
  "message": "✅ Deleted recipient: Mom"
}
```

---

## 3. Balance & Account API

### 3.1 Check Account Balance
**GET** `/api/balance`

Check your current Opay account balance.

**Response (Success):**
```json
{
  "success": true,
  "balance": 50000.00,
  "currency": "NGN",
  "message": "Balance: ₦50,000.00"
}
```

**Response (Error):**
```json
{
  "success": false,
  "message": "Failed to retrieve balance",
  "error": { ... }
}
```

---

## 4. Transactions API

### 4.1 List Transactions
**GET** `/api/transactions?limit=10`

Fetch transaction history.

**Query Parameters:**
- `limit` (integer, optional): Number of recent transactions to return (default: 10)

**Response:**
```json
{
  "success": true,
  "message": "📊 Recent Transactions:\n\n1. ✅ ₦2,000 to Mom - 11/30/2025, 10:00 AM\n2. ✅ ₦5,000 to John - 11/30/2025, 9:30 AM",
  "data": [
    {
      "id": "uuid",
      "amount": 2000.00,
      "recipient_nickname": "Mom",
      "account_number": "8012345678",
      "bank_name": "Access Bank",
      "status": "completed",
      "opay_reference": "OPY_20251130_123456",
      "message_from_user": "send 2000 to Mom",
      "error_message": null,
      "created_at": "2025-11-30T10:00:00.000Z"
    }
  ]
}
```

---

### 4.2 Get Today's Total Spent
**GET** `/api/transactions/daily-total`

Calculate total amount transferred today.

**Response:**
```json
{
  "success": true,
  "amount": 7000.00,
  "currency": "NGN"
}
```

---

## 5. Bot Configuration API

### 5.1 Get Configuration
**GET** `/api/config`

Fetch bot configuration settings.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "pin": "1234",
    "daily_limit": 100000,
    "active_status": true,
    "created_at": "2025-11-30T10:00:00.000Z",
    "updated_at": "2025-11-30T10:00:00.000Z"
  }
}
```

---

### 5.2 Update Configuration
**PUT** `/api/config`

Update bot settings (PIN, daily limit, active status).

**Request Body:**
```json
{
  "pin": "5678",
  "daily_limit": 50000,
  "active_status": true
}
```

**Parameters:**
- `pin` (string, optional): 4-digit PIN code
- `daily_limit` (number, optional): Daily transfer limit in Naira
- `active_status` (boolean, optional): Enable/disable bot

**Response:**
```json
{
  "success": true,
  "message": "Config updated successfully",
  "data": {
    "id": "uuid",
    "pin": "5678",
    "daily_limit": 50000,
    "active_status": true,
    "updated_at": "2025-11-30T10:00:00.000Z"
  }
}
```

**Error Response (invalid PIN):**
```json
{
  "success": false,
  "message": "PIN must be exactly 4 digits"
}
```

---

## 6. WhatsApp Webhook Endpoints

### 6.1 Webhook Verification
**GET** `/webhook`

WhatsApp Cloud API calls this to verify the webhook URL.

**Query Parameters:**
- `hub.mode` (string): "subscribe"
- `hub.verify_token` (string): Must match `WHATSAPP_VERIFY_TOKEN`
- `hub.challenge` (string): Challenge string to echo back

**Response:**
- Status `200`: Echo back the challenge string
- Status `403`: Verification failed

---

### 6.2 Webhook Handler
**POST** `/webhook`

WhatsApp Cloud API sends incoming messages to this endpoint.

**Request Body:**
```json
{
  "object": "whatsapp_business_account",
  "entry": [
    {
      "id": "...",
      "changes": [
        {
          "value": {
            "messaging_product": "whatsapp",
            "messages": [
              {
                "from": "2348012345678",
                "id": "wamid.xxx",
                "timestamp": "1230228000",
                "text": {
                  "body": "send 2000 to Mom"
                },
                "type": "text"
              }
            ]
          }
        }
      ]
    }
  ]
}
```

**Response:**
- Status `200`: Message processed
- Status `500`: Internal error

---

## Error Handling

All API endpoints return error responses in the following format:

```json
{
  "success": false,
  "message": "Error description",
  "error": "Additional error details (optional)"
}
```

### Common HTTP Status Codes
- `200`: Success
- `400`: Bad request (missing/invalid parameters)
- `404`: Resource not found
- `500`: Server error

---

## Example Usage

### Using cURL

```bash
# Get all recipients
curl http://localhost:3000/api/recipients

# Add a new recipient
curl -X POST http://localhost:3000/api/recipients \
  -H "Content-Type: application/json" \
  -d '{
    "nickname": "Mom",
    "accountNumber": "8012345678",
    "bankName": "Access Bank"
  }'

# Check balance
curl http://localhost:3000/api/balance

# Get transactions
curl http://localhost:3000/api/transactions?limit=5

# Update config
curl -X PUT http://localhost:3000/api/config \
  -H "Content-Type: application/json" \
  -d '{
    "daily_limit": 50000,
    "active_status": true
  }'
```

### Using JavaScript/Fetch

```javascript
// List recipients
const recipients = await fetch('http://localhost:3000/api/recipients')
  .then(res => res.json());

// Add recipient
const newRecipient = await fetch('http://localhost:3000/api/recipients', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    nickname: 'Mom',
    accountNumber: '8012345678',
    bankName: 'Access Bank'
  })
}).then(res => res.json());

// Check balance
const balance = await fetch('http://localhost:3000/api/balance')
  .then(res => res.json());

// Get transactions
const transactions = await fetch('http://localhost:3000/api/transactions?limit=10')
  .then(res => res.json());
```

---

## Authentication

Currently, the API has **no authentication** (suitable for local/private use). For production:
- Implement JWT or API key authentication
- Add CORS middleware
- Use environment-specific API keys
- Consider OAuth2 for WhatsApp integration

---

## Rate Limiting

No rate limiting is currently implemented. For production, consider:
- Limiting requests per IP/user
- Implementing backoff strategies
- Adding request quotas

---

## CORS Headers

Cross-Origin Resource Sharing is not configured by default. Add CORS middleware if accessing from a different domain:

```javascript
import cors from 'cors';
app.use(cors());
```

---

## Environment Variables

Make sure the following are set in your `.env` file:

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_ANON_KEY=xxx
WHATSAPP_PHONE_NUMBER_ID=xxx
WHATSAPP_ACCESS_TOKEN=xxx
WHATSAPP_VERIFY_TOKEN=xxx
OPENAI_API_KEY=xxx
OPAY_MERCHANT_ID=xxx
OPAY_PUBLIC_KEY=xxx
OPAY_PRIVATE_KEY=xxx
AUTHORIZED_PHONE_NUMBER=2348012345678
PORT=3000
```
