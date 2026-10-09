import { randomBytes, randomUUID } from 'crypto';
import { aiService } from '../services/ai.js';
import { whatsappService } from '../services/whatsappCloud.js';
import { paymentService } from '../services/payment.js';
import { recipientService } from '../services/recipient.js';
import { transactionService } from '../services/transaction.js';
import { billTransactionService } from '../services/billTransaction.js';
import { PinService } from '../services/pin.js';
import { userContextService } from './userContext.js';
import { conversationMemory } from '../services/conversationMemory.js';
import { PersistentSessionStore } from '../services/conversationSessions.js';
import { CONSTANTS } from '../config/constants.js';
import { logger } from '../lib/logger.js';

// Persist multi-turn state across server restarts, while keeping PIN material process-local.
const pendingSessions = new PersistentSessionStore({ ttlMs: CONSTANTS.CONFIRMATION_TTL_MS });
const billAuthChallenges = new Map();

const MOBILE_NETWORKS = ['mtn', 'airtel', 'glo', '9mobile'];

function normalizeNetwork(text) {
  const lower = String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  if (/\b(9\s*mobile|etisalat)\b/.test(lower)) return '9mobile';
  if (/\b(mtn)\b/.test(lower)) return 'mtn';
  if (/\b(airtel)\b/.test(lower)) return 'airtel';
  if (/\b(glo|globacom)\b/.test(lower)) return 'glo';
  return null;
}

function normalizeNigerianPhone(text) {
  const match = String(text || '').match(/(?:\+?234[\s-]?[789](?:[\s-]?\d){9}|0[789](?:[\s-]?\d){9}|[789](?:[\s-]?\d){9})/);
  if (!match) return null;
  const digits = match[0].replace(/\D/g, '');
  if (digits.startsWith('234') && digits.length === 13) return `+${digits}`;
  if (digits.startsWith('0') && digits.length === 11) return `+234${digits.slice(1)}`;
  if (digits.length === 10) return `+234${digits}`;
  return null;
}

function extractAmount(text) {
  const withoutPhone = String(text || '').replace(/(?:\+?234[\s-]?[789](?:[\s-]?\d){9}|0[789](?:[\s-]?\d){9}|[789](?:[\s-]?\d){9})/g, ' ');
  const match = withoutPhone.match(/(?:NGN|₦)?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(k|thousand)?\b/i);
  if (!match) return null;
  let amount = Number(match[1].replace(/,/g, ''));
  if (/^(k|thousand)$/i.test(match[2] || '')) amount *= 1000;
  return Number.isFinite(amount) ? amount : null;
}

function redactPersonalNumbers(text) {
  return String(text || '')
    .replace(/\/api\/bill-auth\/[A-Za-z0-9_-]{40,60}/g, '/api/bill-auth/[REDACTED]')
    .replace(/\bpin(?:\s+is|\s*[:=])?\s*\d{4}\b/gi, 'PIN ****')
    .replace(/(?:\+?234[\s-]?[789](?:[\s-]?\d){9}|0[789](?:[\s-]?\d){9}|\b\d{10}\b)/g, value => `******${value.replace(/\D/g, '').slice(-4)}`);
}

export class CommandHandler {
  /**
   * Helper to send response via WhatsApp and persist into conversation memory
   */
  async sendReply(to, text, buttons = null) {
    const cleanTo = String(to).replace(/\D/g, '');

    // Persist assistant message in long-term conversation history
    await conversationMemory.recordMessage({
      phone: cleanTo,
      role: 'assistant',
      content: redactPersonalNumbers(text),
      metadata: buttons ? { buttons: buttons.map(b => b.title) } : {},
    }).catch(() => {});

    if (buttons && Array.isArray(buttons) && buttons.length > 0) {
      return whatsappService.sendInteractiveButtons(cleanTo, text, buttons);
    }
    return whatsappService.sendMessage(cleanTo, text);
  }

  /**
   * Check if a user has completed the onboarding journey.
   * A user is only fully onboarded if they completed the steps
   * and have both a display name and a pin hash.
   */
  isUserOnboarded(user) {
    if (!user) return false;
    if (user.onboarding_step === CONSTANTS.ONBOARDING_STEPS.COMPLETED) {
      return true;
    }
    if (user.display_name && user.pin_hash) {
      return true;
    }
    return false;
  }

  restoreOnboardingSession(user) {
    const onboardingStateByStep = {
      [CONSTANTS.ONBOARDING_STEPS.AWAITING_NAME]: 'ONBOARDING_AWAITING_NAME',
      [CONSTANTS.ONBOARDING_STEPS.SETTING_PIN_FIRST]: 'ONBOARDING_SETTING_PIN',
      [CONSTANTS.ONBOARDING_STEPS.CONFIRMING_NEW_PIN]: 'ONBOARDING_SETTING_PIN',
      [CONSTANTS.ONBOARDING_STEPS.OFFER_BENEFICIARY]: 'ONBOARDING_OFFER_BENEFICIARY',
      [CONSTANTS.ONBOARDING_STEPS.AWAITING_BENEFICIARY_NICKNAME]: 'ONBOARDING_BENEFICIARY_NICKNAME',
      [CONSTANTS.ONBOARDING_STEPS.AWAITING_BENEFICIARY_ACCOUNT]: 'ONBOARDING_BENEFICIARY_NICKNAME',
      [CONSTANTS.ONBOARDING_STEPS.AWAITING_BENEFICIARY_BANK]: 'ONBOARDING_BENEFICIARY_NICKNAME',
    };
    const state = onboardingStateByStep[user?.onboarding_step];
    if (!state) return null;

    // The beneficiary's details and a PIN-confirmation candidate are not reconstructed from the profile row.
    // Restart at the earliest step that can safely continue without missing or secret data.
    if (state === 'ONBOARDING_BENEFICIARY_NICKNAME') {
      userContextService.updateOnboardingStep(user.phone_number, CONSTANTS.ONBOARDING_STEPS.AWAITING_BENEFICIARY_NICKNAME).catch(() => {});
    }
    return {
      state,
      displayName: user.display_name || null,
      timestamp: Date.now(),
    };
  }

  async resumeOnboarding(from, user, session) {
    const name = user.display_name ? `, ${user.display_name}` : '';
    const prompts = {
      ONBOARDING_SETTING_PIN: `Welcome back${name}. Please create a new 4-digit PIN to continue setup.`,
      ONBOARDING_OFFER_BENEFICIARY: `Welcome back${name}. Your name and PIN are saved. Would you like to save a beneficiary now?`,
      ONBOARDING_BENEFICIARY_NICKNAME: `Welcome back${name}. What nickname would you like to give the beneficiary?`,
    };
    const text = prompts[session.state] || 'Welcome back. Let’s continue setting up your account.';
    if (session.state === 'ONBOARDING_OFFER_BENEFICIARY') {
      await this.sendReply(from, text, [
        { id: 'btn_beneficiary_yes', title: 'Yes, save one' },
        { id: 'btn_beneficiary_skip', title: 'Skip for now' },
      ]);
      return;
    }
    await this.sendReply(from, text);
  }

