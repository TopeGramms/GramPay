import Groq from 'groq-sdk';
import { config } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { CONSTANTS } from '../config/constants.js';

export class AIService {
  constructor() {
    this.apiKey = config.groq.apiKey;
    this.model = config.groq.model;
    
    if (this.apiKey) {
      this.client = new Groq({ apiKey: this.apiKey });
    } else {
      logger.warn('⚠️ GROQ_API_KEY is missing! AI Service operating in rule-based entity extractor mode.');
      this.client = null;
    }
  }

  /**
   * Sanitize text: strip trailing punctuation and clean whitespace
   */
  sanitizeText(text) {
    if (!text || typeof text !== 'string') return '';
    return text.trim().replace(/[.,!?]+$/, '').trim();
  }

  /**
   * Main command parser combining AI JSON completion with robust fallback rule extraction
   */
  async parseCommand(userMessage, recipients = []) {
    if (!userMessage || typeof userMessage !== 'string') {
      return { intent: CONSTANTS.INTENTS.UNKNOWN };
    }

    const cleaned = this.sanitizeText(userMessage);

    // Direct check for 4-digit PIN entries
    if (/^\d{4}$/.test(cleaned)) {
      return { intent: 'PROVIDE_PIN', pin: cleaned };
    }

    // Direct check for simple YES / NO confirmations
    const lower = cleaned.toLowerCase();
    if (['yes', 'yup', 'yeah', 'confirm', 'proceed', 'send it', 'ok', 'okay', '1'].includes(lower)) {
      return { intent: 'CONFIRMATION', confirmed: true };
    }
    if (['no', 'cancel', 'stop', 'abort', 'don\'t', 'dont', '2'].includes(lower)) {
      return { intent: 'CONFIRMATION', confirmed: false };
    }

    // Try Groq AI Parsing first if client is available
    if (this.client) {
      try {
        const recipientsFormatted = recipients.map(r => 
          `- ${r.nickname || r.name}: ${r.account_number} (${r.bank_name})`
        ).join('\n') || 'None saved yet';

        const systemPrompt = `You are GramPay, an intelligent AI money transfer assistant for Nigeria.
Parse the user's message into a strict JSON object with intent and parameters.

Saved Recipients for this user:
${recipientsFormatted}

Available Intents:
- SEND_MONEY: User wants to transfer money
- ADD_RECIPIENT: User wants to save a recipient contact
- CHECK_BALANCE: User asks for balance, spending, or daily limits
- LIST_RECIPIENTS: User wants to see saved contacts
- SET_PIN: User wants to set or change their 4-digit PIN
- HELP: User asks for help or greetings
- UNKNOWN: Irrelevant text

JSON Output Contract (STRICT JSON ONLY, NO MARKDOWN):
{
  "intent": "SEND_MONEY | ADD_RECIPIENT | CHECK_BALANCE | LIST_RECIPIENTS | SET_PIN | HELP | UNKNOWN",
  "amount": number or null,
  "recipientName": string or null,
  "accountNumber": string or null,
  "bankName": string or null,
  "pin": string or null
}
`;

        const completion = await this.client.chat.completions.create({
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: cleaned },
          ],
          model: this.model,
          temperature: 0.1,
          response_format: { type: 'json_object' },
        });

        const responseText = completion.choices[0]?.message?.content;
        const parsed = JSON.parse(responseText);

        // Sanitize parsed strings from Groq output
        if (parsed.recipientName) parsed.recipientName = this.sanitizeText(parsed.recipientName);
        if (parsed.accountNumber) parsed.accountNumber = parsed.accountNumber.replace(/\D/g, '');
        if (parsed.bankName) parsed.bankName = this.sanitizeText(parsed.bankName);

        // Post-process regex extraction to complement AI output
        return this.enhanceParsedResult(cleaned, parsed, recipients);
      } catch (error) {
        logger.error({ error: error.message }, 'Groq AI Parsing Error. Falling back to rule-based parser.');
      }
    }

    return this.fallbackSmartParser(cleaned, recipients);
  }

  /**
   * Post-process AI result with regex sanity checks
   */
  enhanceParsedResult(text, parsed, recipients) {
    // 1. Amount extraction fallback (5k -> 5000, 2.5k -> 2500)
    if (!parsed.amount || isNaN(parsed.amount)) {
      const amountMatch = text.match(/(?:NGN|₦|\$)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|naira)?/i);
      if (amountMatch) {
        let val = parseFloat(amountMatch[1]);
        if (amountMatch[2] && amountMatch[2].toLowerCase() === 'k') val *= 1000;
        if (val > 0) parsed.amount = val;
      }
    }

    // 2. Account Number extraction (extract 10-digit number anywhere in text)
    const accMatch = text.match(/\b(\d{10})\b/);
    if (accMatch) {
      parsed.accountNumber = accMatch[1];
    }

    // 3. Clean up recipientName if it contains account number or bank name accidentally
    if (parsed.recipientName && parsed.accountNumber) {
      parsed.recipientName = parsed.recipientName.replace(parsed.accountNumber, '').trim();
    }
    if (parsed.recipientName && parsed.bankName) {
      const bankRegex = new RegExp(parsed.bankName, 'gi');
      parsed.recipientName = parsed.recipientName.replace(bankRegex, '').trim();
    }
    if (parsed.recipientName) {
      parsed.recipientName = parsed.recipientName.replace(/\b(to|send|transfer|my|other|account)\b/gi, '').trim();
      parsed.recipientName = this.sanitizeText(parsed.recipientName);
    }

    return parsed;
  }

  /**
   * Smart Rule-Based Entity Extractor
   */
  fallbackSmartParser(text, recipients) {
    const cleaned = this.sanitizeText(text);
    const lower = cleaned.toLowerCase();

    // 1. Check for Check Balance / Limits
    if (lower.includes('balance') || lower.includes('limit') || lower.includes('spent')) {
      return { intent: CONSTANTS.INTENTS.CHECK_BALANCE };
    }

    // 2. Check for List Recipients
    if (lower.includes('recipients') || lower.includes('contacts') || lower.includes('list')) {
      return { intent: CONSTANTS.INTENTS.LIST_RECIPIENTS };
    }

    // 3. Check for Set PIN
    if (lower.includes('pin') || lower.includes('password')) {
      return { intent: CONSTANTS.INTENTS.SET_PIN };
    }

    // 4. Check for Help / Hello
    if (['help', 'start', 'hi', 'hello', 'hey'].some(k => lower.includes(k))) {
      return { intent: CONSTANTS.INTENTS.HELP };
    }

    // 5. Amount Extraction
    let amount = null;
    const amountMatch = cleaned.match(/(?:send|transfer|pay|for)?\s*(?:NGN|₦)?\s*(\d+(?:\.\d+)?)\s*(k|thousand|naira)?\b/i);
    if (amountMatch) {
      amount = parseFloat(amountMatch[1]);
      if (amountMatch[2] && amountMatch[2].toLowerCase() === 'k') amount *= 1000;
    }

    // 6. Account Number Extraction (10 digits)
    let accountNumber = null;
    const accMatch = cleaned.match(/\b(\d{10})\b/);
    if (accMatch) {
      accountNumber = accMatch[1];
    }

    // 7. Bank Name Extraction
    const knownBanks = ['opay', 'kuda', 'moniepoint', 'palmpay', 'gtb', 'gtbank', 'guaranty trust', 'zenith', 'access', 'first bank', 'firstbank', 'uba', 'fcmb', 'stanbic', 'sterling', 'wema', 'polaris', 'union'];
    let bankName = null;
    for (const bank of knownBanks) {
      if (lower.includes(bank)) {
        bankName = bank;
        break;
      }
    }

    // 8. Recipient Contact Matching
    let recipientName = null;
    if (!accountNumber && recipients.length > 0) {
      for (const r of recipients) {
        const nameToSearch = (r.nickname || r.name).toLowerCase();
        if (lower.includes(nameToSearch)) {
          recipientName = r.nickname || r.name;
          accountNumber = r.account_number;
          bankName = r.bank_name;
          break;
        }
      }
    }

    // 9. If amount or intent keywords present -> SEND_MONEY intent
    if (amount || accountNumber || bankName || recipientName || lower.includes('send') || lower.includes('transfer')) {
      return {
        intent: CONSTANTS.INTENTS.SEND_MONEY,
        amount,
        accountNumber,
        bankName,
        recipientName,
      };
    }

    return { intent: CONSTANTS.INTENTS.UNKNOWN };
  }

  /**
   * Conversational natural language response generator
   */
  async generateResponse(userMessage, context = '') {
    if (!this.client) {
      return 'I am GramPay, your smart WhatsApp money assistant. Say "send 5000 to Mom" or reply "help" to get started!';
    }

    try {
      const completion = await this.client.chat.completions.create({
        messages: [
          { 
            role: 'system', 
            content: 'You are GramPay, a polite, quick, Nigerian financial AI assistant on WhatsApp. Keep responses short (max 2 sentences), warm, and helpful.' 
          },
          { role: 'system', content: `Context: ${context}` },
          { role: 'user', content: userMessage }
        ],
        model: this.model,
        temperature: 0.7,
        max_tokens: 120,
      });

      return completion.choices[0]?.message?.content || 'How can I assist you with your transfers today?';
    } catch (error) {
      return 'GramPay is ready! Send "send 5000 to Mom" or "help" to see what I can do.';
    }
  }
}

export const aiService = new AIService();
