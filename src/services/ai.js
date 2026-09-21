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
      logger.warn('⚠️ GROQ_API_KEY is missing! AI Service will operate in fallback rule-based mode.');
      this.client = null;
    }
  }

  /**
   * Parse natural language message into structured payment action
   * @param {string} userMessage 
   * @param {Array} recipients User's saved recipients list
   */
  async parseCommand(userMessage, recipients = []) {
    if (!userMessage || typeof userMessage !== 'string') {
      return { intent: CONSTANTS.INTENTS.UNKNOWN };
    }

    const trimmed = userMessage.trim();

    // Direct check for 4-digit PIN entries
    if (/^\d{4}$/.test(trimmed)) {
      return {
        intent: 'PROVIDE_PIN',
        pin: trimmed,
      };
    }

    // Direct check for confirmation answers
    const lower = trimmed.toLowerCase();
    if (['yes', 'yup', 'yeah', 'confirm', 'proceed', 'send it', 'ok', 'okay', '1'].includes(lower)) {
      return {
        intent: 'CONFIRMATION',
        confirmed: true,
      };
    }
    if (['no', 'cancel', 'stop', 'abort', 'don\'t', 'dont', '2'].includes(lower)) {
      return {
        intent: 'CONFIRMATION',
        confirmed: false,
      };
    }

    if (!this.client) {
      return this.fallbackRegexParser(trimmed, recipients);
    }

    const recipientsFormatted = recipients.map(r => 
      `- ${r.nickname || r.name}: ${r.account_number} (${r.bank_name})`
    ).join('\n') || 'None saved yet';

    const systemPrompt = `You are GramPay, an intelligent AI money transfer assistant for Nigeria.
Parse the user's message into a strict JSON object with intent and parameters.

Saved Recipients for this user:
${recipientsFormatted}

Available Intents:
- SEND_MONEY: User wants to transfer money (e.g. "Send 5k to Mom", "Transfer 10000 to 0123456789 Opay")
- ADD_RECIPIENT: User wants to save a recipient (e.g. "Save Mom 0123456789 Kuda")
- CHECK_BALANCE: User asks for balance or spent amount
- LIST_RECIPIENTS: User wants to see saved contacts
- SET_PIN: User wants to set or change their 4-digit PIN
- HELP: User asks how to use GramPay
- UNKNOWN: Irrelevant text

JSON Output Format (STRICTLY RETURN JSON ONLY, NO MARKDOWN, NO EXPLANATIONS):
{
  "intent": "SEND_MONEY | ADD_RECIPIENT | CHECK_BALANCE | LIST_RECIPIENTS | SET_PIN | HELP | UNKNOWN",
  "amount": number or null,
  "recipientName": string or null,
  "accountNumber": string or null,
  "bankName": string or null,
  "pin": string or null
}

Examples:
Input: "send 5k to Mom"
Output: {"intent": "SEND_MONEY", "amount": 5000, "recipientName": "Mom", "accountNumber": null, "bankName": null, "pin": null}

Input: "transfer 2500 naira to 0901234567 Opay"
Output: {"intent": "SEND_MONEY", "amount": 2500, "recipientName": null, "accountNumber": "0901234567", "bankName": "Opay", "pin": null}

Input: "save Bro 0581234567 GTBank"
Output: {"intent": "ADD_RECIPIENT", "amount": null, "recipientName": "Bro", "accountNumber": "0581234567", "bankName": "GTBank", "pin": null}
`;

    try {
      const completion = await this.client.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: trimmed },
        ],
        model: this.model,
        temperature: 0.1,
        response_format: { type: 'json_object' },
      });

      const responseText = completion.choices[0]?.message?.content;
      const parsed = JSON.parse(responseText);

      // Handle '5k' or '10k' conversion if Groq didn't parse amount properly
      if (parsed.amount === null && /\d+\s*k\b/i.test(trimmed)) {
        const kMatch = trimmed.match(/(\d+(?:\.\d+)?)\s*k\b/i);
        if (kMatch) {
          parsed.amount = parseFloat(kMatch[1]) * 1000;
        }
      }

      return parsed;
    } catch (error) {
      logger.error({ error: error.message }, 'AI Command Parsing Error. Falling back to regex parser.');
      return this.fallbackRegexParser(trimmed, recipients);
    }
  }

  /**
   * Simple Regex parser fallback if Groq API fails or is unconfigured
   */
  fallbackRegexParser(text, recipients) {
    const lower = text.toLowerCase();

    // Check for send money
    const sendMatch = text.match(/(?:send|transfer|pay)\s+(?:NGN\s*|₦\s*)?(\d+(?:\.\d+)?|\d+k)\s+(?:to\s+)?(.+)/i);
    if (sendMatch) {
      let amountStr = sendMatch[1].toLowerCase();
      let amount = 0;
      if (amountStr.endsWith('k')) {
        amount = parseFloat(amountStr.replace('k', '')) * 1000;
      } else {
        amount = parseFloat(amountStr);
      }

      const target = sendMatch[2].trim();
      // Check if target is a 10 digit account number
      const accMatch = target.match(/^(\d{10})\s*(.*)$/);
      if (accMatch) {
        return {
          intent: CONSTANTS.INTENTS.SEND_MONEY,
          amount,
          accountNumber: accMatch[1],
          bankName: accMatch[2] || null,
          recipientName: null,
        };
      }

      return {
        intent: CONSTANTS.INTENTS.SEND_MONEY,
        amount,
        recipientName: target,
        accountNumber: null,
        bankName: null,
      };
    }

    if (lower.includes('balance') || lower.includes('limit') || lower.includes('spent')) {
      return { intent: CONSTANTS.INTENTS.CHECK_BALANCE };
    }

    if (lower.includes('recipients') || lower.includes('contacts') || lower.includes('list')) {
      return { intent: CONSTANTS.INTENTS.LIST_RECIPIENTS };
    }

    if (lower.includes('pin') || lower.includes('password')) {
      return { intent: CONSTANTS.INTENTS.SET_PIN };
    }

    if (lower.includes('help') || lower.includes('start') || lower.includes('hi') || lower.includes('hello')) {
      return { intent: CONSTANTS.INTENTS.HELP };
    }

    return { intent: CONSTANTS.INTENTS.UNKNOWN };
  }

  /**
   * Generate conversational natural language responses
   */
  async generateResponse(userMessage, context = '') {
    if (!this.client) {
      return 'I am GramPay, your WhatsApp money assistant. Reply "help" to see what I can do!';
    }

    try {
      const completion = await this.client.chat.completions.create({
        messages: [
          { 
            role: 'system', 
            content: 'You are GramPay, a polite, quick, Nigerian financial AI assistant on WhatsApp. Keep your responses short (max 2-3 sentences), warm, and clear.' 
          },
          { role: 'system', content: `Context: ${context}` },
          { role: 'user', content: userMessage }
        ],
        model: this.model,
        temperature: 0.7,
        max_tokens: 150,
      });

      return completion.choices[0]?.message?.content || 'How can I assist you with your transfers today?';
    } catch (error) {
      return 'GramPay is ready. Send "send 5000 to Mom" or "help" to get started.';
    }
  }
}

export const aiService = new AIService();