  /**
   * Main entry point for incoming WhatsApp messages
   */
  async handleMessage({ from, text, messageId }) {
    if (!text || typeof text !== 'string') return;

    // Mark message as read
    if (messageId) {
      whatsappService.markAsRead(messageId).catch(() => {});
    }

    const cleanFrom = from.replace(/\D/g, '');
    const cleanText = text.trim();
    const isPotentialPin = /^\d{4}$/.test(cleanText);
    const logText = isPotentialPin ? '****' : redactPersonalNumbers(cleanText);
    logger.info({ from: cleanFrom, text: logText }, '📩 Processing incoming WhatsApp message');

    // Persist incoming user message into long-term conversation memory
    if (!isPotentialPin) {
      await conversationMemory.recordMessage({
        phone: cleanFrom,
        role: 'user',
        content: redactPersonalNumbers(cleanText),
      }).catch(() => {});
    }

    // 1. Resolve User Context
    const user = await userContextService.resolveUser(cleanFrom);
    // Support both legacy `is_active` (bool) and new `status` ('frozen') field
    const isInactive = !user || user.status === 'frozen' || user.is_active === false;
    if (isInactive) {
      await this.sendReply(cleanFrom, '⚠️ Your account is currently inactive. Please contact support.');
      return;
    }

    const lower = cleanText.toLowerCase().trim();

    // Restarting chat must never erase a user's saved name or PIN hash.
    if (lower === 'restart') {
      pendingSessions.delete(cleanFrom);
      if (this.isUserOnboarded(user)) {
        await this.sendHomeMenu(cleanFrom, user);
      } else {
        const onboardingSession = this.restoreOnboardingSession(user);
        if (onboardingSession) {
          pendingSessions.set(cleanFrom, onboardingSession);
          await this.resumeOnboarding(cleanFrom, user, onboardingSession);
        } else {
          await this.handleOnboardingEntry(cleanFrom, cleanText, user);
        }
      }
      return;
    }

    // Account reset is destructive, so require an explicit confirmation.
    if (['reset', 'reset account'].includes(lower)) {
      pendingSessions.set(cleanFrom, { state: 'CONFIRM_ACCOUNT_RESET', timestamp: Date.now() });
      await this.sendReply(cleanFrom, 'Reset your account setup? This permanently clears your saved name and PIN hash.', [
        { id: 'btn_confirm_reset', title: 'Reset account' },
        { id: 'btn_cancel_reset', title: 'Keep my account' },
      ]);
      return;
    }

    // 3. Check for Active Multi-Step Session
    let activeSession = await pendingSessions.load(cleanFrom);
    if (!activeSession && !this.isUserOnboarded(user)) {
      activeSession = this.restoreOnboardingSession(user);
      if (activeSession) {
        pendingSessions.set(cleanFrom, activeSession);
      }
    }

    if (activeSession) {
      // Check session expiry (5 minutes)
      if (Date.now() - activeSession.timestamp > CONSTANTS.CONFIRMATION_TTL_MS) {
        pendingSessions.delete(cleanFrom);
        await this.sendReply(cleanFrom, '⏳ Session timed out. Let\'s start your request again.');
        return;
      }

      // Check if session is an onboarding step
      if (activeSession.state && activeSession.state.startsWith('ONBOARDING_')) {
        await this.handleOnboardingSession(cleanFrom, cleanText, user, activeSession);
        return;
      }

      if (activeSession.state === 'CONFIRM_ACCOUNT_RESET') {
        if (['reset account', 'yes', 'confirm', '1', 'btn_confirm_reset'].includes(lower)) {
          pendingSessions.delete(cleanFrom);
          const reset = await userContextService.resetUserOnboarding(cleanFrom);
          if (!reset) {
            await this.sendReply(cleanFrom, 'I could not reset the account just now. Your saved profile was not intentionally changed; please try later.');
            return;
          }
          user.display_name = null;
          user.pin_hash = null;
          user.onboarding_step = CONSTANTS.ONBOARDING_STEPS.AWAITING_NAME;
          await this.handleOnboardingEntry(cleanFrom, cleanText, user);
        } else {
          pendingSessions.delete(cleanFrom);
          await this.sendReply(cleanFrom, 'Your saved name and PIN are unchanged.');
        }
        return;
      }

      if (activeSession.state?.startsWith('BILL_')) {
        await this.handleBillSession(cleanFrom, cleanText, user, activeSession);
        return;
      }

      const recipients = await recipientService.getRecipients(user.id);
      await this.handleActiveSession(cleanFrom, cleanText, user, activeSession, messageId, recipients);
      return;
    }

    // 4. User Onboarding Flow: If user is new / not onboarded, guide them
    if (!this.isUserOnboarded(user)) {
      await this.handleOnboardingEntry(cleanFrom, cleanText, user);
      return;
    }

    // 5. Returning User Greeting Check (hi / hello / hey / start / menu)
    if (['hi', 'hello', 'hey', 'start', 'menu', 'home'].includes(lower)) {
      await this.sendHomeMenu(cleanFrom, user);
      return;
    }

    const billStatusMatch = lower.match(/^(?:status|check status|check bill)\s+([a-z0-9_-]{8,80})$/i);
    if (billStatusMatch) {
      await this.handleBillStatus(cleanFrom, billStatusMatch[1]);
      return;
    }

    if (/\b(airtime|mobile\s+data|data\s+bundle|buy\s+data)\b/i.test(lower)) {
      const product = /\b(data|mobile\s+data|data\s+bundle)\b/i.test(lower) ? 'data' : 'airtime';
      await this.startBillPurchase(cleanFrom, user, product, cleanText, messageId);
      return;
    }

    // 6. Handle quick-reply buttons and common top-level triggers
    if (['send money', '💸 send money', 'btn_send_money', 'transfer'].includes(lower)) {
      pendingSessions.set(cleanFrom, {
        state: 'AWAITING_RECIPIENT',
        timestamp: Date.now(),
      });
      await this.sendReply(
        cleanFrom,
        'Which account number or saved contact would you like to transfer to?'
      );
      return;
    }
    if (['check balance', '📊 check balance', 'btn_check_balance', 'balance'].includes(lower)) {
      await this.handleCheckBalance(cleanFrom, user);
      return;
    }
    if (['my contacts', '👥 my contacts', 'btn_my_contacts', 'contacts', 'list contacts'].includes(lower)) {
      const recipients = await recipientService.getRecipients(user.id);
      await this.handleListRecipients(cleanFrom, recipients);
      return;
    }

    // 5. Fetch User Recipients
    const recipients = await recipientService.getRecipients(user.id);

    // 6. Parse Intent & Entities
    const parsed = await aiService.parseCommand(cleanText, recipients);
    logger.info({ from: cleanFrom, intent: parsed.intent, parsed }, 'AI Command Parsed');

    switch (parsed.intent) {
      case CONSTANTS.INTENTS.SEND_MONEY:
        await this.initiateSendMoneyFlow(cleanFrom, user, parsed, recipients, messageId);
        break;

      case CONSTANTS.INTENTS.ADD_RECIPIENT:
        await this.handleAddRecipient(cleanFrom, user, parsed);
        break;

      case CONSTANTS.INTENTS.CHECK_BALANCE:
        await this.handleCheckBalance(cleanFrom, user);
        break;

      case CONSTANTS.INTENTS.LIST_RECIPIENTS:
        await this.handleListRecipients(cleanFrom, recipients);
        break;

      case CONSTANTS.INTENTS.SET_PIN:
        await this.handleSetPinRequest(cleanFrom, user, parsed);
        break;

      case 'PROVIDE_PIN':
        if (parsed.pin) {
          await this.handleDirectPinEntry(cleanFrom, user, parsed.pin);
        }
        break;

      case CONSTANTS.INTENTS.HELP:
        // Route 'help' intent to the clean home menu with buttons (like Xara)
        await this.sendHomeMenu(cleanFrom, user);
        break;

      default:
        // Use conversation memory for context-aware response
        const history = await conversationMemory.getRecentHistory(cleanFrom, 6);
        if (history.at(-1)?.role === 'user' && history.at(-1).content === redactPersonalNumbers(cleanText)) {
          history.pop();
        }
        const response = await aiService.generateResponse(cleanText, '', history, user.display_name);
        await this.sendReply(cleanFrom, response);
        break;
    }
  }

  async startBillPurchase(from, user, product, text, messageId) {
    if (!paymentService.billPaymentsEnabled) {
      await this.sendReply(from, 'Airtime and data purchases are currently disabled. For a sandbox test, configure FLW_BILL_PAYMENTS_ENABLED=true and apply the bill-purchases database migration first.');
      return;
    }

    const session = {
      kind: 'bill',
      product,
      customerPhone: normalizeNigerianPhone(text),
      network: normalizeNetwork(text),
      amount: product === 'airtime' ? extractAmount(text) : null,
      state: 'BILL_STARTING',
      timestamp: Date.now(),
      idempotencyKey: `bill_${randomUUID()}`,
      sourceMessageId: messageId || null,
    };
    pendingSessions.set(from, session);
    await this.advanceBillPurchase(from, user, session);
  }

  async advanceBillPurchase(from, user, session) {
    if (!session.customerPhone) {
      session.state = 'BILL_AWAITING_PHONE';
      session.timestamp = Date.now();
      pendingSessions.set(from, session);
      await this.sendReply(from, `What Nigerian phone number should receive the ${session.product}? Include the full number, e.g. 08012345678.`);
      return;
    }

    if (!session.network) {
      session.state = 'BILL_AWAITING_NETWORK';
      session.timestamp = Date.now();
      pendingSessions.set(from, session);
      await this.sendReply(from, 'Which mobile network is this number on? Number prefixes can be misleading after number portability.', [
        { id: 'bill_network_mtn', title: 'MTN' },
        { id: 'bill_network_airtel', title: 'Airtel' },
        { id: 'bill_network_glo', title: 'Glo' },
      ]);
      return;
    }

    if (session.product === 'airtime' && (!session.amount || session.amount <= 0)) {
      session.state = 'BILL_AWAITING_AMOUNT';
      session.timestamp = Date.now();
      pendingSessions.set(from, session);
      await this.sendReply(from, 'How much airtime would you like to buy? Enter an amount in naira.');
      return;
    }

    try {
      const catalog = await paymentService.getMobileBiller(session.product, session.network);
      session.billerCode = catalog.biller.biller_code;
      session.billerName = catalog.biller.name || catalog.biller.short_name || session.network.toUpperCase();

      if (session.product === 'airtime') {
        const airtimeItem = catalog.items.find(item => item.item_code && item.is_airtime === true && item.is_data !== true);
        if (!airtimeItem?.item_code) throw new Error(`Flutterwave has no active airtime item for ${session.network}`);
        session.itemCode = airtimeItem.item_code;
        session.planName = 'Airtime top-up';
        await this.prepareBillConfirmation(from, user, session, Number(airtimeItem.fee) || 0);
        return;
      }

      const plans = catalog.items
        .filter(item => item.item_code && Number(item.amount) > 0 && Number(item.amount) <= CONSTANTS.MAX_SINGLE_TRANSFER)
        .sort((a, b) => Number(a.amount) - Number(b.amount))
        .slice(0, 10);
      if (!plans.length) throw new Error(`Flutterwave returned no priced data plans for ${session.network}`);

      session.planOptions = plans.map(item => ({
        itemCode: item.item_code,
        name: item.short_name || item.name || item.item_code,
        amount: Number(item.amount),
        fee: Number(item.fee) || 0,
      }));
      session.state = 'BILL_AWAITING_DATA_PLAN';
      session.timestamp = Date.now();
      pendingSessions.set(from, session);

      const planList = session.planOptions
        .map((plan, index) => `${index + 1}. ${plan.name} — NGN ${plan.amount.toLocaleString()}${plan.fee ? ` (+ NGN ${plan.fee.toLocaleString()} provider fee)` : ''}`)
        .join('\n');
      await this.sendReply(from, `Available ${session.network.toUpperCase()} data plans for ${session.customerPhone}:\n\n${planList}\n\nReply with the plan number, or say cancel.`);
    } catch (error) {
      logger.warn({ product: session.product, network: session.network, error: error.message }, 'Mobile bill catalog lookup failed');
      pendingSessions.delete(from);
      await this.sendReply(from, `I could not load the current ${session.network.toUpperCase()} ${session.product} options from Flutterwave. No purchase was made. Please try again later.`);
    }
  }

