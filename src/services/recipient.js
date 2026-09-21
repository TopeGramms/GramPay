import { supabase } from '../db/supabase.js';
import { logger } from '../lib/logger.js';

export class RecipientService {
  /**
   * List all saved recipients for a user
   */
  async getRecipients(userId) {
    try {
      const { data, error } = await supabase
        .from('recipients')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (error) {
        logger.error({ userId, error: error.message }, 'Failed to fetch recipients');
        return [];
      }
      return data || [];
    } catch (err) {
      logger.error({ err: err.message }, 'Recipient Service Error');
      return [];
    }
  }

  /**
   * Find recipient by nickname or name for a specific user
   */
  async findByName(userId, name) {
    if (!name) return null;
    const recipients = await this.getRecipients(userId);
    const searchName = name.trim().toLowerCase();

    // Exact nickname/name match
    const exact = recipients.find(r => 
      (r.nickname && r.nickname.toLowerCase() === searchName) ||
      (r.name && r.name.toLowerCase() === searchName)
    );
    if (exact) return exact;

    // Partial match
    return recipients.find(r => 
      (r.nickname && r.nickname.toLowerCase().includes(searchName)) ||
      (r.name && r.name.toLowerCase().includes(searchName))
    ) || null;
  }

  /**
   * Save a new recipient for a user
   */
  async addRecipient(userId, { name, nickname, accountNumber, bankName, bankCode }) {
    try {
      const { data, error } = await supabase
        .from('recipients')
        .insert({
          user_id: userId,
          name: name || nickname,
          nickname: nickname || name,
          account_number: accountNumber,
          bank_name: bankName,
          bank_code: bankCode,
        })
        .select()
        .single();

      if (error) {
        logger.error({ userId, error: error.message }, 'Failed to insert recipient');
        throw error;
      }
      return data;
    } catch (err) {
      logger.error({ err: err.message }, 'Add Recipient Error');
      throw err;
    }
  }

  /**
   * Delete recipient by ID for a user
   */
  async deleteRecipient(userId, recipientId) {
    try {
      const { error } = await supabase
        .from('recipients')
        .delete()
        .eq('id', recipientId)
        .eq('user_id', userId);

      if (error) throw error;
      return true;
    } catch (err) {
      logger.error({ err: err.message }, 'Delete Recipient Error');
      return false;
    }
  }
}

export const recipientService = new RecipientService();
