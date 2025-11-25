import { parseCommand } from './ai.js';
import { recipientService } from './recipients.js';
import { opayService, transactionService } from './payments.js';
import { whatsappService } from './whatsapp.js';
import { supabase } from './supabase.js';

const pendingConfirmations = new Map();

export class CommandHandler {
  async handleMessage(from, message, messageId) {
    try {
      if (pendingConfirmations.has(from)) {
        return await this.handleConfirmation(from, message);
      }

      const parsedCommand = await parseCommand(message);

      if (parsedCommand.clarificationNeeded) {
        return parsedCommand.clarificationMessage;
      }

      switch (parsedCommand.action) {
        case 'send_money':
          return await this.handleSendMoney(from, message, parsedCommand);

        case 'add_recipient':
          return await this.handleAddRecipient(parsedCommand);

        case 'list_recipients':
          return await this.handleListRecipients();

        case 'check_balance':
          return await this.handleCheckBalance();

        case 'transaction_history':
          return await this.handleTransactionHistory();

        case 'delete_recipient':
          return await this.handleDeleteRecipient(parsedCommand);

        case 'set_pin':
          return await this.handleSetPin(parsedCommand);

        case 'help':
          return await this.handleHelp();

        default:
          return this.getHelpMessage();
      }
    } catch (error) {
      console.error('Error handling command:', error);
      return '❌ An error occurred while processing your request. Please try again.';
    }
  }

  async handleSendMoney(from, originalMessage, parsedCommand) {
    try {
      const { amount, recipient } = parsedCommand;

      if (!amount || !recipient) {
        return 'Please specify both amount and recipient. Example: "send 2000 to Mom"';
      }

      const recipientData = await recipientService.getRecipientByNickname(recipient);
      if (!recipientData) {
        return `❌ Recipient "${recipient}" not found. Add them first by saying "add contact ${recipient} [account number]"`;
      }

      const botConfig = await this.getBotConfig();
      if (!botConfig.active_status) {
        return '🔒 Bot is currently paused. Please contact administrator.';
      }

      const todaysTotal = await transactionService.getTodaysTotalSpent();
      if (todaysTotal + amount > botConfig.daily_limit) {
        return `❌ Daily limit exceeded. You've spent ₦${todaysTotal.toLocaleString()} today. Limit: ₦${botConfig.daily_limit.toLocaleString()}`;
      }

      const confirmationData = {
        amount,
        recipient: recipientData.nickname,
        accountNumber: recipientData.account_number,
        bankName: recipientData.bank_name,
        originalMessage,
        timestamp: Date.now()
      };

      pendingConfirmations.set(from, confirmationData);

      setTimeout(() => {
        if (pendingConfirmations.has(from)) {
          pendingConfirmations.delete(from);
        }
      }, 120000);

      return `💰 Transfer Confirmation\n\nAmount: ₦${amount.toLocaleString()}\nTo: ${recipientData.nickname}\nAccount: ${recipientData.account_number}\nBank: ${recipientData.bank_name}\n\nReply "YES" to confirm or "NO" to cancel.`;
    } catch (error) {
      console.error('Error in handleSendMoney:', error);
      return '❌ Failed to process transfer request';
    }
  }