  async prepareBillConfirmation(from, user, session, providerFee = 0) {
    const amount = Number(session.amount);
    const totalDebit = amount + Number(providerFee || 0);
    if (!Number.isInteger(amount) || amount < CONSTANTS.MIN_SINGLE_TRANSFER || amount > CONSTANTS.MAX_SINGLE_TRANSFER) {
      pendingSessions.delete(from);
      await this.sendReply(from, `Airtime must be a whole-naira amount between NGN ${CONSTANTS.MIN_SINGLE_TRANSFER.toLocaleString()} and NGN ${CONSTANTS.MAX_SINGLE_TRANSFER.toLocaleString()}.`);
      return;
    }

    try {
      const spentToday = await billTransactionService.getDailySpent(user.phone_number || from);
      if (spentToday + totalDebit > Number(user.daily_limit)) {
        pendingSessions.delete(from);
        const remaining = Math.max(0, Number(user.daily_limit) - spentToday);
        await this.sendReply(from, `This would exceed your daily limit. Remaining today: NGN ${remaining.toLocaleString()}.`);
        return;
      }
    } catch (error) {
      pendingSessions.delete(from);
      await this.sendReply(from, error.message);
      return;
    }

    session.providerFee = Number(providerFee) || 0;
    session.state = 'BILL_AWAITING_CONFIRMATION';
    session.timestamp = Date.now();
    pendingSessions.set(from, session);
    const label = session.product === 'data' ? session.planName : 'Airtime top-up';
    const quote = `📱 *${session.product === 'data' ? 'Data purchase' : 'Airtime purchase'}*\n\n` +
      `*Network:* ${session.network.toUpperCase()}\n` +
      `*Number:* ${session.customerPhone}\n` +
      `*Plan:* ${label}\n` +
      `*Amount:* NGN ${amount.toLocaleString()}\n` +
      (session.providerFee ? `*Provider fee:* NGN ${session.providerFee.toLocaleString()}\n` : '') +
      `\nConfirm only if the network, number, and amount are correct. This beta purchase is paid from GramPay's Flutterwave bill-payment float; it does not debit a user wallet.`;
    await this.sendReply(from, quote, [
      { id: 'bill_confirm', title: 'Confirm' },
      { id: 'bill_cancel', title: 'Cancel' },
    ]);
  }

  async handleBillSession(from, text, user, session) {
    const lower = text.toLowerCase().trim();
    if (['no', 'cancel', 'stop', 'abort', 'dont', "don't", 'exit'].includes(lower)) {
      pendingSessions.delete(from);
      await this.sendReply(from, 'Purchase cancelled. No bill payment was submitted.');
      return;
    }

    if (session.state === 'BILL_AWAITING_PHONE') {
      const phone = normalizeNigerianPhone(text);
      if (!phone) {
        await this.sendReply(from, 'Please enter a valid Nigerian mobile number, such as 08012345678 or +2348012345678.');
        return;
      }
      session.customerPhone = phone;
      await this.advanceBillPurchase(from, user, session);
      return;
    }

    if (session.state === 'BILL_AWAITING_NETWORK') {
      const network = normalizeNetwork(text);
      if (!network || !MOBILE_NETWORKS.includes(network)) {
        await this.sendReply(from, 'Please specify MTN, Airtel, Glo, or 9mobile. We do not infer a network from the phone prefix.');
        return;
      }
      session.network = network;
      await this.advanceBillPurchase(from, user, session);
      return;
    }

    if (session.state === 'BILL_AWAITING_AMOUNT') {
      const amount = extractAmount(text);
      if (!Number.isInteger(amount)) {
        await this.sendReply(from, 'Please enter a whole-naira amount, for example 500 or 1,000.');
        return;
      }
      session.amount = amount;
      await this.advanceBillPurchase(from, user, session);
      return;
    }

    if (session.state === 'BILL_AWAITING_DATA_PLAN') {
      const choice = Number.parseInt(text, 10);
      if (!Number.isInteger(choice) || choice < 1 || choice > session.planOptions.length) {
        await this.sendReply(from, `Reply with a plan number from 1 to ${session.planOptions.length}, or say cancel.`);
        return;
      }
      const plan = session.planOptions[choice - 1];
      session.itemCode = plan.itemCode;
      session.planName = plan.name;
      session.amount = plan.amount;
      await this.prepareBillConfirmation(from, user, session, plan.fee);
      return;
    }

    if (session.state === 'BILL_AWAITING_CONFIRMATION') {
      if (!['yes', 'confirm', 'proceed', 'ok', 'okay', '1'].includes(lower)) {
        await this.sendReply(from, 'Please tap Confirm or reply YES to continue, or Cancel to stop.');
        return;
      }
      if (!user.pin_hash) {
        pendingSessions.delete(from);
        await this.sendReply(from, 'A security PIN is required before bill purchases. Please finish account setup first; PIN setup and entry are not supported in WhatsApp chat for bill payments.');
        return;
      }
      for (const [oldToken, challenge] of billAuthChallenges.entries()) {
        if (challenge.expiresAt <= Date.now()) billAuthChallenges.delete(oldToken);
      }
      const token = randomBytes(32).toString('base64url');
      billAuthChallenges.set(token, { phone: from, expiresAt: Date.now() + CONSTANTS.CONFIRMATION_TTL_MS, attempts: 0 });
      session.billAuthToken = token;
      session.state = 'BILL_AWAITING_SECURE_PIN';
      session.timestamp = Date.now();
      pendingSessions.set(from, session);
      const appUrl = (process.env.APP_URL || 'https://grampay-3m3e.onrender.com').replace(/\/$/, '');
      if (process.env.NODE_ENV === 'production' && !appUrl.startsWith('https://')) {
        billAuthChallenges.delete(token);
        pendingSessions.delete(from);
        await this.sendReply(from, 'Secure authorization is unavailable right now. No purchase was submitted. Please contact support.');
        return;
      }
      await this.sendReply(from, `🔒 Confirm securely in your browser. Your PIN is not requested or stored in this WhatsApp chat.\n\n${appUrl}/api/bill-auth/${token}\n\nThis one-time link expires in 5 minutes.`);
      return;
    }

    if (session.state === 'BILL_AWAITING_SECURE_PIN') {
      await this.sendReply(from, 'Please use the one-time secure authorization link to enter your PIN. Do not send your PIN in this chat.');
      return;
    }

    await this.sendReply(from, 'This purchase step is not recognized. Please cancel and start again.');
  }

