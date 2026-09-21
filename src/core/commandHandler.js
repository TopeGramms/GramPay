import { aiService } from '../services/ai.js';
import { whatsappService } from '../services/whatsappCloud.js';
import { paymentService } from '../services/payment.js';
import { recipientService } from '../services/recipient.js';
import { transactionService } from '../services/transaction.js';
import { PinService } from '../services/pin.js';
import { userContextService } from './userContext.js';
import { CONSTANTS } from '../config/constants.js';
import { logger } from '../lib/logger.js';

// In-memory conversation state store with TTL
const pendingSessions = new Map();

export class CommandHandler {
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
    logger.info({ from: cleanFrom, text }, '📩 Processing incoming WhatsApp message');

    // 1. Resolve User Context
    const user = await userContextService.resolveUser(cleanFrom);
    if (!user || !user.is_active) {
      await whatsappService.sendMessage(cleanFrom, '⚠️ Your account is currently inactive. Please contact support.');
      return;
    }

    // 2. Fetch User Recipients
    const recipients = await recipientService.getRecipients(user.id);

    // 3. Check for Active Multi-Step Session
    const activeSession = pendingSessions.get(cleanFrom);
    if (activeSession) {
      // Check session expiry (5 minutes)
      if (Date.now() - activeSession.timestamp > CONSTANTS.CONFIRMATION_TTL_MS) {
        pendingSessions.delete(cleanFrom);
        await whatsappService.sendMessage(cleanFrom, '⏳ Session timed out. Please start your transfer request again.');
        return;
      }

      await this.handleActiveSession(cleanFrom, text.trim(), user, activeSession, messageId);
      return;
    }

    // 4. Parse Intent using Groq AI / Rule parser
    const parsed = await aiService.parseCommand(text, recipients);
    logger.info({ from: cleanFrom, intent: parsed.intent, parsed }, 'AI Command Parsed');

