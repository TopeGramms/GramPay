import { Router } from 'express';
import { commandHandler } from '../core/commandHandler.js';
import { logger } from '../lib/logger.js';

const router = Router();

function setPrivateHeaders(res) {
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    Pragma: 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  });
}

function renderPage({ token, message = '', status = 200 }) {
  const safeToken = /^[A-Za-z0-9_-]{40,60}$/.test(token || '') ? token : '';
  const body = safeToken
    ? `<p>Confirm this airtime or data purchase using your GramPay PIN.</p>
       <form method="post" action="/api/bill-auth/${safeToken}">
         <label for="pin">4-digit PIN</label>
         <input id="pin" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" minlength="4" maxlength="4" autocomplete="off" required autofocus>
         <button type="submit">Authorize purchase</button>
       </form>
       <p class="hint">This one-time link expires in five minutes. Your PIN is sent only over HTTPS and is not saved in this page or WhatsApp chat.</p>`
    : `<p>${message || 'This authorization link is invalid or has expired. Return to WhatsApp and start again.'}</p>`;

  return { status, html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>GramPay secure authorization</title>
<style>
  body{font:16px/1.5 system-ui,sans-serif;background:#f4f7fb;color:#162033;margin:0;min-height:100vh;display:grid;place-items:center}
  main{box-sizing:border-box;background:#fff;border:1px solid #dfe5ee;border-radius:16px;padding:28px;width:min(92vw,420px);box-shadow:0 12px 40px #18243a12}
  h1{font-size:1.35rem;margin:0 0 8px}p{color:#48556a}label{display:block;font-weight:600;margin:20px 0 8px}
  input{box-sizing:border-box;width:100%;padding:14px;border:1px solid #aeb9c9;border-radius:8px;font-size:1.2rem;letter-spacing:.3em}
  button{width:100%;margin-top:16px;padding:14px;border:0;border-radius:8px;background:#1457d9;color:white;font-weight:700;font-size:1rem}
  .hint{font-size:.85rem;margin-top:18px}
</style></head><body><main><h1>GramPay secure authorization</h1>${body}</main></body></html>` };
}

router.get('/api/bill-auth/:token', (req, res) => {
  setPrivateHeaders(res);
  const token = req.params.token;
  if (!commandHandler.isBillAuthorizationTokenActive(token)) {
    const page = renderPage({ token: '', status: 404 });
    return res.status(page.status).type('html').send(page.html);
  }
  const page = renderPage({ token });
  return res.status(page.status).type('html').send(page.html);
});

router.post('/api/bill-auth/:token', async (req, res, next) => {
  setPrivateHeaders(res);
  const token = req.params.token;
  try {
    const result = await commandHandler.authorizeBillPurchase(token, req.body?.pin);
    if (result.ok) {
      return res.status(200).type('html').send(renderPage({ token: '', message: 'Authorization received. Return to WhatsApp for the purchase status.' }).html);
    }

    const message = result.reason === 'incorrect_pin'
      ? 'The PIN was not accepted. Review it and submit again; the link allows up to three attempts.'
      : result.reason === 'unavailable'
        ? 'Authorization could not be verified right now. Return to WhatsApp and try again later.'
        : result.reason === 'invalid_pin_format'
          ? 'Enter exactly four digits.'
          : result.reason === 'locked'
            ? 'Too many attempts. The purchase was cancelled; return to WhatsApp to start again.'
            : 'This authorization link is invalid, expired, or already used. Return to WhatsApp and start again.';
    const page = renderPage({ token: '', message, status: result.reason === 'incorrect_pin' || result.reason === 'invalid_pin_format' ? 400 : 410 });
    return res.status(page.status).type('html').send(page.html);
  } catch (error) {
    logger.error({ path: req.path, error: error.message }, 'Secure bill authorization endpoint failed');
    return next(error);
  }
});

export default router;