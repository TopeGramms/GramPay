# Deploying GramPay to Render

This guide provides step-by-step instructions for deploying GramPay to [Render](https://render.com).

---

## 1. Prerequisites

Before deploying, ensure you have set up accounts and obtained keys for:
1. **Meta WhatsApp Business Cloud API**:
   - `META_WHATSAPP_TOKEN` (System User Access Token)
   - `META_PHONE_NUMBER_ID`
   - `META_VERIFY_TOKEN` (Any custom secret string you choose, e.g. `grampay_secret_verify_token_2026`)
   - `META_APP_SECRET` (Found in Meta App Settings > Basic)
2. **Supabase**:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (Not the anon key)
3. **Flutterwave**:
   - `FLW_SECRET_KEY`
   - `FLW_PUBLIC_KEY`
   - `FLW_WEBHOOK_SECRET`
4. **Groq AI**:
   - `GROQ_API_KEY`

---

## 2. Deployment Options on Render

### Option A: Using Render Blueprint (Recommended)
1. Push your repository to GitHub / GitLab.
2. In Render Dashboard, click **New +** > **Blueprint**.
3. Connect your repository. Render will automatically detect `render.yaml`.
4. Fill in the environment variable values when prompted.
5. Click **Apply**.

### Option B: Manual Web Service Setup
1. In Render Dashboard, click **New +** > **Web Service**.
2. Connect your Git repository.
3. Configure the following settings:
   - **Name**: `grampay-api`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
4. In the **Environment Variables** tab, add all environment variables listed in `.env.example`.
5. Click **Create Web Service**.

---

## 3. Configuring Meta Cloud API Webhook URL

Once deployed, Render will assign your app a URL (e.g. `https://grampay-api.onrender.com`).

1. Go to your **Meta Developer Portal** (`developers.facebook.com`).
2. Navigate to **WhatsApp** > **Configuration**.
3. Edit the **Webhook URL**:
   - **Callback URL**: `https://grampay-api.onrender.com/webhook`
   - **Verify Token**: Must match your `META_VERIFY_TOKEN` env variable.
4. Click **Verify and Save**.
5. Under **Webhook Fields**, subscribe to `messages`.

---

## 4. Configuring Flutterwave Webhook URL

1. Go to your **Flutterwave Dashboard** (`dashboard.flutterwave.com`).
2. Navigate to **Settings** > **Webhooks**.
3. Set the **URL**: `https://grampay-api.onrender.com/api/flutterwave/webhook`
4. Set the **Secret Hash**: Must match your `FLW_WEBHOOK_SECRET` env variable.
5. Save changes.

---

## 5. Verification

1. Test the health endpoint:
   ```bash
   curl https://grampay-api.onrender.com/health
   ```
   Expect:
   ```json
   {
     "status": "ok",
     "service": "grampay-api",
     "provider": "meta_cloud_api"
   }
   ```
2. Send a WhatsApp test message to your registered business number: `"Hi"` or `"Send 1000 to Mom"`.
