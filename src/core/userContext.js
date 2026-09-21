import { supabase } from '../db/supabase.js';
import { logger } from '../lib/logger.js';
import { CONSTANTS } from '../config/constants.js';

export class UserContextService {
  /**
   * Resolve or auto-provision user profile by WhatsApp phone number
   * @param {string} phoneNumber WhatsApp phone number (e.g., 2348012345678)
   */
  async resolveUser(phoneNumber) {
    if (!phoneNumber) return null;
    const cleanPhone = phoneNumber.replace(/\D/g, '');

    try {
      // 1. Query existing user by phone_number
      const { data: user, error } = await supabase
        .from('beta_users')
        .select('*')
        .eq('phone_number', cleanPhone)
        .single();

      if (user && !error) {
        return user;
      }

      // 2. Fallback: check if legacy single bot_config exists
      const { data: legacyConfig } = await supabase
        .from('bot_config')
        .select('*')
        .limit(1)
        .single();

      // 3. Auto-provision user record for multi-tenancy (single-user first mode)
      const newUserPayload = {
        phone_number: cleanPhone,
        name: `User ${cleanPhone.slice(-4)}`,
        daily_limit: legacyConfig?.daily_limit || CONSTANTS.DEFAULT_DAILY_LIMIT,
        pin_hash: legacyConfig?.pin || null, // Will be migrated/hashed
        is_active: true,
      };

      const { data: newUser, error: insertError } = await supabase
        .from('beta_users')
        .insert(newUserPayload)
        .select()
        .single();

      if (insertError) {
        // If table schema differs or insert fails, return transient user object
        logger.warn({ cleanPhone, error: insertError.message }, 'Could not insert new user into beta_users. Using fallback user context.');
        return {
          id: cleanPhone,
          phone_number: cleanPhone,
          daily_limit: CONSTANTS.DEFAULT_DAILY_LIMIT,
          pin_hash: null,
          is_active: true,
        };
      }

      logger.info({ userId: newUser.id, cleanPhone }, 'Auto-provisioned new user account');
      return newUser;
    } catch (err) {
      logger.error({ phoneNumber, err: err.message }, 'User Context Resolution Error');
      return {
        id: cleanPhone,
        phone_number: cleanPhone,
        daily_limit: CONSTANTS.DEFAULT_DAILY_LIMIT,
        pin_hash: null,
        is_active: true,
      };
    }
  }

  /**
   * Update user PIN hash in database
   */
  async updateUserPin(userId, pinHash) {
    try {
      // Update beta_users
      await supabase
        .from('beta_users')
        .update({ pin_hash: pinHash })
        .eq('id', userId);

      // Also sync bot_config for single-user backward compatibility if needed
      await supabase
        .from('bot_config')
        .update({ pin: pinHash })
        .gt('id', 0);

      return true;
    } catch (err) {
      logger.error({ userId, err: err.message }, 'Failed to update user PIN');
      return false;
    }
  }
}

export const userContextService = new UserContextService();