  async executeBillPurchase(from, user, session) {
    await this.sendReply(from, '⏳ Submitting your purchase to Flutterwave…');
    let transaction;
    try {
      const spentToday = await billTransactionService.getDailySpent(user.phone_number || from);
      if (spentToday + Number(session.amount) + Number(session.providerFee || 0) > Number(user.daily_limit)) {
        await this.sendReply(from, 'Your daily limit has been reached. No purchase was submitted.');
        return;
      }

      transaction = await billTransactionService.createPurchase({
        requesterPhone: user.phone_number || from,
        product: session.product,
        network: session.network,
        customerPhone: session.customerPhone,
        billerCode: session.billerCode,
        itemCode: session.itemCode,
        planName: session.planName,
        amount: session.amount,
        providerFee: session.providerFee,
        reference: session.idempotencyKey,
      });
    } catch (error) {
      logger.error({ error: error.message, reference: session.idempotencyKey }, 'Bill purchase initialization failed');
      await this.sendReply(from, '❌ I could not safely initialize this purchase, so no provider request was made. Please start again later.');
      return;
    }

    if (!transaction.isNew) {
      await this.sendReply(from, `This purchase was already submitted and will not be sent again.\nStatus: ${transaction.status.toUpperCase()}\nReference: ${transaction.provider_reference}\nSend “status ${transaction.provider_reference}” to check it.`);
      return;
    }

    try {
      const response = await paymentService.createBillPayment({
        billerCode: session.billerCode,
        itemCode: session.itemCode,
        customerPhone: session.customerPhone,
        amount: session.amount,
        reference: session.idempotencyKey,
      });
      const providerData = response.data || {};
      if ((providerData.tx_ref && providerData.tx_ref !== session.idempotencyKey) ||
          (providerData.amount !== undefined && Number(providerData.amount) !== Number(session.amount))) {
        throw new Error('Flutterwave response did not match the saved purchase reference or amount');
      }
      await billTransactionService.updateStatus(session.idempotencyKey, 'pending', {
        providerTransactionId: providerData.reference || providerData.tx_ref,
        providerFee: Number.isFinite(Number(providerData.fee)) ? Number(providerData.fee) : session.providerFee,
        providerResponse: {
          status: response.status,
          message: response.message,
          data: {
            tx_ref: providerData.tx_ref,
            reference: providerData.reference,
            batch_reference: providerData.batch_reference,
            code: providerData.code,
            fee: providerData.fee,
          },
        },
      });
      await this.sendReply(from, `⏳ Flutterwave accepted the request and is processing it. I will not treat it as complete until its status is verified.\n\nReference: ${session.idempotencyKey}\nSend “status ${session.idempotencyKey}” to check.`);
    } catch (error) {
      // A timeout can happen after Flutterwave accepted the request. Never retry with a new reference or tell the user it failed.
      await billTransactionService.updateStatus(session.idempotencyKey, 'manual_review', {
        errorReason: 'Provider outcome uncertain; status must be checked before any retry.',
      });
      logger.error({ reference: session.idempotencyKey, error: error.message }, 'Bill payment outcome uncertain; marked for review');
      await this.sendReply(from, `⚠️ I could not confirm the provider result. Do not submit this purchase again yet. It has been marked for status review.\n\nReference: ${session.idempotencyKey}\nSend “status ${session.idempotencyKey}” to check.`);
    }
  }

  async handleBillStatus(from, reference, { notify = true } = {}) {
    let transaction;
    try {
      transaction = await billTransactionService.findByReference(reference, from);
    } catch (error) {
      if (notify) await this.sendReply(from, 'I could not retrieve that purchase right now. Please try again later.');
      return null;
    }
    if (!transaction) {
      if (notify) await this.sendReply(from, 'I could not find a bill purchase with that reference for your account.');
      return null;
    }
    if (['completed', 'failed'].includes(transaction.status)) {
      if (notify) await this.sendBillStatusReply(from, transaction);
      return transaction;
    }

    try {
      const providerData = await paymentService.getBillPaymentStatus(reference);
      if (providerData.tx_ref && providerData.tx_ref !== reference) {
        throw new Error('Flutterwave returned a different bill reference');
      }
      if (providerData.amount !== undefined && Number(providerData.amount) !== Number(transaction.amount)) {
        throw new Error('Flutterwave amount did not match the saved purchase');
      }

      const rawStatus = String(providerData.status || providerData.payment_status || providerData.transaction_status || '').toLowerCase();
      let status = 'manual_review';
      if (['successful', 'success', 'completed', 'complete'].includes(rawStatus)) status = 'completed';
      else if (['failed', 'failure', 'reversed', 'cancelled'].includes(rawStatus)) status = 'failed';
      else if (['pending', 'processing', 'new', 'initiated'].includes(rawStatus)) status = 'pending';
      else if (providerData.flw_ref && Number(providerData.amount) === Number(transaction.amount)) status = 'completed';

      transaction = await billTransactionService.updateStatus(reference, status, {
        providerTransactionId: providerData.flw_ref,
        providerFee: Number.isFinite(Number(providerData.fee)) ? Number(providerData.fee) : undefined,
        providerResponse: {
          tx_ref: providerData.tx_ref,
          amount: providerData.amount,
          fee: providerData.fee,
          flw_ref: providerData.flw_ref,
          status: providerData.status,
          extra: providerData.extra,
          token: providerData.token,
        },
        errorReason: status === 'manual_review' ? 'Provider status response was inconclusive.' : undefined,
      }) || transaction;
    } catch (error) {
      logger.warn({ reference, error: error.message }, 'Could not confirm Flutterwave bill status');
      transaction = await billTransactionService.updateStatus(reference, 'manual_review', {
        errorReason: 'Status lookup failed or provider details did not match the saved purchase.',
      }) || transaction;
    }

    if (notify) await this.sendBillStatusReply(from, transaction);
    return transaction;
  }

  isBillAuthorizationTokenActive(token) {
    const challenge = billAuthChallenges.get(token);
    if (!challenge || challenge.verifying) return false;
    if (challenge.expiresAt <= Date.now()) {
      billAuthChallenges.delete(token);
      return false;
    }
    const session = pendingSessions.get(challenge.phone);
    return session?.state === 'BILL_AWAITING_SECURE_PIN' && session.billAuthToken === token;
  }

  async authorizeBillPurchase(token, pin) {
    const challenge = billAuthChallenges.get(token);
    if (!this.isBillAuthorizationTokenActive(token)) return { ok: false, reason: 'invalid' };
    if (!/^\d{4}$/.test(String(pin || ''))) return { ok: false, reason: 'invalid_pin_format' };

    // Lock the one-time challenge during the asynchronous hash check to reject concurrent form submissions.
    challenge.verifying = true;
    let user;
    let isValid = false;
    try {
      user = await userContextService.resolveUser(challenge.phone);
      isValid = Boolean(user && user.status !== 'frozen' && user.pin_hash && await PinService.verifyPin(String(pin), user.pin_hash));
    } catch (error) {
      logger.warn({ phone: challenge.phone, error: error.message }, 'Secure bill authorization verification failed');
      return { ok: false, reason: 'unavailable' };
    } finally {
      challenge.verifying = false;
    }

    if (challenge.expiresAt <= Date.now()) {
      billAuthChallenges.delete(token);
      return { ok: false, reason: 'invalid' };
    }

    if (!isValid) {
      challenge.attempts += 1;
      if (challenge.attempts >= 3) {
        billAuthChallenges.delete(token);
        pendingSessions.delete(challenge.phone);
        await this.sendReply(challenge.phone, '🚫 Secure authorization failed too many times. The purchase was cancelled; nothing was submitted.');
        return { ok: false, reason: 'locked' };
      }
      return { ok: false, reason: 'incorrect_pin' };
    }

    billAuthChallenges.delete(token);
    const session = pendingSessions.get(challenge.phone);
    if (!session || session.state !== 'BILL_AWAITING_SECURE_PIN' || session.billAuthToken !== token) {
      return { ok: false, reason: 'invalid' };
    }
    delete session.billAuthToken;
    pendingSessions.delete(challenge.phone);
    await this.executeBillPurchase(challenge.phone, user, session);
    return { ok: true };
  }

  async sendBillStatusReply(from, transaction) {
    const statusText = {
      completed: '✅ Purchase completed',
      failed: '❌ Provider confirmed the purchase failed',
      pending: '⏳ Purchase is still processing',
      processing: '⏳ Purchase is processing',
      manual_review: '⚠️ Status is not yet conclusive; it is marked for review',
    }[transaction.status] || '⚠️ Purchase status requires review';
    await this.sendReply(from, `${statusText}\n${transaction.product === 'data' ? `Plan: ${transaction.plan_name}\n` : ''}Network: ${transaction.network.toUpperCase()}\nNumber: ${transaction.customer_phone}\nAmount: NGN ${Number(transaction.amount).toLocaleString()}\nReference: ${transaction.provider_reference}`);
  }

