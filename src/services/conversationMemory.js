import { supabase } from '../db/supabase.js';
import { logger } from '../lib/logger.js';

export class ConversationMemoryService {
  /**
   * Save a single interaction to persistent memory
   * @param {Object} param0
   * @param {string} param0.phone Clean phone number
   * @param {'user' | 'assistant' | 'system'} param0.role
   * @param {string} param0.content
   * @param {Object} [param0.metadata]
   */
  async recordMessage({ phone, role, content, metadata = {} }) {
    if (!phone || !content) return;
    const cleanPhone = String(phone).replace(/\D/g, '');

    try {
      const { error } = await supabase
        .from('conversation_history')
        .insert({
          user_phone: cleanPhone,
          role,
          content: content.slice(0, 2000), // Protect token bounds
          metadata,
        });

      if (error) {
        logger.debug({ error: error.message, phone: cleanPhone }, 'Could not persist conversation history to DB (optional feature)');
      }
    } catch (err) {
      logger.debug({ error: err.message, phone: cleanPhone }, 'Conversation history persistence skipped');
    }
  }

  /**
   * Retrieve recent conversation exchanges for contextual AI prompt
   * @param {string} phone
   * @param {number} [limit=6]
   * @returns {Promise<Array<{ role: string, content: string }>>}
   */
  async getRecentHistory(phone, limit = 6) {
    if (!phone) return [];
    const cleanPhone = String(phone).replace(/\D/g, '');

    try {
      const { data, error } = await supabase
        .from('conversation_history')
        .select('role, content, created_at')
        .eq('user_phone', cleanPhone)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error || !data) {
        return [];
      }

      // Return in chronological order (oldest -> newest)
      return data.reverse().map(msg => ({
        role: msg.role === 'assistant' ? 'assistant' : 'user',
        content: msg.content,
      }));
    } catch (err) {
      logger.debug({ error: err.message, phone: cleanPhone }, 'Failed to fetch conversation history');
      return [];
    }
  }

  /**
   * Clear or reset memory for a user
   */
  async clearHistory(phone) {
    if (!phone) return;
    const cleanPhone = String(phone).replace(/\D/g, '');
    try {
      await supabase
        .from('conversation_history')
        .delete()
        .eq('user_phone', cleanPhone);
    } catch (err) {
      logger.debug({ error: err.message }, 'Failed to clear conversation history');
    }
  }
}

export const conversationMemory = new ConversationMemoryService();
