import axios from 'axios';
import crypto from 'crypto';
import { config } from './config.js';
import { supabase } from './supabase.js';

export class OpayPaymentService {
  constructor() {
    this.merchantId = config.opay.merchantId;
    this.publicKey = config.opay.publicKey;
    this.privateKey = config.opay.privateKey;
    this.baseUrl = config.opay.apiBaseUrl;
  }

  generateSignature(data) {
    const sortedKeys = Object.keys(data).sort();
    const signatureString = sortedKeys
      .map(key => `${key}=${data[key]}`)
      .join('&');

    const signature = crypto
      .createHmac('sha512', this.privateKey)
      .update(signatureString)
      .digest('hex');

    return signature;
  }

  async transfer(amount, accountNumber, bankCode = '058', reference = null) {
    try {
      const transactionRef = reference || `TXN_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const requestData = {
        merchantId: this.merchantId,
        reference: transactionRef,
        amount: Math.round(amount * 100),
        currency: 'NGN',
        receiver: {
          bankAccountNumber: accountNumber,
          bankCode: bankCode,
          name: 'Recipient'
        },
        country: 'NG'
      };

      const signature = this.generateSignature(requestData);

      const response = await axios.post(
        `${this.baseUrl}/api/v1/international/cashout/initialize`,
        requestData,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.publicKey}`,
            'MerchantId': this.merchantId,
            'Signature': signature
          }
        }
      );

      console.log('Opay transfer response:', response.data);

      if (response.data.code === '00000' || response.data.message === 'SUCCESSFUL') {
        return {
          success: true,
          reference: transactionRef,
          opayReference: response.data.data?.reference || transactionRef,
          message: 'Transfer successful',
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
      console.error('Opay transfer error:', error.response?.data || error.message);
      return {
        success: false,
        message: error.response?.data?.message || error.message || 'Transfer failed',
        error: error.response?.data || error.message
      };
    }
  }

  async checkBalance() {
    try {
      const requestData = {
        merchantId: this.merchantId
      };

      const signature = this.generateSignature(requestData);

      const response = await axios.post(
        `${this.baseUrl}/api/v1/international/balance/query`,
        requestData,
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.publicKey}`,
            'MerchantId': this.merchantId,
            'Signature': signature
          }
        }
      );

      console.log('Opay balance response:', response.data);

      if (response.data.code === '00000' || response.data.message === 'SUCCESSFUL') {
        const balance = response.data.data?.balance || 0;
        return {
          success: true,
          balance: balance / 100,
          currency: 'NGN',
          message: `Balance: ₦${(balance / 100).toLocaleString()}`
        };
      } else {
        return {
          success: false,
          message: 'Failed to retrieve balance'
        };
      }
    } catch (error) {
      console.error('Opay balance check error:', error.response?.data || error.message);
      return {
        success: false,
        message: 'Failed to check balance',
        error: error.response?.data || error.message
      };
    }
  }

  validateAccountNumber(accountNumber) {
    const cleaned = accountNumber.replace(/\D/g, '');
    return cleaned.length === 10;
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

export const opayService = new OpayPaymentService();
export const transactionService = new TransactionService();