  /**
   * Guided Multi-Turn Conversation State Machine
   */
  async handleActiveSession(from, text, user, session, messageId, recipients) {
    const lower = text.toLowerCase().trim();

    // Global Cancel
    if (['no', 'cancel', 'stop', 'abort', 'don\'t', 'dont', 'exit'].includes(lower)) {
      pendingSessions.delete(from);
      await this.sendReply(from, session.kind === 'bill' ? 'Purchase cancelled. No bill payment was submitted.' : '❌ Transfer request cancelled.');
      return;
    }

    // -------------------------------------------------------------
    // STATE 1: AWAITING_RECIPIENT (Amount is known, waiting for who to send to)
    // -------------------------------------------------------------
    if (session.state === 'AWAITING_RECIPIENT') {
      // Check if user replied with 10 digit account number
      const accMatch = text.match(/\b(\d{10})\b/);
      if (accMatch) {
        session.accountNumber = accMatch[1];

        // Check if bank name is also in the text
        const knownBanks = ['opay', 'kuda', 'moniepoint', 'palmpay', 'gtb', 'gtbank', 'zenith', 'access', 'first bank', 'uba', 'fcmb'];
        for (const b of knownBanks) {
          if (lower.includes(b)) {
            session.bankName = b;
            break;
          }
        }

        if (session.bankName) {
          await this.verifyAndPromptConfirmation(from, user, session, messageId);
        } else {
          session.state = 'AWAITING_BANK_SELECTION';
          pendingSessions.set(from, session);
          await this.promptBankSelection(from, session.accountNumber);
        }
        return;
      }

      // Check if user replied with contact name from saved contacts
      const foundContact = await recipientService.findByName(user.id, text);
      if (foundContact) {
        session.accountNumber = foundContact.account_number;
        session.bankName = foundContact.bank_name;
        session.bankCode = foundContact.bank_code;
        session.recipientName = foundContact.nickname || foundContact.name;
        await this.verifyAndPromptConfirmation(from, user, session, messageId);
        return;
      }

      await this.sendReply(
        from,
        `🔍 Could not find "${text}" in your saved contacts.\n\nPlease reply with an **Account Number and Bank Name** (e.g. \`0123456789 Opay\`), or say *cancel*.`
      );
      return;
    }

    // -------------------------------------------------------------
    // STATE 2: AWAITING_AMOUNT (Recipient known, waiting for amount)
    // -------------------------------------------------------------
    if (session.state === 'AWAITING_AMOUNT') {
      const parsed = await aiService.parseCommand(text, recipients);
      if (parsed.amount && parsed.amount > 0) {
        session.amount = parsed.amount;
        await this.verifyAndPromptConfirmation(from, user, session, messageId);
        return;
      }

      await this.sendReply(from, '❓ Please enter a valid transfer amount (e.g., `5000` or `5k`):');
      return;
    }

    // -------------------------------------------------------------
    // STATE 3: AWAITING_BANK_SELECTION (Account number known, waiting for bank)
    // -------------------------------------------------------------
    if (session.state === 'AWAITING_BANK_SELECTION') {
      const bankCode = await paymentService.resolveBankCode(text);
      if (!bankCode) {
        await this.sendReply(
          from,
          `❓ Could not recognize bank "${text}". Please select or reply with a valid bank name (e.g., Opay, Kuda, Moniepoint, GTBank, Zenith):`
        );
        return;
      }

      session.bankName = text;
      session.bankCode = bankCode;
      await this.verifyAndPromptConfirmation(from, user, session, messageId);
      return;
    }

    // -------------------------------------------------------------
    // STATE 4: AWAITING_CONFIRMATION (All details verified, waiting for YES/NO)
    // -------------------------------------------------------------
    if (session.state === 'AWAITING_CONFIRMATION') {
      if (['yes', 'yup', 'yeah', 'confirm', 'proceed', 'send it', 'ok', 'okay', '1'].includes(lower)) {
        if (!user.pin_hash) {
          session.state = 'SETTING_PIN_FIRST';
          pendingSessions.set(from, session);
          await this.sendReply(from, '🔐 You have not set a 4-digit PIN yet.\nPlease enter a new 4-digit PIN to secure your transfers:');
          return;
        }

        session.state = 'AWAITING_PIN';
        session.pinAttempts = 0;
        pendingSessions.set(from, session);

        await this.sendReply(
          from,
          `🔒 *Security Authorization*\n\nPlease reply with your **4-digit PIN** to authorize sending **NGN ${session.amount.toLocaleString()}** to **${session.recipientName}**.`
        );
        return;
      }

      await this.sendReply(from, 'Please reply *YES* to confirm or *NO* to cancel.');
      return;
    }

    // -------------------------------------------------------------
    // STATE: AWAITING_OLD_PIN_FOR_CHANGE (Verifying existing PIN before change)
    // -------------------------------------------------------------
    if (session.state === 'AWAITING_OLD_PIN_FOR_CHANGE') {
      if (!/^\d{4}$/.test(text)) {
        await this.sendReply(from, '⚠️ Please enter your current 4-digit numeric PIN:');
        return;
      }

      const isValid = await PinService.verifyPin(text, user.pin_hash);
      if (!isValid) {
        session.oldPinAttempts = (session.oldPinAttempts || 0) + 1;
        if (session.oldPinAttempts >= 3) {
          pendingSessions.delete(from);
          await this.sendReply(from, '🚫 Maximum invalid attempts reached. PIN change cancelled.');
          return;
        }
        await this.sendReply(from, `❌ Incorrect current PIN (${3 - session.oldPinAttempts} attempt(s) remaining). Please try again:`);
        return;
      }

      session.state = 'SETTING_PIN_FIRST';
      pendingSessions.set(from, session);
      await this.sendReply(from, '✅ Current PIN verified. Please enter your **new 4-digit PIN**:');
      return;
    }

    // -------------------------------------------------------------
    // STATE 5: SETTING_PIN_FIRST (First entry of new PIN)
    // -------------------------------------------------------------
    if (session.state === 'SETTING_PIN_FIRST') {
      if (/^\d{4}$/.test(text)) {
        session.newPinCandidate = text;
        session.state = 'CONFIRMING_NEW_PIN';
        pendingSessions.set(from, session);
        await this.sendReply(from, '🔐 Please **re-enter** your new 4-digit PIN to confirm:');
        return;
      }
      await this.sendReply(from, '⚠️ PIN must be exactly 4 digits. Please enter a valid 4-digit PIN:');
      return;
    }

    // -------------------------------------------------------------
    // STATE: CONFIRMING_NEW_PIN (Double confirmation of new PIN)
    // -------------------------------------------------------------
    if (session.state === 'CONFIRMING_NEW_PIN') {
      if (!/^\d{4}$/.test(text)) {
        await this.sendReply(from, '⚠️ Please re-enter your 4-digit numeric PIN to confirm:');
        return;
      }

      if (text !== session.newPinCandidate) {
        delete session.newPinCandidate;
        session.state = 'SETTING_PIN_FIRST';
        pendingSessions.set(from, session);
        await this.sendReply(from, '❌ PINs do not match. Let\'s try again. Please enter your new 4-digit PIN:');
        return;
      }

      const hash = await PinService.hashPin(text);
      const pinSaved = await userContextService.updateUserPin(from, hash);
      if (!pinSaved) {
        await this.sendReply(from, 'I could not securely save your PIN. No PIN has been activated; please try again in a moment.');
        return;
      }
      user.pin_hash = hash;
      delete session.newPinCandidate;

      if (session.pendingBillAuthorization) {
        delete session.pendingBillAuthorization;
        session.state = 'BILL_AWAITING_PIN';
        session.pinAttempts = 0;
        session.timestamp = Date.now();
        pendingSessions.set(from, session);
        await this.sendReply(from, '✅ PIN created. To authorize this purchase, please enter your new 4-digit PIN once more.');
        return;
      }

      // If this session had an active transfer pending, execute it
      if (session.amount && (session.accountNumber || session.recipientName)) {
        pendingSessions.delete(from);
        await this.executeTransfer(from, user, session, messageId);
      } else {
        pendingSessions.delete(from);
        await this.sendReply(from, '🔐 *PIN Set Successfully!* Your new 4-digit PIN is now active.');
      }
      return;
    }

    // -------------------------------------------------------------
    // STATE 6: AWAITING_PIN (Authorizing transfer)
    // -------------------------------------------------------------
    if (session.state === 'AWAITING_PIN') {
      if (!/^\d{4}$/.test(text)) {
        await this.sendReply(from, '⚠️ Please enter your 4-digit numeric PIN:');
        return;
      }

      const isValid = await PinService.verifyPin(text, user.pin_hash);
      if (!isValid) {
        session.pinAttempts = (session.pinAttempts || 0) + 1;
        if (session.pinAttempts >= 3) {
          pendingSessions.delete(from);
          await this.sendReply(from, '🚫 Maximum invalid PIN attempts reached. Transfer cancelled for security.');
          return;
        }
        await this.sendReply(from, `❌ Incorrect PIN (${3 - session.pinAttempts} attempt(s) remaining). Please try again:`);
        return;
      }

      // PIN valid -> Delete pending session before executing payout to prevent double-tap race condition
      pendingSessions.delete(from);
      await this.executeTransfer(from, user, session, messageId);
    }
  }

