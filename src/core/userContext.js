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
        display_name: null,
        onboarding_step: CONSTANTS.ONBOARDING_STEPS.AWAITING_NAME,
        daily_limit: legacyConfig?.daily_limit || CONSTANTS.DEFAULT_DAILY_LIMIT,
        pin_hash: null, // New users must set their own PIN during onboarding
        status: 'active',
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
          display_name: null,
          onboarding_step: CONSTANTS.ONBOARDING_STEPS.AWAITING_NAME,
          daily_limit: CONSTANTS.DEFAULT_DAILY_LIMIT,
          pin_hash: null,
          is_active: true,
        };
      }

      logger.info({ userId: newUser.id || newUser.phone_number, cleanPhone }, 'Auto-provisioned new user account');
      return newUser;
    } catch (err) {
      logger.error({ phoneNumber, err: err.message }, 'User Context Resolution Error');
      return {
        id: cleanPhone,
        phone_number: cleanPhone,
        display_name: null,
        onboarding_step: CONSTANTS.ONBOARDING_STEPS.AWAITING_NAME,
        daily_limit: CONSTANTS.DEFAULT_DAILY_LIMIT,
        pin_hash: null,
        is_active: true,
      };
    }
  }

  /**
   * Update user PIN hash in database
   */
  async updateUserPin(userIdOrPhone, pinHash) {
    const cleanPhone = String(userIdOrPhone || '').replace(/\D/g, '');
    try {
      // Update beta_users by phone_number
      if (cleanPhone) {
        await supabase
          .from('beta_users')
          .update({ pin_hash: pinHash })
          .eq('phone_number', cleanPhone);
      }

      // Also try by id if it's a uuid
      if (userIdOrPhone && userIdOrPhone !== cleanPhone) {
        await supabase
          .from('beta_users')
          .update({ pin_hash: pinHash })
          .eq('id', userIdOrPhone);
      }

      // Also sync bot_config for single-user backward compatibility if needed
      await supabase
        .from('bot_config')
        .update({ pin: pinHash })
        .gt('id', 0);

      return true;
    } catch (err) {
      logger.error({ userIdOrPhone, err: err.message }, 'Failed to update user PIN');
      return false;
    }
  }

  /**
   * Update user onboarding step
   */
  async updateOnboardingStep(phoneNumber, step) {
    const cleanPhone = String(phoneNumber || '').replace(/\D/g, '');
    if (!cleanPhone) return false;

    try {
      const { error } = await supabase
        .from('beta_users')
        .update({ onboarding_step: step, updated_at: new Date().toISOString() })
        .eq('phone_number', cleanPhone);

      if (error) {
        logger.warn({ error: error.message, cleanPhone, step }, 'Failed to update onboarding step in DB');
      }
      return true;
    } catch (err) {
      logger.error({ cleanPhone, err: err.message }, 'Error updating onboarding step');
      return false;
    }
  }

  /**
   * Update user display name
   */
  async updateDisplayName(phoneNumber, displayName) {
    const cleanPhone = String(phoneNumber || '').replace(/\D/g, '');
    if (!cleanPhone || !displayName) return false;

    try {
      const { error } = await supabase
        .from('beta_users')
        .update({ display_name: displayName, updated_at: new Date().toISOString() })
        .eq('phone_number', cleanPhone);

      if (error) {
        logger.warn({ error: error.message, cleanPhone, displayName }, 'Failed to update display name in DB');
      }
      return true;
    } catch (err) {
      logger.error({ cleanPhone, err: err.message }, 'Error updating display name');
      return false;
    }
  }
  /**
   * Reset user onboarding state (allows restarting the welcome & pin setup)
   */
  async resetUserOnboarding(phoneNumber) {
    const cleanPhone = String(phoneNumber || '').replace(/\D/g, '');
    if (!cleanPhone) return false;

    try {
      await supabase
        .from('beta_users')
        .update({
          display_name: null,
          pin_hash: null,
          onboarding_step: CONSTANTS.ONBOARDING_STEPS.AWAITING_NAME,
          updated_at: new Date().toISOString()
        })
        .eq('phone_number', cleanPhone);
      return true;
    } catch (err) {
      logger.error({ cleanPhone, err: err.message }, 'Error resetting user onboarding');
      return false;
    }
  }
}

export const userContextService = new UserContextService();
