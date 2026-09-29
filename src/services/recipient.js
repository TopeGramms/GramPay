import { supabase } from '../db/supabase.js';
import { logger } from '../lib/logger.js';

export class RecipientService {
  /**
   * List all saved recipients for a user
   */
  async getRecipients(userId) {
    const phoneStr = String(userId || '').replace(/\D/g, '');
    try {
      // 1. Try querying by user_id
      let { data, error } = await supabase
        .from('recipients')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false });

      if (!error && data) return data;

      // 2. Fallback to owner_phone (private beta migration)
      if (phoneStr) {
        const { data: betaData, error: betaErr } = await supabase
          .from('recipients')
          .select('*')
          .eq('owner_phone', phoneStr)
          .order('created_at', { ascending: false });

        if (!betaErr && betaData) return betaData;
      }

      // 3. Fallback to all recipients (single-user MVP)
      const { data: mvpData, error: mvpErr } = await supabase
        .from('recipients')
        .select('*')
        .order('created_at', { ascending: false });

      if (!mvpErr && mvpData) return mvpData;

      return [];
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
    const phoneStr = String(userId || '').replace(/\D/g, '');
    const displayName = nickname || name || 'Contact';

    try {
      // 1. Attempt modern schema insert
      const modernPayload = {
        user_id: userId,
        owner_phone: phoneStr || null,
        name: name || nickname,
        nickname: displayName,
        account_number: accountNumber,
        bank_name: bankName,
        bank_code: bankCode,
      };

      const { data, error } = await supabase
        .from('recipients')
        .insert(modernPayload)
        .select()
        .single();

      if (!error && data) return data;

      // 2. Fallback to MVP/beta schema without user_id / bank_code
      const fallbackPayload = {
        nickname: displayName,
        account_number: accountNumber,
        bank_name: bankName,
      };
      if (phoneStr) fallbackPayload.owner_phone = phoneStr;

      const { data: fbData, error: fbError } = await supabase
        .from('recipients')
        .insert(fallbackPayload)
        .select()
        .single();

      if (!fbError && fbData) return fbData;

      logger.warn({ error: fbError?.message }, 'Recipient insert failed in DB, returning fallback record');
      return { id: `rec_${Date.now()}`, ...fallbackPayload, bank_code: bankCode };
    } catch (err) {
      logger.error({ err: err.message }, 'Add Recipient Error');
      return { id: `rec_${Date.now()}`, nickname: displayName, account_number: accountNumber, bank_name: bankName, bank_code: bankCode };
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