  /**
   * Initiate Send Money Request Flow with Guided Multi-Turn Checks
   */
  async initiateSendMoneyFlow(from, user, parsed, recipients, messageId) {
    let amount = parsed.amount;
    let recipientName = parsed.recipientName;
    let accountNumber = parsed.accountNumber;
    let bankName = parsed.bankName;

    // Session accumulator object
    const cleanFrom = from.replace(/\D/g, '');
    const session = {
      state: 'INIT',
      amount,
      recipientName,
      accountNumber,
      bankName,
      bankCode: null,
      timestamp: Date.now(),
      idempotencyKey: `tx_${cleanFrom}_${messageId || Date.now()}`,
    };

    // Case 1: Neither Amount nor Recipient is specified
    if (!amount && !accountNumber && !recipientName) {
      await this.sendReply(from, '💬 Who would you like to send money to, and how much? (e.g. "Send 5k to Mom" or "Transfer 2000 to 0123456789 Opay")');
      return;
    }

    // Case 2: Recipient is known (from saved contacts), but Amount is missing
    if (!amount && recipientName) {
      const found = await recipientService.findByName(user.id, recipientName);
      if (found) {
        session.accountNumber = found.account_number;
        session.bankName = found.bank_name;
        session.bankCode = found.bank_code;
        session.recipientName = found.nickname || found.name;
        session.state = 'AWAITING_AMOUNT';
        pendingSessions.set(from, session);

        await this.sendReply(
          from,
          `💸 How much would you like to send to **${session.recipientName}** (${found.bank_name} - ${found.account_number})?`
        );
        return;
      }
    }

    // Case 3: Amount is known, but Recipient is missing
    if (amount > 0 && !accountNumber && !recipientName) {
      session.state = 'AWAITING_RECIPIENT';
      pendingSessions.set(from, session);

      await this.sendReply(
        from,
        `💸 Got it! NGN ${amount.toLocaleString()}.\nWho are you sending this to? Reply with a contact name (e.g., Mom), or an account number & bank.`
      );
      return;
    }

    // Case 4: Account number is provided without a bank name
    if (accountNumber && !bankName) {
      session.state = 'AWAITING_BANK_SELECTION';
      pendingSessions.set(from, session);
      await this.promptBankSelection(from, accountNumber);
      return;
    }

    // Resolve Contact Name if specified
    if (recipientName && !accountNumber) {
      const found = await recipientService.findByName(user.id, recipientName);
      if (found) {
        session.accountNumber = found.account_number;
        session.bankName = found.bank_name;
        session.bankCode = found.bank_code;
        session.recipientName = found.nickname || found.name;
      } else {
        session.state = 'AWAITING_RECIPIENT';
        pendingSessions.set(from, session);
        const amountNote = amount ? ` to send NGN ${amount.toLocaleString()}` : '';
        await this.sendReply(
          from,
          `🔍 Could not find *"${recipientName}"* in your saved contacts.\n\nPlease reply with their *10-digit account number and bank name* (e.g. \`0123456789 Opay\`)${amountNote}, or say *cancel*.`
        );
        return;
      }
    }

    // Now verify details & prompt confirmation
    await this.verifyAndPromptConfirmation(from, user, session, messageId);
  }

  /**
   * Prompt user with Bank Selection Buttons
   */
  async promptBankSelection(from, accountNumber) {
    const text = `🏦 Which bank is **${accountNumber}** with? Reply with the bank name (e.g. Opay, Kuda, Moniepoint, GTBank):`;
    const buttons = [
      { id: 'btn_opay', title: 'Opay' },
      { id: 'btn_kuda', title: 'Kuda' },
      { id: 'btn_moniepoint', title: 'Moniepoint' },
    ];
    await this.sendReply(from, text, buttons);
  }

  /**
   * Resolve Account with Flutterwave and Display Verification Confirmation Card
   */
  async verifyAndPromptConfirmation(from, user, session, messageId) {
    if (!session.amount || session.amount <= 0) {
      session.state = 'AWAITING_AMOUNT';
      pendingSessions.set(from, session);
      await this.sendReply(from, '❓ How much would you like to transfer?');
      return;
    }

    // Limits Validation
    if (session.amount < CONSTANTS.MIN_SINGLE_TRANSFER) {
      pendingSessions.delete(from);
      await this.sendReply(from, `⚠️ Minimum single transfer limit is NGN ${CONSTANTS.MIN_SINGLE_TRANSFER.toLocaleString()}.`);
      return;
    }

    if (session.amount > CONSTANTS.MAX_SINGLE_TRANSFER) {
      pendingSessions.delete(from);
      await this.sendReply(from, `⚠️ Maximum single transfer limit is NGN ${CONSTANTS.MAX_SINGLE_TRANSFER.toLocaleString()}.`);
      return;
    }

    const spentToday = await transactionService.getUserDailySpent(user.phone_number || from);
    if (spentToday + session.amount > user.daily_limit) {
      pendingSessions.delete(from);
      const remaining = Math.max(0, user.daily_limit - spentToday);
      await this.sendReply(
        from,
        `⚠️ Daily transfer limit reached!\nDaily limit: NGN ${user.daily_limit.toLocaleString()}\nSpent today: NGN ${spentToday.toLocaleString()}\nRemaining: NGN ${remaining.toLocaleString()}`
      );
      return;
    }

    // Resolve Bank Code if missing
    if (!session.bankCode && session.bankName) {
      session.bankCode = await paymentService.resolveBankCode(session.bankName);
    }

    if (!session.bankCode) {
      session.state = 'AWAITING_BANK_SELECTION';
      pendingSessions.set(from, session);
      await this.promptBankSelection(from, session.accountNumber);
      return;
    }

    // Call Flutterwave Account Verification API
    await this.sendReply(from, '🔍 Verifying account details with bank...');
    const verification = await paymentService.verifyAccount(session.accountNumber, session.bankCode);

    if (!verification.success) {
      pendingSessions.delete(from);
      await this.sendReply(
        from,
        `❌ Could not verify account number **${session.accountNumber}** with ${session.bankName}.\n${verification.message || 'Please check the account number and bank.'}`
      );
      return;
    }

    const resolvedName = verification.accountName || session.recipientName || session.accountNumber;
    session.recipientName = resolvedName;
    session.state = 'AWAITING_CONFIRMATION';
    pendingSessions.set(from, session);

    const confirmMsg = `💸 *Transfer Authorization*\n\n` +
      `*Recipient:* ${resolvedName}\n` +
      `*Account Number:* ${session.accountNumber}\n` +
      `*Bank:* ${session.bankName.toUpperCase()}\n` +
      `*Amount:* NGN ${session.amount.toLocaleString()}\n\n` +
      `Reply *YES* to proceed or *NO* to cancel.`;

    await this.sendReply(from, confirmMsg, [
      { id: 'btn_yes', title: 'YES' },
      { id: 'btn_no', title: 'NO' },
    ]);
  }

  /**
   * Execute actual payout transfer and update single DB record
   */
  async executeTransfer(from, user, session, messageId) {
    await this.sendReply(from, '⏳ Processing transfer with bank...');

    // 1. Single Pending DB Log with Idempotency Key
    let initialTx;
    try {
      initialTx = await transactionService.logTransaction({
        userId: user.phone_number || from,
        recipientName: session.recipientName,
        accountNumber: session.accountNumber,
        bankName: session.bankName,
        amount: session.amount,
        idempotencyKey: session.idempotencyKey,
      });
    } catch (err) {
      logger.error({ error: err.message }, 'Failed to log initial transaction');
    }

    if (!initialTx) {
      pendingSessions.delete(from);
      await this.sendReply(from, '❌ Transaction initialization failed. Money was NOT sent.');
      return;
    }

    // Real Idempotency Guard: If transaction was already initiated/completed, avoid duplicate payout
    if (initialTx.isDuplicate || ['completed', 'processing'].includes(initialTx.status)) {
      pendingSessions.delete(from);
      logger.warn({ txId: initialTx.id, status: initialTx.status, key: session.idempotencyKey }, 'Idempotent request: transfer already initiated or completed');
      await this.sendReply(
        from,
        `ℹ️ *Transfer Already Recorded*\n\nThis transaction was already initiated.\n*Status:* ${(initialTx.status || 'PROCESSING').toUpperCase()}\n*Ref:* ${initialTx.provider_reference || initialTx.opay_reference || session.idempotencyKey}`
      );
      return;
    }

    // 2. Call Flutterwave Transfer API
    try {
      // Sanitize narration: alphanumeric + spaces only, max 40 chars
      const safeRecipient = (session.recipientName || 'Recipient').replace(/[^a-zA-Z0-9 ]/g, '').trim().slice(0, 20);
      const safeNarration = `GramPay payout to ${safeRecipient}`.slice(0, 40);

      const result = await paymentService.transfer({
        amount: session.amount,
        accountNumber: session.accountNumber,
        bankCode: session.bankCode,
        narration: safeNarration,
        reference: session.idempotencyKey,
      });

      // 3. Update DB record status - Flutterwave initial status is typically PENDING/NEW
      const txStatus = result.status === 'SUCCESSFUL' ? 'completed' : 'processing';
      await transactionService.updateStatus(initialTx.id, txStatus, {
        flwRef: result.reference,
        transferId: result.transferId,
      });

      pendingSessions.delete(from);

      const statusTitle = result.status === 'SUCCESSFUL' ? 'Transfer Successful!' : 'Transfer Initiated!';
      const successMsg = `✅ *${statusTitle}*\n\n` +
        `*Amount:* NGN ${session.amount.toLocaleString()}\n` +
        `*Recipient:* ${session.recipientName}\n` +
        `*Account:* ${session.accountNumber} (${session.bankName})\n` +
        `*Status:* ${result.status || 'PROCESSING'}\n` +
        `*Ref:* ${result.reference || result.transferId}`;

      await this.sendReply(from, successMsg);
    } catch (error) {
      logger.error({ error: error.message, txId: initialTx.id }, 'Payout execution error');

      await transactionService.updateStatus(initialTx.id, 'failed', {
        errorReason: error.message,
      });

      pendingSessions.delete(from);
      const userSafeMsg = error.isOperational
        ? error.message
        : 'The transfer could not be completed by the bank. Please try again later.';
      await this.sendReply(from, `❌ Transfer failed: ${userSafeMsg}`);
    }
  }

