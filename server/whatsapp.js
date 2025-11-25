import axios from 'axios';
import { config } from './config.js';

export class WhatsAppService {
  constructor() {
    this.baseUrl = `https://graph.facebook.com/v18.0/${config.whatsapp.phoneNumberId}`;
    this.accessToken = config.whatsapp.accessToken;
  }

  async sendMessage(to, message) {
    try {
      const response = await axios.post(
        `${this.baseUrl}/messages`,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: to,
          type: 'text',
          text: {
            preview_url: false,
            body: message
          }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('WhatsApp message sent:', response.data);
      return response.data;
    } catch (error) {
      console.error('Error sending WhatsApp message:', error.response?.data || error.message);
      throw error;
    }
  }

  verifyWebhook(mode, token, challenge) {
    if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
      console.log('Webhook verified');
      return challenge;
    } else {
      console.error('Webhook verification failed');
      return null;
    }
  }

  extractMessageData(webhookBody) {
    try {
      const entry = webhookBody.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (!value?.messages?.[0]) {
        return null;
      }

      const message = value.messages[0];
      const from = message.from;
      const messageBody = message.text?.body;
      const messageId = message.id;
      const timestamp = message.timestamp;

      if (!messageBody) {
        return null;
      }

      return {
        from,
        message: messageBody,
        messageId,
        timestamp
      };
    } catch (error) {
      console.error('Error extracting message data:', error);
      return null;
    }
  }

  isAuthorized(phoneNumber) {
    const authorizedNumber = config.authorizedPhoneNumber.replace(/\D/g, '');
    const incomingNumber = phoneNumber.replace(/\D/g, '');
    return authorizedNumber === incomingNumber;
  }
}

export const whatsappService = new WhatsAppService();
