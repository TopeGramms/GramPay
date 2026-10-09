import crypto from 'crypto';
import axios from 'axios';
import { config } from '../config/env.js';
import { CONSTANTS } from '../config/constants.js';
import { logger } from '../lib/logger.js';
import { PaymentError } from '../lib/errors.js';

export class FlutterwavePaymentService {
  constructor() {
    this.secretKey = config.flutterwave.secretKey;
    this.webhookSecret = config.flutterwave.webhookSecret;
    this.billPaymentsEnabled = config.flutterwave.billPaymentsEnabled;
    this.baseUrl = CONSTANTS.FLUTTERWAVE_BASE_URL;
    
    // In-memory cache for Nigerian bank list
    this.banksCache = null;
    this.banksCacheExpiry = 0;
    this.billCatalogCache = new Map();
  }

  get headers() {
    return {
      'Authorization': `Bearer ${this.secretKey}`,
      'Content-Type': 'application/json',
    };
  }

  async getBillCategories() {
    return this.getCachedBillData('categories', async () => {
      const response = await axios.get(`${this.baseUrl}/top-bill-categories`, {
        headers: this.headers,
        params: { country: 'NG' },
        timeout: 15000,
      });
      if (response.data?.status !== 'success' || !Array.isArray(response.data?.data)) {
        throw new PaymentError(response.data?.message || 'Could not load Flutterwave bill categories');
      }
      return response.data.data;
    });
  }

  async getBillers(categoryCode) {
    const cacheKey = `billers:${categoryCode}`;
    return this.getCachedBillData(cacheKey, async () => {
      const response = await axios.get(`${this.baseUrl}/bills/${encodeURIComponent(categoryCode)}/billers`, {
        headers: this.headers,
        params: { country: 'NG' },
        timeout: 15000,
      });
      if (response.data?.status !== 'success' || !Array.isArray(response.data?.data)) {
        throw new PaymentError(response.data?.message || 'Could not load mobile networks from Flutterwave');
      }
      return response.data.data;
    });
  }

  async getBillItems(billerCode) {
    const cacheKey = `items:${billerCode}`;
    return this.getCachedBillData(cacheKey, async () => {
      const response = await axios.get(`${this.baseUrl}/billers/${encodeURIComponent(billerCode)}/items`, {
        headers: this.headers,
        timeout: 15000,
      });
      if (response.data?.status !== 'success' || !Array.isArray(response.data?.data)) {
        throw new PaymentError(response.data?.message || 'Could not load mobile plans from Flutterwave');
      }
      return response.data.data;
    });
  }

  async getMobileBiller(product, network) {
    const categories = await this.getBillCategories();
    const categoryName = product === 'data' ? 'mobile data' : 'airtime';
    const category = categories.find(item =>
      `${item.code || ''} ${item.name || ''}`.toLowerCase().includes(categoryName)
    );
    if (!category?.code) throw new PaymentError(`Flutterwave does not list a ${product} category`);

    const billers = await this.getBillers(category.code);
    const aliases = {
      mtn: ['mtn'],
      airtel: ['airtel'],
      glo: ['glo', 'globacom'],
      '9mobile': ['9mobile', 'etisalat'],
    }[network] || [network];
    const biller = billers.find(item => {
      const searchable = `${item.name || ''} ${item.short_name || ''} ${item.description || ''}`.toLowerCase();
      return aliases.some(alias => searchable.includes(alias));
    });
    if (!biller?.biller_code) {
      throw new PaymentError(`Flutterwave does not currently list ${network} for ${product}`);
    }

    const items = await this.getBillItems(biller.biller_code);
    return { category, biller, items };
  }

