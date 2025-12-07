# 🚂 Railway Deployment Guide

This guide will help you deploy your WhatsApp Money Assistant to Railway.

## Prerequisites
-   A [Railway](https://railway.app/) account (GitHub login recommended).
-   Your project pushed to GitHub.

## Step 1: Create Project on Railway
1.  Go to your [Railway Dashboard](https://railway.app/dashboard).
2.  Click **New Project** → **Deploy from GitHub repo**.
3.  Select your `Grampay` repository.
4.  Click **Deploy Now**.

## Step 2: Configure Environment Variables
Railway needs your secrets to run the bot.
1.  Click on your project card in Railway.
2.  Go to the **Variables** tab.
3.  Add the following variables (copy values from your local `.env`):
    -   `SUPABASE_URL`
    -   `SUPABASE_ANON_KEY`
    -   `AUTHORIZED_PHONE_NUMBER`
    -   `GROQ_API_KEY`
    -   `OPAY_MERCHANT_ID`
    -   `OPAY_PUBLIC_KEY`
    -   `OPAY_PRIVATE_KEY`
    -   `OPAY_API_BASE_URL` (set to `https://api.opay.com` or your specific URL)
    -   `NODE_ENV` (set to `production`)

## Step 3: Configure Persistent Storage (Crucial!)
To avoid scanning the QR code every time you deploy, you need a **Volume**.
1.  Go to the **Settings** tab of your service.
2.  Scroll down to **Service Domains** (optional, but good for webhooks).
3.  Scroll to **Storage** (or "Volumes").
4.  Click **Add Volume**.
5.  Mount Path: `/app/baileys_auth_info`
    -   *Note: Railway mounts volumes at absolute paths. Since our code uses `process.cwd()`, we need to make sure it aligns. By default, Railway app code is in `/app`.*

## Step 4: Connect WhatsApp
1.  Once deployed, go to the **Deployments** tab.
2.  Click on the latest deployment to see the **Logs**.
3.  You will see the QR code in the logs (text format).
4.  Scan it with your phone (Linked Devices).
5.  **OR**: If you set up a domain in Step 3 (e.g., `grampay.up.railway.app`), visit `https://grampay.up.railway.app/qr` to see the QR code visually.

## Step 5: Set Webhook
1.  Get your Railway domain (e.g., `https://grampay.up.railway.app`).
2.  Your OPay Webhook URL is: `https://grampay.up.railway.app/api/payment-webhook`.
3.  Add this to your OPay Merchant Dashboard.
