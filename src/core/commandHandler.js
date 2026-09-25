import { aiService } from '../services/ai.js';
import { whatsappService } from '../services/whatsappCloud.js';
import { paymentService } from '../services/payment.js';
import { recipientService } from '../services/recipient.js';
import { transactionService } from '../services/transaction.js';
import { PinService } from '../services/pin.js';
import { userContextService } from './userContext.js';
import { CONSTANTS } from '../config/constants.js';
import { logger } from '../lib/logger.js';

// In-memory conversation state store with 5-minute TTL
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
    const cleanText = text.trim();
    logger.info({ from: cleanFrom, text: cleanText }, '📩 Processing incoming WhatsApp message');

    // 1. Resolve User Context
    const user = await userContextService.resolveUser(cleanFrom);
    if (!user || !user.is_active) {
      await whatsappService.sendMessage(cleanFrom, '⚠️ Your account is currently inactive. Please contact support.');
      return;
    }

    // 2. Fetch User Recipients
    const recipients = await recipientService.getRecipients(user.id);

    // 3. Check for Active Multi-Step Guided Session
    const activeSession = pendingSessions.get(cleanFrom);
    if (activeSession) {
      // Check session expiry (5 minutes)
      if (Date.now() - activeSession.timestamp > CONSTANTS.CONFIRMATION_TTL_MS) {
        pendingSessions.delete(cleanFrom);
        await whatsappService.sendMessage(cleanFrom, '⏳ Session timed out. Let\'s start your request again.');
        return;
      }

      await this.handleActiveSession(cleanFrom, cleanText, user, activeSession, messageId, recipients);
      return;
    }

    // 4. Parse Intent & Entities
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
        await this.sendHelpMessage(cleanFrom);
        break;

      default:
        const response = await aiService.generateResponse(cleanText);
        await whatsappService.sendMessage(cleanFrom, response);
        break;
    }
  }

  /**
   * Guided Multi-Turn Conversation State Machine
   */
  async handleActiveSession(from, text, user, session, messageId, recipients) {
    const lower = text.toLowerCase().trim();

    // Global Cancel
    if (['no', 'cancel', 'stop', 'abort', 'don\'t', 'dont', 'exit'].includes(lower)) {
      pendingSessions.delete(from);
      await whatsappService.sendMessage(from, '❌ Transfer request cancelled.');
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
        session.bankCode = foundFoundCode(foundContact.bank_code);
        session.recipientName = foundContact.nickname || foundContact.name;
        await this.verifyAndPromptConfirmation(from, user, session, messageId);
        return;
      }

      await whatsappService.sendMessage(
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

      await whatsappService.sendMessage(from, '❓ Please enter a valid transfer amount (e.g., `5000` or `5k`):');
      return;
    }

    // -------------------------------------------------------------
    // STATE 3: AWAITING_BANK_SELECTION (Account number known, waiting for bank)
    // -------------------------------------------------------------
    if (session.state === 'AWAITING_BANK_SELECTION') {
      const bankCode = await paymentService.resolveBankCode(text);
      if (!bankCode) {
        await whatsappService.sendMessage(
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
          await whatsappService.sendMessage(from, '🔐 You have not set a 4-digit PIN yet.\nPlease enter a new 4-digit PIN to secure your transfers:');
          return;
        }

        session.state = 'AWAITING_PIN';
        session.pinAttempts = 0;
        pendingSessions.set(from, session);

        await whatsappService.sendMessage(
          from,
          `🔒 *Security Authorization*\n\nPlease reply with your **4-digit PIN** to authorize sending **NGN ${session.amount.toLocaleString()}** to **${session.recipientName}**.`
        );
        return;
      }

      await whatsappService.sendMessage(from, 'Please reply *YES* to confirm or *NO* to cancel.');
      return;
    }

    // -------------------------------------------------------------
    // STATE 5: SETTING_PIN_FIRST
    // -------------------------------------------------------------
    if (session.state === 'SETTING_PIN_FIRST') {
      if (/^\d{4}$/.test(text)) {
        const hash = await PinService.hashPin(text);
        await userContextService.updateUserPin(user.id, hash);
        user.pin_hash = hash;
        await this.executeTransfer(from, user, session, messageId);
        return;
      }
      await whatsappService.sendMessage(from, '⚠️ PIN must be exactly 4 digits. Please enter a valid 4-digit PIN:');
      return;
    }

    // -------------------------------------------------------------
    // STATE 6: AWAITING_PIN (Authorizing transfer)
    // -------------------------------------------------------------
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
          await whatsappService.sendMessage(from, '🚫 Maximum invalid PIN attempts reached. Transfer cancelled for security.');
          return;
        }
        await whatsappService.sendMessage(from, `❌ Incorrect PIN (${3 - session.pinAttempts} attempt(s) remaining). Please try again:`);
        return;
      }

      // PIN valid -> Execute payout
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
    const session = {
      state: 'INIT',
      amount,
      recipientName,
      accountNumber,
      bankName,
      bankCode: null,
      timestamp: Date.now(),
      idempotencyKey: `tx_${messageId || Date.now()}_${Math.floor(Math.random() * 1000)}`,
    };

    // Case 1: Neither Amount nor Recipient is specified
    if (!amount && !accountNumber && !recipientName) {
      await whatsappService.sendMessage(from, '💬 Who would you like to send money to, and how much? (e.g. "Send 5k to Mom" or "Transfer 2000 to 0123456789 Opay")');
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

        await whatsappService.sendMessage(
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

      await whatsappService.sendMessage(
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
        await whatsappService.sendMessage(
          from,
          `🔍 Could not find "${recipientName}" in your contacts.\nTo transfer directly, please reply with an account number and bank name (e.g., \`0123456789 Opay\`).`
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
    await whatsappService.sendInteractiveButtons(from, text, buttons);
  }

  /**
   * Resolve Account with Flutterwave and Display Verification Confirmation Card
   */
  async verifyAndPromptConfirmation(from, user, session, messageId) {
    if (!session.amount || session.amount <= 0) {
      session.state = 'AWAITING_AMOUNT';
      pendingSessions.set(from, session);
      await whatsappService.sendMessage(from, '❓ How much would you like to transfer?');
      return;
    }

    // Limits Validation
    if (session.amount > CONSTANTS.MAX_SINGLE_TRANSFER) {
      pendingSessions.delete(from);
      await whatsappService.sendMessage(from, `⚠️ Maximum single transfer limit is NGN ${CONSTANTS.MAX_SINGLE_TRANSFER.toLocaleString()}.`);
      return;
    }

    const spentToday = await transactionService.getUserDailySpent(user.id);
    if (spentToday + session.amount > user.daily_limit) {
      pendingSessions.delete(from);
      const remaining = Math.max(0, user.daily_limit - spentToday);
      await whatsappService.sendMessage(
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
    await whatsappService.sendMessage(from, '🔍 Verifying account details with bank...');
    const verification = await paymentService.verifyAccount(session.accountNumber, session.bankCode);

    if (!verification.success) {
      pendingSessions.delete(from);
      await whatsappService.sendMessage(
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

      // 3. Update DB record status
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
      `You can chat naturally with me, for example:\n` +
      `• *"Send 5000 to Mom"*\n` +
      `• *"Transfer 2000 to 0123456789 Opay"*\n` +
      `• *"Send 4k"*\n` +
      `• *"Save Bro 0581234567 GTBank"*\n` +
      `• *"Check limits"*\n` +
      `• *"Set PIN"*\n`;

    await whatsappService.sendMessage(from, helpMsg);
  }
}

export const commandHandler = new CommandHandler();
