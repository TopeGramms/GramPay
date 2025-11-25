import { supabase } from './supabase.js';

export class RecipientService {
  async getRecipientByNickname(nickname) {
    try {
      const { data, error } = await supabase
        .from('recipients')
        .select('*')
        .ilike('nickname', nickname)
        .maybeSingle();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('Error getting recipient:', error);
      throw error;
    }
  }

  async addRecipient(nickname, accountNumber, bankName = 'Unknown Bank') {
    try {
      const existing = await this.getRecipientByNickname(nickname);
      if (existing) {
        return {
          success: false,
          message: `Recipient "${nickname}" already exists with account ${existing.account_number}`
        };
      }

      const { data, error } = await supabase
        .from('recipients')
        .insert({
          nickname: nickname.trim(),
          account_number: accountNumber.trim(),
          bank_name: bankName.trim()
        })
        .select()
        .single();

      if (error) throw error;

      return {
        success: true,
        message: `✅ Added ${nickname}: ${accountNumber} (${bankName})`,
        data
      };
    } catch (error) {
      console.error('Error adding recipient:', error);
      return {
        success: false,
        message: `Failed to add recipient: ${error.message}`
      };
    }
  }

  async listRecipients() {
    try {
      const { data, error } = await supabase
        .from('recipients')
        .select('*')
        .order('nickname', { ascending: true });

      if (error) throw error;

      if (!data || data.length === 0) {
        return {
          success: true,
          message: 'No recipients saved yet. Add one by saying "add contact [name] [account number]"',
          data: []
        };
      }

      const recipientList = data
        .map((r, i) => `${i + 1}. ${r.nickname}: ${r.account_number} (${r.bank_name})`)
        .join('\n');

      return {
        success: true,
        message: `📋 Your Recipients:\n\n${recipientList}`,
        data
      };
    } catch (error) {
      console.error('Error listing recipients:', error);
      return {
        success: false,
        message: 'Failed to retrieve recipients'
      };
    }
  }

  async deleteRecipient(nickname) {
    try {
      const existing = await this.getRecipientByNickname(nickname);
      if (!existing) {
        return {
          success: false,
          message: `Recipient "${nickname}" not found`
        };
      }

      const { error } = await supabase
        .from('recipients')
        .delete()
        .eq('id', existing.id);

      if (error) throw error;

      return {
        success: true,
        message: `✅ Deleted recipient: ${nickname}`
      };
    } catch (error) {
      console.error('Error deleting recipient:', error);
      return {
        success: false,
        message: `Failed to delete recipient: ${error.message}`
      };
    }
  }

  async updateRecipient(nickname, accountNumber, bankName) {
    try {
      const existing = await this.getRecipientByNickname(nickname);
      if (!existing) {
        return {
          success: false,
          message: `Recipient "${nickname}" not found`
        };
      }

      const updates = {
        updated_at: new Date().toISOString()
      };

      if (accountNumber) updates.account_number = accountNumber.trim();
      if (bankName) updates.bank_name = bankName.trim();

      const { data, error } = await supabase
        .from('recipients')
        .update(updates)
        .eq('id', existing.id)
        .select()
        .single();

      if (error) throw error;

      return {
        success: true,
        message: `✅ Updated ${nickname}`,
        data
      };
    } catch (error) {
      console.error('Error updating recipient:', error);
      return {
        success: false,
        message: `Failed to update recipient: ${error.message}`
      };
    }
  }
}

export const recipientService = new RecipientService();
