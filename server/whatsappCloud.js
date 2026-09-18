import axios from 'axios';
import { config } from './config.js';

export class WhatsAppCloudService {
  constructor() { this.handler = null; }
  initialize() { return true; }
  onMessage(handler) { this.handler = handler; }
  isConnected() { return Boolean(config.whatsapp.phoneNumberId && config.whatsapp.accessToken); }
  isAuthorized(phone) { return config.authorizedPhoneNumbers.includes(String(phone).replace(/\D/g, '')); }
  async sendMessage(to, body) {
    if (!this.isConnected()) throw new Error('WhatsApp Cloud API is not configured');
    await axios.post(`https://graph.facebook.com/${config.whatsapp.graphApiVersion}/${config.whatsapp.phoneNumberId}/messages`, {
      messaging_product: 'whatsapp', to, type: 'text', text: { body }
    }, { headers: { Authorization: `Bearer ${config.whatsapp.accessToken}`, 'Content-Type': 'application/json' } });
  }
  async receive(payload) {
    for (const entry of payload.entry || []) for (const change of entry.changes || []) {
      const message = change.value?.messages?.[0];
      if (message?.type === 'text' && this.handler) await this.handler(message.from, message.text.body, message.id);
    }
  }
}
export const whatsappService = new WhatsAppCloudService();