  /**
   * Save a recipient
   */
  async handleAddRecipient(from, user, parsed) {
    const { recipientName, accountNumber, bankName } = parsed;
    if (!accountNumber || !bankName) {
      await this.sendReply(from, '❓ Please provide account number, bank name, and nickname (e.g. "Save Mom 0123456789 Kuda")');
      return;
    }

    const bankCode = await paymentService.resolveBankCode(bankName);
    if (!bankCode) {
      await this.sendReply(from, `⚠️ Could not identify bank "${bankName}". Please check the bank name and try again.`);
      return;
    }

    const verification = await paymentService.verifyAccount(accountNumber, bankCode);
    if (!verification.success) {
      await this.sendReply(
        from,
        `❌ Could not verify account ${accountNumber} with ${bankName}: ${verification.message || 'Invalid account details'}`
      );
      return;
    }

    const resolvedName = verification.accountName || recipientName || 'Saved Contact';

    await recipientService.addRecipient(user.id, {
      name: resolvedName,
      nickname: recipientName || resolvedName,
      accountNumber,
      bankName,
      bankCode,
    });

    await this.sendReply(from, `✅ Saved *${recipientName || resolvedName}* (${resolvedName} - ${bankName}) to your contacts!`);
  }

  /**
   * Check user limits and daily spent
   */
  async handleCheckBalance(from, user) {
    const spentToday = await transactionService.getUserDailySpent(user.phone_number || from);
    const remaining = Math.max(0, user.daily_limit - spentToday);

    const msg = `📊 *GramPay Account Limits*\n\n` +
      `*Daily Limit:* NGN ${user.daily_limit.toLocaleString()}\n` +
      `*Spent Today:* NGN ${spentToday.toLocaleString()}\n` +
      `*Remaining Today:* NGN ${remaining.toLocaleString()}`;

    await this.sendReply(from, msg);
  }

  /**
   * List saved recipients
   */
  async handleListRecipients(from, recipients) {
    if (!recipients || recipients.length === 0) {
      await this.sendReply(from, '📋 You have no saved contacts. To save one, say:\n"Save Mom 0123456789 Kuda"');
      return;
    }

    let msg = `📋 *Your Saved Contacts*\n\n`;
    recipients.forEach((r, i) => {
      msg += `${i + 1}. *${r.nickname || r.name}*: ${r.account_number} (${r.bank_name})\n`;
    });

    await this.sendReply(from, msg);
  }

  /**
   * Handle user request to set/update PIN
   */
  async handleSetPinRequest(from, user, parsed) {
    if (user.pin_hash) {
      pendingSessions.set(from, {
        state: 'AWAITING_OLD_PIN_FOR_CHANGE',
        timestamp: Date.now(),
        oldPinAttempts: 0,
      });
      await this.sendReply(from, '🔒 To change your PIN, please enter your **current 4-digit PIN**:');
      return;
    }

    pendingSessions.set(from, {
      state: 'SETTING_PIN_FIRST',
      timestamp: Date.now(),
    });

    await this.sendReply(from, '🔐 Please enter your new 4-digit PIN:');
  }

  /**
   * Direct 4-digit PIN entry
   */
  async handleDirectPinEntry(from, user, pin) {
    const activeSession = pendingSessions.get(from);
    if (activeSession) {
      return this.handleActiveSession(from, pin, user, activeSession);
    }

    // Do NOT set PIN from an unsolicited 4-digit number
    await this.sendReply(
      from,
      'ℹ️ If you want to change your PIN, please say *"Set PIN"*. Otherwise, tell me what you would like to do (e.g., *"Send 5000 to Mom"*).'
    );
  }

  /**
   * The main home menu — clean Xara-style greeting with action buttons.
   * Used for greetings, 'help', 'hi', 'menu', and returning users.
   */
  async sendHomeMenu(from, user) {
    const name = user?.display_name ? ` ${user.display_name}` : '';
    const msg = `Hello${name}! I'm GramPay, your personal account manager. I can help you with transfers, airtime, checking balance, and managing beneficiaries. How can I assist you today?`;

    await this.sendReply(from, msg, [
      { id: 'btn_send_money', title: 'Send money' },
      { id: 'btn_check_balance', title: 'Check balance' },
      { id: 'btn_my_contacts', title: 'My contacts' },
    ]);
  }

  /**
   * Backward-compat alias — routes old sendHelpMessage/sendWelcomeBackMessage callers to sendHomeMenu
   */
  async sendWelcomeBackMessage(from, user) {
    return this.sendHomeMenu(from, user);
  }

  async sendHelpMessage(from, user = null) {
    return this.sendHomeMenu(from, user);
  }

  /**
   * Entry point for new users into the onboarding workflow.
   * Fires for truly new users (no pin_hash and no onboarding_step).
   */
  async handleOnboardingEntry(from, text, user) {
    const stepSaved = await userContextService.updateOnboardingStep(from, CONSTANTS.ONBOARDING_STEPS.AWAITING_NAME);
    if (!stepSaved) {
      await this.sendReply(from, 'I could not save your setup progress just now. Please try again in a moment.');
      return;
    }
    pendingSessions.set(from, {
      state: 'ONBOARDING_AWAITING_NAME',
      timestamp: Date.now(),
    });

    const welcomeMsg = `👋 Hello! Welcome to *GramPay*, your personal account manager on WhatsApp.\n\n` +
      `I make sending money to any Nigerian bank as fast and simple as sending a chat message.\n\n` +
      `Let's get your account set up in under a minute! 🚀\n\n` +
      `First, *what is your name?*`;

    await this.sendReply(from, welcomeMsg);
  }

