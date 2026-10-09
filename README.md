# WhatsApp AI Money Assistant

A personal AI-powered money transfer assistant that works directly through WhatsApp. Send money from your Opay business wallet using natural language commands.

## Features

- 💬 **Natural Language Interface**: Send money using simple WhatsApp messages like "send 2000 to Mom"
- 🤖 **AI-Powered**: Uses OpenAI GPT to understand your commands
- 👥 **Recipient Management**: Save contacts with nicknames for easy transfers
- 💰 **Opay Integration**: Direct integration with Opay Business API for transfers
- 🔒 **Security**: Optional PIN protection and daily spending limits
- 📊 **Transaction History**: View your recent transfers
- ✅ **Confirmation Flow**: Verify transfers before they execute

## Setup

### 1. Prerequisites

- Node.js 18 or higher
- Opay Business Account
- WhatsApp Business Account with Cloud API access
- OpenAI API key
- Supabase account (already configured)

### 2. Environment Variables

Update the `.env` file with your credentials:

```env
# WhatsApp Cloud API
WHATSAPP_VERIFY_TOKEN=your_custom_verify_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_whatsapp_access_token
WHATSAPP_BUSINESS_ACCOUNT_ID=your_business_account_id

# Your authorized phone number (with country code)
AUTHORIZED_PHONE_NUMBER=2348012345678

# OpenAI API
OPENAI_API_KEY=your_openai_api_key

# Opay Business API
OPAY_MERCHANT_ID=your_merchant_id
OPAY_PUBLIC_KEY=your_public_key
OPAY_PRIVATE_KEY=your_private_key
```

### 3. Installation

```bash
npm install
```

### 4. Run the Server

```bash
npm run dev
```

The server will start on port 3000 (or your configured PORT).

### 5. Configure WhatsApp Webhook

1. Go to your WhatsApp Business App settings
2. Set webhook URL to: `https://your-domain.com/webhook`
3. Set verify token to match your `WHATSAPP_VERIFY_TOKEN`
4. Subscribe to `messages` webhook field

## Usage

Send WhatsApp messages to your bot number:

### Send Money
```
send 2000 to Mom
transfer 5000 to John
```

### Manage Recipients
```
add contact Mom 8012345678
add contact John 8023456789 GTBank
list contacts
delete Mom
```

### Account Information
```
check balance
transaction history
```

### Security
```
set pin 1234
```

### Help
```
help
```

## How It Works

1. **User sends WhatsApp message** to the bot
2. **WhatsApp Cloud API** forwards message to your webhook
3. **AI Parser (OpenAI GPT)** extracts structured command
4. **Bot checks authorization** and validates the request
5. **Recipient lookup** finds saved account details
6. **Confirmation sent** back to user via WhatsApp
7. **User confirms** with "YES"
8. **Opay API executes** the transfer
9. **Confirmation message** sent with transaction reference
10. **Transaction logged** in Supabase database

## Database Schema

### recipients
- Stores nickname-to-account mappings
- Fields: nickname, account_number, bank_name

### transactions
- Logs all transfer attempts
- Fields: amount, recipient, status, opay_reference, timestamp

### bot_config
- Bot settings and security
- Fields: pin, daily_limit, active_status

## Security Features

- **Single-user authorization**: Only your phone number can use the bot
- **PIN protection**: Optional 4-digit PIN before transfers
- **Daily spending limits**: Configurable maximum daily transfer amount
- **Confirmation flow**: Every transfer requires explicit YES confirmation
- **Transaction logging**: Complete audit trail of all operations
- **Account validation**: Validates Nigerian account number format

## API Endpoints

- `GET /webhook` - Webhook verification
- `POST /webhook` - Message handler
- `GET /health` - Health check
- `GET /` - API information

## Troubleshooting

### Webhook not receiving messages
- Check webhook URL is publicly accessible
- Verify verify token matches in WhatsApp settings
- Check webhook subscription includes "messages" field

### Transfers failing
- Verify Opay API credentials are correct
- Check account has sufficient balance
- Ensure account numbers are valid 10-digit Nigerian accounts

### AI not parsing commands
- Verify OpenAI API key is valid
- Check API has sufficient credits
- Review server logs for parsing errors

## Development

The project structure:

```
server/
├── index.js           # Express server and webhook endpoints
├── config.js          # Environment configuration
├── supabase.js        # Database client
├── whatsapp.js        # WhatsApp API integration
├── ai.js              # OpenAI command parser
├── recipients.js      # Recipient management
├── payments.js        # Opay integration and transactions
└── commandHandler.js  # Main command orchestration
```

## Future Enhancements

- Multi-user support with authentication
- Additional bank integrations
- Scheduled/recurring payments
- Budget tracking and analytics
- Receipt generation
- Multiple language support

## Airtime and mobile data beta workflow

The WhatsApp bot now supports an explicit airtime/data purchase flow backed by Flutterwave v3 bill payments. Airtime and data requests are parsed by deterministic code rather than the LLM. Users choose the network (it is never inferred from a phone prefix), review the exact number and current provider catalog price, confirm, and authorize with their PIN on a one-time HTTPS page. PINs are not requested in the bill-purchase chat flow or stored in conversation memory. Data plans are loaded live from Flutterwave and cached for five minutes.

Before testing:

1. Apply `supabase/migrations/20261009120000_airtime_data_purchases.sql` to the project database.
2. Configure `FLW_BILL_PAYMENTS_ENABLED=true`, Flutterwave credentials, and `APP_URL` pointing to the public HTTPS API origin (required for the secure PIN page). Keep the flag `false` outside a controlled test until Flutterwave has enabled bill payments for the account.
3. Confirm with Flutterwave whether bill payments are available with your test credentials. Their current documentation lists funded source balance and server-IP allowlisting as prerequisites. Do not test against a live float unless you intend to spend it.
4. Restart/redeploy the API after changing environment variables.

Example: send `buy airtime 500 MTN 08012345678`, or send `buy data` and follow the prompts. The flow also accepts `airtime`/`data` first and asks for missing details. After submission, use `status <reference>` to re-fetch the provider status. Pending and uncertain outcomes are not reported as successful or failed; a timeout is marked for review and must not be retried under a new reference.

**Important current limitation:** this repository does not yet collect customer funds or maintain a customer wallet/ledger. Purchases debit the configured Flutterwave bill-payment float; the WhatsApp PIN and daily cap authorize/limit the test request but do not charge the user. Do not represent this as a customer-funded wallet or launch it commercially until funding, reconciliation, compliance, and legal structure are implemented and verified.

Provider reference: [Flutterwave Bill Payments](https://developer.flutterwave.com/docs/bill-payment), [Create a bill payment](https://developer.flutterwave.com/reference/create-a-bill-payment), and [Get status of a bill payment](https://developer.flutterwave.com/reference/get-status-of-a-bill-payment).

## License

Private use only - MVP version
