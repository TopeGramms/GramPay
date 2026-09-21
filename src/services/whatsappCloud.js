import axios from 'axios';
import { config } from '../config/env.js';
import { CONSTANTS } from '../config/constants.js';
import { logger } from '../lib/logger.js';

export class WhatsAppCloudService {
  constructor() {
    this.token = config.meta.whatsappToken;
    this.phoneNumberId = config.meta.phoneNumberId;
    this.baseUrl = `${CONSTANTS.META_BASE_URL}/${CONSTANTS.META_API_VERSION}`;
  }

  get headers() {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Send text message to a WhatsApp user
   * @param {string} to Phone number with country code (e.g., 2348012345678)
   * @param {string} text Message body text
   */
  async sendMessage(to, text) {
    if (!this.token || !this.phoneNumberId) {
      logger.warn({ to, text }, '⚠️ Meta WhatsApp Cloud API credentials missing! Skipping actual API call.');
      return { success: false, simulated: true };
    }

    // Clean phone number (remove + or non-digits)
    const cleanedTo = to.replace(/\D/g, '');

    const url = `${this.baseUrl}/${this.phoneNumberId}/messages`;
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanedTo,
      type: 'text',
      text: { body: text },
    };

    try {
      const response = await axios.post(url, payload, { headers: this.headers });
      logger.info({ to: cleanedTo, messageId: response.data?.messages?.[0]?.id }, '✅ WhatsApp Cloud API message sent');
      return { success: true, data: response.data };
    } catch (error) {
      logger.error({ error: error.response?.data || error.message, to: cleanedTo }, '❌ Failed to send WhatsApp message via Cloud API');
      throw error;
    }
  }

  /**
   * Send interactive quick reply buttons
   * @param {string} to Phone number
   * @param {string} bodyText Main message body text
   * @param {Array<{id: string, title: string}>} buttons List of up to 3 buttons
   */
  async sendInteractiveButtons(to, bodyText, buttons) {
    if (!this.token || !this.phoneNumberId) {
      logger.warn({ to, bodyText, buttons }, '⚠️ Meta Cloud API credentials missing. Falling back to plain text buttons.');
      const fallbackText = `${bodyText}\n\nOptions:\n` + buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
      return this.sendMessage(to, fallbackText);
    }

    const cleanedTo = to.replace(/\D/g, '');
    const url = `${this.baseUrl}/${this.phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: cleanedTo,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.slice(0, 3).map(btn => ({
            type: 'reply',
            reply: {
              id: btn.id,
              title: btn.title,
            }
          }))
        }
      }
    };

    try {
      const response = await axios.post(url, payload, { headers: this.headers });
      logger.info({ to: cleanedTo }, '✅ WhatsApp Cloud API interactive message sent');
      return { success: true, data: response.data };
    } catch (error) {
      logger.error({ error: error.response?.data || error.message }, '❌ Failed to send interactive buttons via Cloud API');
      // Fallback to text
      const fallbackText = `${bodyText}\n\nOptions:\n` + buttons.map((b, i) => `${i + 1}. ${b.title}`).join('\n');
      return this.sendMessage(to, fallbackText);
    }
  }

  /**
   * Mark incoming message as read
   * @param {string} messageId 
   */
  async markAsRead(messageId) {
    if (!this.token || !this.phoneNumberId || !messageId) return;

    const url = `${this.baseUrl}/${this.phoneNumberId}/messages`;
    try {
      await axios.post(url, {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: messageId,
      }, { headers: this.headers });
    } catch (error) {
      logger.debug({ messageId, error: error.message }, 'Could not mark message as read');
    }
  }
}

export const whatsappService = new WhatsAppCloudService();