  async handleConfirmation(from, message) {
    const confirmation = pendingConfirmations.get(from);
    if (!confirmation) {
      return 'No pending confirmation found.';
    }

    const response = message.trim().toUpperCase();

    if (response !== 'YES' && response !== 'NO') {
      return 'Please reply "YES" to confirm or "NO" to cancel.';
    }

    pendingConfirmations.delete(from);

    if (response === 'NO') {
      return '❌ Transfer cancelled.';
    }

    try {
      await transactionService.logTransaction(
        confirmation.amount,
        confirmation.recipient,
        confirmation.accountNumber,
        confirmation.bankName,
        'pending',
        null,
        confirmation.originalMessage
      );

      const transferResult = await opayService.transfer(
        confirmation.amount,
        confirmation.accountNumber
      );

      if (transferResult.success) {
        await transactionService.logTransaction(
          confirmation.amount,
          confirmation.recipient,
          confirmation.accountNumber,
          confirmation.bankName,
          'completed',
          transferResult.opayReference,
          confirmation.originalMessage
        );

        return `✅ Transfer Successful!\n\n₦${confirmation.amount.toLocaleString()} sent to ${confirmation.recipient}\n\nReference: ${transferResult.opayReference}`;
      } else {
        await transactionService.logTransaction(
          confirmation.amount,
          confirmation.recipient,
          confirmation.accountNumber,
          confirmation.bankName,
          'failed',
          transferResult.reference,
          confirmation.originalMessage,
          transferResult.message
        );

        return `❌ Transfer Failed\n\n${transferResult.message}\n\nPlease try again or contact support.`;
      }
    } catch (error) {
      console.error('Error processing transfer:', error);
      return '❌ An error occurred while processing the transfer. Please try again.';
    }
  }

  async handleAddRecipient(parsedCommand) {
    const { recipient, accountNumber, bankName } = parsedCommand;

    if (!recipient || !accountNumber) {
      return 'Please provide both nickname and account number. Example: "add contact Mom 8012345678"';
    }

    if (!opayService.validateAccountNumber(accountNumber)) {
      return '❌ Invalid account number. Please provide a valid 10-digit account number.';
    }

    const result = await recipientService.addRecipient(
      recipient,
      accountNumber,
      bankName || 'Unknown Bank'
    );

    return result.message;
  }

  async handleListRecipients() {
    const result = await recipientService.listRecipients();
    return result.message;
  }

  async handleCheckBalance() {
    const result = await opayService.checkBalance();
    return result.success ? `💰 ${result.message}` : `❌ ${result.message}`;
  }

  async handleTransactionHistory() {
    const result = await transactionService.getTransactionHistory(10);
    return result.message;
  }

  async handleDeleteRecipient(parsedCommand) {
    const { recipient } = parsedCommand;

    if (!recipient) {
      return 'Please specify the recipient to delete. Example: "delete Mom"';
    }

    const result = await recipientService.deleteRecipient(recipient);
    return result.message;
  }

  async handleSetPin(parsedCommand) {
    const { pin } = parsedCommand;

    if (!pin || !/^\d{4}$/.test(pin)) {
      return '❌ PIN must be exactly 4 digits. Example: "set pin 1234"';
    }

    try {
      const { data: config } = await supabase
        .from('bot_config')
        .select('*')
        .limit(1)
        .single();

      if (config) {
        await supabase
          .from('bot_config')
          .update({ pin, updated_at: new Date().toISOString() })
          .eq('id', config.id);
      }

      return '✅ PIN updated successfully';
    } catch (error) {
      console.error('Error setting PIN:', error);
      return '❌ Failed to update PIN';
    }
  }

  async handleHelp() {
    return this.getHelpMessage();
  }

  getHelpMessage() {
    return `🤖 WhatsApp Money Assistant

Commands you can use:

💸 Send Money:
"send 2000 to Mom"
"transfer 5000 to John"

👥 Manage Recipients:
"add contact Mom 8012345678"
"list contacts"
"delete Mom"

💰 Account Info:
"check balance"
"transaction history"

🔒 Security:
"set pin 1234"

Need help? Just ask!`;
  }

  async getBotConfig() {
    try {
      const { data, error } = await supabase
        .from('bot_config')
        .select('*')
        .limit(1)
        .maybeSingle();

      if (error) throw error;

      return data || { active_status: true, daily_limit: 100000 };
    } catch (error) {
      console.error('Error getting bot config:', error);
      return { active_status: true, daily_limit: 100000 };
    }
  }
}

export const commandHandler = new CommandHandler();
