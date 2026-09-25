import axios from 'axios';
import { config } from '../config/env.js';
import { CONSTANTS } from '../config/constants.js';
import { logger } from '../lib/logger.js';
import { PaymentError } from '../lib/errors.js';

export class FlutterwavePaymentService {
  constructor() {
    this.secretKey = config.flutterwave.secretKey;
    this.webhookSecret = config.flutterwave.webhookSecret;
    this.baseUrl = CONSTANTS.FLUTTERWAVE_BASE_URL;
    
    // In-memory cache for Nigerian bank list
    this.banksCache = null;
    this.banksCacheExpiry = 0;
  }

  get headers() {
    return {
      'Authorization': `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Fetch Nigerian bank list from Flutterwave (cached for 24h)
   */
  async getBanks() {
    const now = Date.now();
    if (this.banksCache && now < this.banksCacheExpiry) {
      return this.banksCache;
    }

    try {
      const response = await axios.get(`${this.baseUrl}/banks/NG`, { headers: this.headers });
      if (response.data?.status === 'success' && Array.isArray(response.data?.data)) {
        this.banksCache = response.data.data;
        this.banksCacheExpiry = now + (24 * 60 * 60 * 1000); // 24h
        return this.banksCache;
      }
      return this.getDefaultBankList();
    } catch (error) {
      logger.error({ error: error.message }, 'Failed to fetch bank list from Flutterwave. Using fallback bank list.');
      return this.getDefaultBankList();
    }
  }

  /**
   * Comprehensive default Nigerian bank list with aliases
   */
  getDefaultBankList() {
    return [
      { code: '090360', name: 'Opay', aliases: ['opay', 'paycom', 'opay digital', 'opay microfinance'] },
      { code: '090267', name: 'Kuda Bank', aliases: ['kuda', 'kudabank', 'kuda microfinance'] },
      { code: '090405', name: 'Moniepoint', aliases: ['moniepoint', 'moniepoint microfinance', 'moniepoint bank'] },
      { code: '090175', name: 'Palmpay', aliases: ['palmpay', 'palm pay'] },
      { code: '058', name: 'Guaranty Trust Bank', aliases: ['gtb', 'gtbank', 'guaranty trust'] },
      { code: '057', name: 'Zenith Bank', aliases: ['zenith', 'zenithbank'] },
      { code: '044', name: 'Access Bank', aliases: ['access', 'accessbank'] },
      { code: '011', name: 'First Bank of Nigeria', aliases: ['firstbank', 'first bank', 'fbn'] },
      { code: '033', name: 'United Bank For Africa', aliases: ['uba', 'united bank for africa'] },
      { code: '214', name: 'First City Monument Bank', aliases: ['fcmb', 'first city monument'] },
      { code: '221', name: 'Stanbic IBTC Bank', aliases: ['stanbic', 'stanbic ibtc'] },
      { code: '232', name: 'Sterling Bank', aliases: ['sterling', 'sterlingbank'] },
      { code: '035', name: 'Wema Bank', aliases: ['wema', 'alat', 'alat by wema'] },
      { code: '076', name: 'Polaris Bank', aliases: ['polaris', 'skye'] },
      { code: '032', name: 'Union Bank of Nigeria', aliases: ['union', 'unionbank'] },
      { code: '050', name: 'Ecobank Nigeria', aliases: ['ecobank'] },
      { code: '215', name: 'Unity Bank', aliases: ['unity', 'unitybank'] },
      { code: '082', name: 'Keystone Bank', aliases: ['keystone'] },
      { code: '301', name: 'JAIZ Bank', aliases: ['jaiz'] },
    ];
  }

  /**
   * Resolve bank name/query to exact Flutterwave bank code
   * @param {string} bankQuery (e.g. "opay", "kuda", "gtb", "guaranty trust")
   * @returns {Promise<string|null>}
   */
  async resolveBankCode(bankQuery) {
    if (!bankQuery) return null;
    const query = bankQuery.trim().toLowerCase().replace(/[.,!?]+$/, '').trim();
    const banks = await this.getBanks();

    // 1. Direct match on code
    const codeMatch = banks.find(b => b.code === query);
    if (codeMatch) return codeMatch.code;

    // 2. Exact match on bank name
    const exactNameMatch = banks.find(b => b.name.toLowerCase() === query);
    if (exactNameMatch) return exactNameMatch.code;

    // 3. Match on aliases array
    const aliasMatch = banks.find(b => {
      if (b.aliases && Array.isArray(b.aliases)) {
        return b.aliases.some(alias => alias === query || query.includes(alias) || alias.includes(query));
      }
      return false;
    });
    if (aliasMatch) return aliasMatch.code;

    // 4. Substring match on bank name
    const partialMatch = banks.find(b => {
      const name = b.name.toLowerCase();
      return name.includes(query) || query.includes(name);
    });

    return partialMatch ? partialMatch.code : null;
  }

  /**
   * Verify bank account number and return account name
   */
  async verifyAccount(accountNumber, bankCode) {
    const isTestKey = !this.secretKey || this.secretKey.startsWith('FLWSECK_TEST');

    if (!this.secretKey) {
      return { success: true, accountName: 'Test Account (Simulated)' };
    }

    try {
      const response = await axios.post(`${this.baseUrl}/accounts/resolve`, {
        account_number: accountNumber,
        account_bank: bankCode,
      }, { headers: this.headers });

      if (response.data?.status === 'success') {
        return {
          success: true,
          accountName: response.data.data.account_name,
          accountNumber: response.data.data.account_number,
        };
      }

      if (isTestKey) {
        logger.info({ accountNumber, bankCode }, 'Flutterwave Sandbox Test Key in use: Account resolution simulated.');
        return { success: true, accountName: 'Simulated Verified Account' };
      }

      return { success: false, message: response.data?.message || 'Account resolution failed' };
    } catch (error) {
      const errorMsg = error.response?.data?.message || error.message;
      logger.error({ accountNumber, bankCode, error: error.response?.data || error.message }, 'Bank account resolution error');
      
      if (isTestKey) {
        logger.info({ accountNumber, bankCode }, 'Flutterwave Sandbox Test Key in use: Simulating verified account for sandbox testing.');
        return { success: true, accountName: 'Simulated Verified Account' };
      }

      return { success: false, message: errorMsg || 'Could not resolve account details with bank' };
    }
  }

  /**
   * Execute Flutterwave payout transfer
   */
  async transfer({ amount, accountNumber, bankCode, narration = 'GramPay Transfer', reference = null }) {
    if (!this.secretKey) {
      logger.warn({ amount, accountNumber, bankCode }, '⚠️ Flutterwave secret key missing! Simulating successful payment.');
      return {
        success: true,
        transferId: 'sim_' + Date.now(),
        reference: reference || 'sim_ref_' + Date.now(),
        status: 'SUCCESSFUL',
        simulated: true,
      };
    }

    if (!bankCode) {
      throw new PaymentError('Bank code is required for bank transfer');
    }

    const txRef = reference || `grampay_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

    const payload = {
      account_bank: bankCode,
      account_number: accountNumber,
      amount: Number(amount),
      narration: narration,
      currency: CONSTANTS.DEFAULT_CURRENCY,
      reference: txRef,
      callback_url: `${process.env.APP_URL || 'https://grampay-3m3e.onrender.com'}/api/flutterwave/webhook`,
      debit_currency: CONSTANTS.DEFAULT_CURRENCY,
    };

    try {
      const response = await axios.post(`${this.baseUrl}/transfers`, payload, { headers: this.headers });
      
      if (response.data?.status === 'success') {
        const data = response.data.data;
        logger.info({ txRef, transferId: data.id, status: data.status }, '✅ Flutterwave transfer initiated');
        return {
          success: true,
          transferId: data.id,
          reference: data.reference,
          status: data.status, // PENDING, NEW, SUCCESSFUL
          data: data,
        };
      }

      throw new PaymentError(response.data?.message || 'Transfer failed at provider');
    } catch (error) {
      const msg = error.response?.data?.message || error.message;
      logger.error({ error: error.response?.data || error.message, payload }, '❌ Flutterwave transfer execution failed');
      throw new PaymentError(msg);
    }
  }

  /**
   * Verify Flutterwave Webhook Signature (verif-hash header)
   */
  verifyWebhookSignature(signatureHeader) {
    if (!this.webhookSecret) {
      logger.warn('⚠️ FLW_WEBHOOK_SECRET not set in env. Webhook signature check will pass in non-prod mode.');
      return process.env.NODE_ENV !== 'production';
    }
    return signatureHeader === this.webhookSecret;
  }
}

export const paymentService = new FlutterwavePaymentService();