  async createBillPayment({ billerCode, itemCode, customerPhone, amount, reference }) {
    if (!config.flutterwave.billPaymentsEnabled) {
      throw new PaymentError('Airtime and data purchases are disabled. Set FLW_BILL_PAYMENTS_ENABLED=true to enable testing.');
    }
    if (!this.secretKey) throw new PaymentError('Flutterwave secret key is not configured');
    if (!billerCode || !itemCode || !customerPhone || !reference) {
      throw new PaymentError('Required bill payment details are missing');
    }

    const appUrl = (process.env.APP_URL || 'https://grampay-3m3e.onrender.com').replace(/\/$/, '');
    const response = await axios.post(
      `${this.baseUrl}/billers/${encodeURIComponent(billerCode)}/items/${encodeURIComponent(itemCode)}/payment`,
      {
        country: 'NG',
        customer_id: customerPhone,
        amount: Number(amount),
        reference,
        callback_url: `${appUrl}/api/flutterwave/webhook`,
      },
      { headers: this.headers, timeout: 20000 },
    );

    if (response.data?.status !== 'success') {
      throw new PaymentError(response.data?.message || 'Flutterwave did not accept the bill payment');
    }
    return response.data;
  }

  async getBillPaymentStatus(reference) {
    if (!this.secretKey) throw new PaymentError('Flutterwave secret key is not configured');
    const response = await axios.get(`${this.baseUrl}/bills/${encodeURIComponent(reference)}`, {
      headers: this.headers,
      params: { verbose: 1 },
      timeout: 15000,
    });
    if (response.data?.status !== 'success' || !response.data?.data) {
      throw new PaymentError(response.data?.message || 'Could not verify bill payment status');
    }
    return response.data.data;
  }

  async getCachedBillData(key, load) {
    const cached = this.billCatalogCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.data;
    const data = await load();
    this.billCatalogCache.set(key, { data, expiresAt: Date.now() + 5 * 60 * 1000 });
    return data;
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
    const isTestKey = Boolean(this.secretKey && this.secretKey.startsWith('FLWSECK_TEST'));

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

      if (isTestKey) {
        logger.warn({ txRef, message: response.data?.message }, 'Flutterwave Sandbox test transfer simulation fallback');
        return {
          success: true,
          transferId: 'flw_test_' + Date.now(),
          reference: txRef,
          status: 'SUCCESSFUL',
          simulated: true,
        };
      }

      throw new PaymentError(response.data?.message || 'Transfer failed at provider');
    } catch (error) {
      const msg = error.response?.data?.message || error.message;
      const maskedPayload = payload ? {
        ...payload,
        account_number: payload.account_number ? `******${payload.account_number.slice(-4)}` : undefined,
      } : {};
      logger.error({ error: error.response?.data || error.message, payload: maskedPayload }, '❌ Flutterwave transfer execution failed');

      if (isTestKey) {
        logger.warn({ txRef, msg }, 'Flutterwave Sandbox test transfer error (e.g. unfunded sandbox balance); simulating successful test transfer');
        return {
          success: true,
          transferId: 'flw_test_' + Date.now(),
          reference: txRef,
          status: 'SUCCESSFUL',
          simulated: true,
        };
      }

      throw new PaymentError(msg);
    }
  }

  /**
   * Verify Flutterwave Webhook Signature (verif-hash header)
   */
  verifyWebhookSignature(signatureHeader) {
    if (!this.webhookSecret) {
      if (process.env.NODE_ENV === 'production') {
        logger.error('FLW_WEBHOOK_SECRET is not configured in production mode!');
        return false;
      }
      logger.warn('⚠️ FLW_WEBHOOK_SECRET not set in env. Webhook signature check will pass in non-prod mode.');
      return true;
    }

    if (!signatureHeader || typeof signatureHeader !== 'string') {
      return false;
    }

    const sigBuf = Buffer.from(signatureHeader, 'utf8');
    const secretBuf = Buffer.from(this.webhookSecret, 'utf8');

    if (sigBuf.length !== secretBuf.length) {
      return false;
    }

    return crypto.timingSafeEqual(sigBuf, secretBuf);
  }
}

export const paymentService = new FlutterwavePaymentService();