    switch (parsed.intent) {
      case CONSTANTS.INTENTS.SEND_MONEY:
        await this.handleSendMoney(cleanFrom, user, parsed, recipients, messageId);
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
        await this.sendHelpMessage(cleanFrom);
        break;

      default:
        const response = await aiService.generateResponse(text);
        await whatsappService.sendMessage(cleanFrom, response);
        break;
    }
  }

  /**
   * Process pending session responses (Confirmation or PIN entry)
   */
  async handleActiveSession(from, text, user, session, messageId) {
    const lower = text.toLowerCase();

    if (session.state === 'AWAITING_CONFIRMATION') {
      if (['yes', 'yup', 'yeah', 'confirm', 'proceed', 'send it', 'ok', 'okay', '1'].includes(lower)) {
        // User confirmed -> Check if user has set a PIN
        if (!user.pin_hash) {
          session.state = 'SETTING_PIN_FIRST';
          pendingSessions.set(from, session);
          await whatsappService.sendMessage(from, '🔐 You have not set a 4-digit PIN yet.\nPlease enter a new 4-digit PIN to secure your transfers:');
          return;
        }

        session.state = 'AWAITING_PIN';
        session.pinAttempts = 0;
        pendingSessions.set(from, session);

        await whatsappService.sendMessage(
          from,
          `🔒 *Security Authorization*\n\nPlease reply with your 4-digit PIN to authorize sending NGN ${session.amount.toLocaleString()} to ${session.recipientName}.`
        );
        return;
      }

      if (['no', 'cancel', 'stop', 'abort', 'don\'t', 'dont', '2'].includes(lower)) {
        pendingSessions.delete(from);
        await whatsappService.sendMessage(from, '❌ Transfer cancelled.');
        return;
      }

      await whatsappService.sendMessage(from, 'Please reply *YES* to confirm or *NO* to cancel.');
      return;
    }

    if (session.state === 'SETTING_PIN_FIRST') {
      if (/^\d{4}$/.test(text)) {
        const hash = await PinService.hashPin(text);
        await userContextService.updateUserPin(user.id, hash);
        user.pin_hash = hash;

        // Automatically move to execution since they just set and verified it
        await this.executeTransfer(from, user, session, messageId);
        return;
      }
      await whatsappService.sendMessage(from, '⚠️ PIN must be exactly 4 digits. Please try again:');
      return;
    }

    if (session.state === 'AWAITING_PIN') {
      if (!/^\d{4}$/.test(text)) {
        await whatsappService.sendMessage(from, '⚠️ Please enter your 4-digit numeric PIN:');
        return;
      }

      const isValid = await PinService.verifyPin(text, user.pin_hash);
      if (!isValid) {
        session.pinAttempts = (session.pinAttempts || 0) + 1;
        if (session.pinAttempts >= 3) {
          pendingSessions.delete(from);
          await whatsappService.sendMessage(from, '🚫 Maximum invalid PIN attempts reached. Transfer cancelled for your security.');
          return;
        }
        await whatsappService.sendMessage(from, `❌ Incorrect PIN (${3 - session.pinAttempts} attempt(s) remaining). Please try again:`);
        return;
      }

      // PIN valid -> Execute transfer
      await this.executeTransfer(from, user, session, messageId);
    }
  }

  /**
   * Handle natural language Send Money request
   */
  async handleSendMoney(from, user, parsed, recipients, messageId) {
    let amount = parsed.amount;
    let recipientName = parsed.recipientName;
    let accountNumber = parsed.accountNumber;
    let bankName = parsed.bankName;
    let bankCode = null;

    if (!amount || amount <= 0) {
      await whatsappService.sendMessage(from, '❓ How much would you like to send? (e.g. "Send 5000 to Mom")');
      return;
    }

    // Single transfer limit check
    if (amount > CONSTANTS.MAX_SINGLE_TRANSFER) {
      await whatsappService.sendMessage(from, `⚠️ Maximum single transfer limit is NGN ${CONSTANTS.MAX_SINGLE_TRANSFER.toLocaleString()}.`);
      return;
    }

    // Daily limit check
    const spentToday = await transactionService.getUserDailySpent(user.id);
    if (spentToday + amount > user.daily_limit) {
      const remaining = Math.max(0, user.daily_limit - spentToday);
      await whatsappService.sendMessage(
        from,
        `⚠️ Daily transfer limit reached!\nYour daily limit: NGN ${user.daily_limit.toLocaleString()}\nSpent today: NGN ${spentToday.toLocaleString()}\nRemaining allowance: NGN ${remaining.toLocaleString()}`
      );
      return;
    }

    // Resolve recipient from saved list if recipientName specified
    if (recipientName && !accountNumber) {
      const found = await recipientService.findByName(user.id, recipientName);
      if (found) {
        accountNumber = found.account_number;
        bankName = found.bank_name;
        bankCode = found.bank_code;
        recipientName = found.nickname || found.name;
      } else {
        await whatsappService.sendMessage(
          from,
          `🔍 Could not find "${recipientName}" in your contacts.\nTo transfer directly, say: "Send ${amount} to [Account Number] [Bank Name]"`
        );
        return;
      }
    }

    if (!accountNumber) {
      await whatsappService.sendMessage(from, '❓ Please provide the account number and bank name (e.g. "Send 5000 to 0123456789 Opay")');
      return;
    }

    // Resolve Bank Code
    if (!bankCode && bankName) {
      bankCode = await paymentService.resolveBankCode(bankName);
    }

    if (!bankCode) {
      await whatsappService.sendMessage(from, `❓ Could not recognize bank "${bankName || 'specified'}". Please specify a valid Nigerian bank (e.g. GTBank, Kuda, Opay, First Bank).`);
      return;
    }

    // Resolve Account Name with Bank
    await whatsappService.sendMessage(from, '🔍 Verifying account details with bank...');
    const verification = await paymentService.verifyAccount(accountNumber, bankCode);

    if (!verification.success) {
      await whatsappService.sendMessage(from, `❌ Could not verify account number ${accountNumber} with bank. ${verification.message || ''}`);
      return;
    }

    const resolvedAccountName = verification.accountName || recipientName || accountNumber;

    // Save pending session
    const session = {
      state: 'AWAITING_CONFIRMATION',
      amount,
      accountNumber,
      bankName: bankName || 'Bank',
      bankCode,
      recipientName: resolvedAccountName,
      timestamp: Date.now(),
      idempotencyKey: `tx_${messageId || Date.now()}_${Math.floor(Math.random() * 1000)}`,
    };

    pendingSessions.set(from, session);

    const confirmMsg = `💸 *Transfer Confirmation*\n\n` +
      `*Amount:* NGN ${amount.toLocaleString()}\n` +
      `*Account:* ${accountNumber}\n` +
      `*Name:* ${resolvedAccountName}\n` +
      `*Bank:* ${bankName || bankCode}\n\n` +
      `Reply *YES* to proceed or *NO* to cancel.`;

    await whatsappService.sendInteractiveButtons(from, confirmMsg, [
      { id: 'btn_yes', title: 'YES' },
      { id: 'btn_no', title: 'NO' },
    ]);
  }

  /**
   * Execute actual payout transfer and update single DB record
   */
  async executeTransfer(from, user, session, messageId) {
    await whatsappService.sendMessage(from, '⏳ Processing transfer with bank...');

    // 1. Single Pending DB Log with Idempotency Key
    let initialTx;
    try {
      initialTx = await transactionService.logTransaction({
        userId: user.id,
        recipientName: session.recipientName,
        accountNumber: session.accountNumber,
        bankName: session.bankName,
        amount: session.amount,
        idempotencyKey: session.idempotencyKey,
      });
    } catch (err) {
      pendingSessions.delete(from);
      await whatsappService.sendMessage(from, '❌ Transaction initialization failed. Money was NOT sent.');
      return;
    }

    // 2. Call Flutterwave Transfer API
    try {
      const result = await paymentService.transfer({
        amount: session.amount,
        accountNumber: session.accountNumber,
        bankCode: session.bankCode,
        narration: `GramPay payout to ${session.recipientName}`,
        reference: session.idempotencyKey,
      });

      // 3. Update single DB record status (NO double insertion!)
      await transactionService.updateStatus(initialTx.id, 'completed', {
        flwRef: result.reference,
        transferId: result.transferId,
      });

      pendingSessions.delete(from);

      const successMsg = `✅ *Transfer Successful!*\n\n` +
        `*Amount:* NGN ${session.amount.toLocaleString()}\n` +
        `*Recipient:* ${session.recipientName}\n` +
        `*Account:* ${session.accountNumber} (${session.bankName})\n` +
        `*Ref:* ${result.reference || result.transferId}`;

      await whatsappService.sendMessage(from, successMsg);
    } catch (error) {
      logger.error({ error: error.message, txId: initialTx.id }, 'Payout execution error');

      await transactionService.updateStatus(initialTx.id, 'failed', {
        errorReason: error.message,
      });

      pendingSessions.delete(from);
      await whatsappService.sendMessage(from, `❌ Transfer failed: ${error.message}`);
    }
  }

  /**
   * Save a recipient
   */
  async handleAddRecipient(from, user, parsed) {
    const { recipientName, accountNumber, bankName } = parsed;
    if (!accountNumber || !bankName) {
      await whatsappService.sendMessage(from, '❓ Please provide account number, bank name, and nickname (e.g. "Save Mom 0123456789 Kuda")');
      return;
    }

    const bankCode = await paymentService.resolveBankCode(bankName);
    const verification = await paymentService.verifyAccount(accountNumber, bankCode);
    const resolvedName = verification.accountName || recipientName || 'Saved Contact';

    await recipientService.addRecipient(user.id, {
      name: resolvedName,
      nickname: recipientName || resolvedName,
      accountNumber,
      bankName,
      bankCode,
    });

    await whatsappService.sendMessage(from, `✅ Saved *${recipientName || resolvedName}* (${accountNumber} - ${bankName}) to your contacts!`);
  }

  /**
   * Check user limits and daily spent
   */
  async handleCheckBalance(from, user) {
    const spentToday = await transactionService.getUserDailySpent(user.id);
    const remaining = Math.max(0, user.daily_limit - spentToday);

    const msg = `📊 *GramPay Account Limits*\n\n` +
      `*Daily Limit:* NGN ${user.daily_limit.toLocaleString()}\n` +
      `*Spent Today:* NGN ${spentToday.toLocaleString()}\n` +
      `*Remaining Today:* NGN ${remaining.toLocaleString()}`;

    await whatsappService.sendMessage(from, msg);
  }

  /**
   * List saved recipients
   */
  async handleListRecipients(from, recipients) {
    if (!recipients || recipients.length === 0) {
      await whatsappService.sendMessage(from, '📋 You have no saved contacts. To save one, say:\n"Save Mom 0123456789 Kuda"');
      return;
    }

    let msg = `📋 *Your Saved Contacts*\n\n`;
    recipients.forEach((r, i) => {
      msg += `${i + 1}. *${r.nickname || r.name}*: ${r.account_number} (${r.bank_name})\n`;
    });

    await whatsappService.sendMessage(from, msg);
  }

  /**
   * Handle user request to set/update PIN
   */
  async handleSetPinRequest(from, user, parsed) {
    if (parsed.pin) {
      const hash = await PinService.hashPin(parsed.pin);
      await userContextService.updateUserPin(user.id, hash);
      await whatsappService.sendMessage(from, '🔐 *PIN Updated Successfully!* Your 4-digit PIN is now set.');
      return;
    }

    pendingSessions.set(from, {
      state: 'SETTING_PIN_FIRST',
      timestamp: Date.now(),
    });

    await whatsappService.sendMessage(from, '🔐 Please enter your new 4-digit PIN:');
  }

  /**
   * Direct 4-digit PIN entry
   */
  async handleDirectPinEntry(from, user, pin) {
    const activeSession = pendingSessions.get(from);
    if (activeSession) {
      return this.handleActiveSession(from, pin, user, activeSession);
    }

    const hash = await PinService.hashPin(pin);
    await userContextService.updateUserPin(user.id, hash);
    await whatsappService.sendMessage(from, '🔐 Your 4-digit PIN has been set!');
  }

  /**
   * Help menu
   */
  async sendHelpMessage(from) {
    const helpMsg = `👋 *Welcome to GramPay!* Your AI Money Transfer Assistant.\n\n` +
      `Here is what you can say:\n` +
      `• *Send Money:* "Send 5000 to Mom" or "Transfer 2000 to 0123456789 Opay"\n` +
      `• *Save Contact:* "Save Bro 0581234567 GTBank"\n` +
      `• *Check Limits:* "Check balance" or "Daily limit"\n` +
      `• *Saved Contacts:* "List recipients"\n` +
      `• *Set PIN:* "Set PIN" or "Change PIN"\n`;

    await whatsappService.sendMessage(from, helpMsg);
  }
}

export const commandHandler = new CommandHandler();
