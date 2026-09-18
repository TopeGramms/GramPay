import axios from 'axios';
import crypto from 'crypto';
import { config } from './config.js';
import { supabase } from './supabase.js';

export class FlutterwavePaymentService {
  constructor() {
    this.secretKey = config.flutterwave.secretKey;
    this.webhookSecret = config.flutterwave.webhookSecret;
    this.callbackUrl = config.flutterwave.transferCallbackUrl;
    this.baseUrl = config.flutterwave.apiBaseUrl;
  }

  async transfer(amount, accountNumber, bankCode, reference = null) {
    try {
      if (!this.secretKey || !bankCode) return { success: false, message: 'Payout service is not configured.' };
      const transactionRef = reference || `GP_${crypto.randomUUID()}`;

      const requestData = {
        reference: transactionRef,
        amount,
        currency: 'NGN',
        account_number: accountNumber,
        account_bank: bankCode,
        narration: 'GramPay private beta payout',
        callback_url: this.callbackUrl
      };
      const response = await axios.post(
        `${this.baseUrl}/transfers`,
        requestData,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.secretKey}`
          }
        }
      );
      if (response.data.status === 'success') {
        return {
          success: true,
          reference: transactionRef,
          opayReference: response.data.data?.id?.toString() || transactionRef,
          message: 'Transfer initiated',
          data: response.data
        };
      } else {
        return {
          success: false,
          reference: transactionRef,
          message: response.data.message || 'Transfer failed',
          error: response.data
        };
      }
    } catch (error) {
      console.error('Flutterwave transfer error:', error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Transfer failed',
        error: error.response?.data || error.message
      };
    }
  }

  async checkBalance() { return { success: false, message: 'Balance is not exposed during the private beta.' }; }

  validateAccountNumber(accountNumber) {
    const cleaned = accountNumber.replace(/\D/g, '');
    return cleaned.length === 10;
  }

  async handleWebhook(data, signature) {
    try {
      if (!this.webhookSecret || signature !== this.webhookSecret) {
        return { success: false, message: 'Invalid signature' };
      }
      const transfer = data.data || {};
      const { reference } = transfer;
      const status = transfer.status;
      let transactionStatus = 'pending';
      if (status === 'SUCCESSFUL') {
        transactionStatus = 'completed';
      } else if (status === 'FAILED') {
        transactionStatus = 'failed';
      }

      // 3. Update transaction in database
      const { data: transaction, error } = await supabase
        .from('transactions')
        .update({
          status: transactionStatus,
          opay_reference: transfer.id?.toString() || reference
        })
        .eq('opay_reference', reference)
        .select()
        .single();

      if (error) {
        // PGRST116 = no rows found, which is expected for test data
        if (error.code === 'PGRST116') {
          console.log('ℹ️ No matching transaction found for reference:', reference);
          return { success: true, message: 'No matching transaction (webhook acknowledged)' };
        }
        console.error('Error updating transaction from webhook:', error);
        return { success: false, message: 'Database update failed' };
      }

      return {
        success: true,
        message: 'Webhook processed',
        data: transaction
      };

    } catch (error) {
      console.error('Webhook processing error:', error);
      return { success: false, message: error.message };
    }
  }
}

export class TransactionService {
  async logTransaction(amount, recipientNickname, accountNumber, bankName, status, opayReference, messageFromUser, errorMessage = null) {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .insert({
          amount,
          recipient_nickname: recipientNickname,
          account_number: accountNumber,
          bank_name: bankName,
          status,
          opay_reference: opayReference,
          message_from_user: messageFromUser,
          error_message: errorMessage
        })
        .select()
        .single();

      if (error) throw error;

      console.log('Transaction logged:', data);
      return data;
    } catch (error) {
      console.error('Error logging transaction:', error);
      throw error;
    }
  }

  async getTransactionHistory(limit = 10) {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;

      if (!data || data.length === 0) {
        return {
          success: true,
          message: 'No transactions yet',
          data: []
        };
      }

      const transactionList = data
        .map((t, i) => {
          const date = new Date(t.created_at).toLocaleString('en-NG', { dateStyle: 'short', timeStyle: 'short' });
          const statusIcon = t.status === 'completed' ? '✅' : t.status === 'failed' ? '❌' : '⏳';
          return `${i + 1}. ${statusIcon} ₦${t.amount.toLocaleString()} to ${t.recipient_nickname} - ${date}`;
        })
        .join('\n');

      return {
        success: true,
        message: `📊 Recent Transactions:\n\n${transactionList}`,
        data
      };
    } catch (error) {
      console.error('Error getting transaction history:', error);
      return {
        success: false,
        message: 'Failed to retrieve transactions'
      };
    }
  }

  async getTodaysTotalSpent() {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('transactions')
        .select('amount')
        .eq('status', 'completed')
        .gte('created_at', today.toISOString());

      if (error) throw error;

      const total = data.reduce((sum, t) => sum + parseFloat(t.amount), 0);
      return total;
    } catch (error) {
      console.error('Error calculating daily total:', error);
      return 0;
    }
  }
}

export const opayService = new FlutterwavePaymentService();
export const transactionService = new TransactionService();