  /**
   * Guided multi-turn onboarding state machine
   */
  async handleOnboardingSession(from, text, user, session) {
    const lower = text.toLowerCase().trim();

    // 1. STATE: ONBOARDING_AWAITING_NAME
    if (session.state === 'ONBOARDING_AWAITING_NAME') {
      let rawName = text.replace(/^(my name is|i am|call me|it's|its)\s+/i, '').trim();
      rawName = rawName.split(/\s+/).slice(0, 2).join(' ');

      if (!rawName || rawName.length < 2 || rawName.length > 30) {
        await this.sendReply(from, '❓ Please tell me your name or nickname to get started:');
        return;
      }

      const formattedName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
      const nameSaved = await userContextService.updateDisplayName(from, formattedName);
      const stepSaved = nameSaved && await userContextService.updateOnboardingStep(from, CONSTANTS.ONBOARDING_STEPS.SETTING_PIN_FIRST);
      if (!nameSaved || !stepSaved) {
        await this.sendReply(from, 'I could not safely save your name and setup progress. Please try entering it again in a moment.');
        return;
      }
      user.display_name = formattedName;

      session.displayName = formattedName;
      session.state = 'ONBOARDING_SETTING_PIN';
      session.timestamp = Date.now();
      pendingSessions.set(from, session);

      const msg = `Nice to meet you, *${formattedName}*! 🎉\n\n` +
        `Now let's secure your transfers. Please create a **4-digit PIN** that you'll use to authorize payments (e.g., \`1234\`):`;
      await this.sendReply(from, msg);
      return;
    }

    // 2. STATE: ONBOARDING_SETTING_PIN
    if (session.state === 'ONBOARDING_SETTING_PIN') {
      if (!/^\d{4}$/.test(text)) {
        await this.sendReply(from, '⚠️ Your PIN must be exactly 4 digits (e.g., `1234`). Please enter a 4-digit PIN:');
        return;
      }

      session.pinCandidate = text;
      session.state = 'ONBOARDING_CONFIRMING_PIN';
      session.timestamp = Date.now();
      pendingSessions.set(from, session);
      await userContextService.updateOnboardingStep(from, CONSTANTS.ONBOARDING_STEPS.CONFIRMING_NEW_PIN);

      await this.sendReply(from, '🔐 Please **re-enter** your 4-digit PIN to confirm:');
      return;
    }

    // 3. STATE: ONBOARDING_CONFIRMING_PIN
    if (session.state === 'ONBOARDING_CONFIRMING_PIN') {
      if (!/^\d{4}$/.test(text)) {
        await this.sendReply(from, '⚠️ Please re-enter your 4-digit numeric PIN:');
        return;
      }

      if (text !== session.pinCandidate) {
        delete session.pinCandidate;
        session.state = 'ONBOARDING_SETTING_PIN';
        session.timestamp = Date.now();
        pendingSessions.set(from, session);
        await this.sendReply(from, '❌ PINs do not match. Let\'s try again. Please enter your new 4-digit PIN:');
        return;
      }

      const hash = await PinService.hashPin(text);
      await userContextService.updateUserPin(from, hash);
      user.pin_hash = hash;
      delete session.pinCandidate;

      session.state = 'ONBOARDING_OFFER_BENEFICIARY';
      session.timestamp = Date.now();
      pendingSessions.set(from, session);
      await userContextService.updateOnboardingStep(from, CONSTANTS.ONBOARDING_STEPS.OFFER_BENEFICIARY);

      const offerMsg = `✅ *Security PIN created successfully!* 🔒\n\n` +
        `Would you like to save a beneficiary contact now? (e.g., Mom, Bro, Landlord)\n\n` +
        `Saving contacts allows you to make instant transfers like *"Send 5k to Mom"* without typing account numbers every time!`;

      await this.sendReply(from, offerMsg, [
        { id: 'btn_beneficiary_yes', title: 'Yes, save one' },
        { id: 'btn_beneficiary_skip', title: 'Skip for now' },
      ]);
      return;
    }

    // 4. STATE: ONBOARDING_OFFER_BENEFICIARY
    if (session.state === 'ONBOARDING_OFFER_BENEFICIARY') {
      if (['yes', 'yup', 'yeah', 'yes, save one', '1', 'sure', 'proceed', 'save'].includes(lower)) {
        session.state = 'ONBOARDING_BENEFICIARY_NICKNAME';
        session.timestamp = Date.now();
        pendingSessions.set(from, session);
        await userContextService.updateOnboardingStep(from, CONSTANTS.ONBOARDING_STEPS.AWAITING_BENEFICIARY_NICKNAME);

        await this.sendReply(from, 'Great! What nickname or label would you like to give them? (e.g., *Mom*, *Bro*, *Chinedu*):');
        return;
      }

      if (['no', 'skip', 'skip for now', 'later', '2', 'cancel', 'nah'].includes(lower)) {
        await this.completeOnboarding(from, session.displayName || user.display_name);
        return;
      }

      await this.sendReply(from, 'Please choose an option below:', [
        { id: 'btn_beneficiary_yes', title: 'Yes, save one' },
        { id: 'btn_beneficiary_skip', title: 'Skip for now' },
      ]);
      return;
    }

    // 5. STATE: ONBOARDING_BENEFICIARY_NICKNAME
    if (session.state === 'ONBOARDING_BENEFICIARY_NICKNAME') {
      const cleanNick = text.replace(/^(save|add|my|call them|nickname is)\s+/i, '').trim();
      if (!cleanNick) {
        await this.sendReply(from, '❓ Please provide a nickname for this contact (e.g., *Mom*):');
        return;
      }

      session.beneficiaryNickname = cleanNick;
      session.state = 'ONBOARDING_BENEFICIARY_ACCOUNT';
      session.timestamp = Date.now();
      pendingSessions.set(from, session);
      await userContextService.updateOnboardingStep(from, CONSTANTS.ONBOARDING_STEPS.AWAITING_BENEFICIARY_ACCOUNT);

      await this.sendReply(from, `Got it for *${cleanNick}*! 💳\n\nPlease enter their **10-digit Nigerian account number**:`);
      return;
    }

    // 6. STATE: ONBOARDING_BENEFICIARY_ACCOUNT
    if (session.state === 'ONBOARDING_BENEFICIARY_ACCOUNT') {
      const accMatch = text.match(/\b(\d{10})\b/);
      if (!accMatch) {
        await this.sendReply(from, '⚠️ Please enter a valid 10-digit account number (e.g. `0123456789`):');
        return;
      }

      session.beneficiaryAccount = accMatch[1];

      // Check if bank name was typed alongside
      const knownBanks = ['opay', 'kuda', 'moniepoint', 'palmpay', 'gtb', 'gtbank', 'zenith', 'access', 'first bank', 'uba', 'fcmb', 'stanbic', 'sterling', 'wema'];
      let foundBank = null;
      for (const b of knownBanks) {
        if (lower.includes(b)) {
          foundBank = b;
          break;
        }
      }

      if (foundBank) {
        session.beneficiaryBank = foundBank;
        await this.verifyAndSaveOnboardingBeneficiary(from, user, session);
        return;
      }

      session.state = 'ONBOARDING_BENEFICIARY_BANK';
      session.timestamp = Date.now();
      pendingSessions.set(from, session);
      await userContextService.updateOnboardingStep(from, CONSTANTS.ONBOARDING_STEPS.AWAITING_BENEFICIARY_BANK);

      await this.sendReply(
        from,
        `🏦 Which bank is **${session.beneficiaryAccount}** with? Reply with the bank name (or choose below):`,
        [
          { id: 'btn_ob_opay', title: 'Opay' },
          { id: 'btn_ob_kuda', title: 'Kuda' },
          { id: 'btn_ob_moniepoint', title: 'Moniepoint' },
        ]
      );
      return;
    }

    // 7. STATE: ONBOARDING_BENEFICIARY_BANK
    if (session.state === 'ONBOARDING_BENEFICIARY_BANK') {
      session.beneficiaryBank = text;
      await this.verifyAndSaveOnboardingBeneficiary(from, user, session);
      return;
    }

    // 8. STATE: ONBOARDING_ASK_ADD_ANOTHER
    if (session.state === 'ONBOARDING_ASK_ADD_ANOTHER') {
      if (['yes', 'save another', '1', 'add another', 'another'].includes(lower)) {
        session.state = 'ONBOARDING_BENEFICIARY_NICKNAME';
        delete session.beneficiaryNickname;
        delete session.beneficiaryAccount;
        delete session.beneficiaryBank;
        session.timestamp = Date.now();
        pendingSessions.set(from, session);

        await this.sendReply(from, 'Great! What is the next recipient\'s nickname? (e.g., *Bro*, *Dad*):');
        return;
      }

      if (['no', 'i\'m all set', 'im all set', 'done', 'finish', 'skip', '2'].includes(lower)) {
        await this.completeOnboarding(from, session.displayName || user.display_name);
        return;
      }

      await this.sendReply(from, 'Would you like to save another contact?', [
        { id: 'btn_ob_another', title: 'Save another' },
        { id: 'btn_ob_done', title: "I'm all set" },
      ]);
      return;
    }
  }

  /**
   * Verify beneficiary account with Flutterwave and save to contacts
   */
  async verifyAndSaveOnboardingBeneficiary(from, user, session) {
    const bankCode = await paymentService.resolveBankCode(session.beneficiaryBank);
    if (!bankCode) {
      await this.sendReply(
        from,
        `❓ Could not recognize bank "${session.beneficiaryBank}". Please reply with a valid bank name (e.g., Opay, Kuda, Moniepoint, GTBank, Zenith):`
      );
      return;
    }

    await this.sendReply(from, '🔍 Verifying account details with bank...');
    const verification = await paymentService.verifyAccount(session.beneficiaryAccount, bankCode);

    if (!verification.success) {
      await this.sendReply(
        from,
        `❌ Could not verify account **${session.beneficiaryAccount}** with ${session.beneficiaryBank}.\n${verification.message || 'Please check the account number and bank.'}\n\nPlease enter the correct account number:`
      );
      session.state = 'ONBOARDING_BENEFICIARY_ACCOUNT';
      session.timestamp = Date.now();
      pendingSessions.set(from, session);
      return;
    }

    const resolvedName = verification.accountName || session.beneficiaryNickname;

    await recipientService.addRecipient(user.id || from, {
      name: resolvedName,
      nickname: session.beneficiaryNickname,
      accountNumber: session.beneficiaryAccount,
      bankName: session.beneficiaryBank,
      bankCode,
    });

    session.state = 'ONBOARDING_ASK_ADD_ANOTHER';
    session.timestamp = Date.now();
    pendingSessions.set(from, session);

    const successMsg = `✅ Saved *${session.beneficiaryNickname}* (${resolvedName} - ${session.beneficiaryBank.toUpperCase()})!\n\nWould you like to save another beneficiary?`;
    await this.sendReply(from, successMsg, [
      { id: 'btn_ob_another', title: 'Save another' },
      { id: 'btn_ob_done', title: "I'm all set" },
    ]);
  }

  /**
   * Complete onboarding and send congratulatory overview
   */
  async completeOnboarding(from, displayName) {
    pendingSessions.delete(from);
    await userContextService.updateOnboardingStep(from, CONSTANTS.ONBOARDING_STEPS.COMPLETED);

    const name = displayName ? ` ${displayName}` : '';
    const completionMsg = `🎉 *You're all set up${name}!* Welcome to GramPay.\n\n` +
      `Your account is active and ready for transfers. How can I assist you today?`;

    await this.sendReply(from, completionMsg, [
      { id: 'btn_send_money', title: 'Send money' },
      { id: 'btn_check_balance', title: 'Check balance' },
      { id: 'btn_my_contacts', title: 'My contacts' },
    ]);
  }
}

export const commandHandler = new CommandHandler();
