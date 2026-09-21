import { supabase } from '../db/supabase.js';
import { logger } from '../lib/logger.js';

export class TransactionService {
  /**
   * Log initial pending transaction
   */
  async logTransaction({ userId, recipientId, recipientName, accountNumber, bankName, amount, idempotencyKey }) {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .insert({
          user_id: userId,
          recipient_id: recipientId || null,
          recipient_name: recipientName,
          account_number: accountNumber,
          bank_name: bankName,
          amount: Number(amount),
          status: 'pending',
          idempotency_key: idempotencyKey || `tx_${Date.now()}_${Math.random().toString(36).substring(7)}`,
        })
        .select()
        .single();

      if (error) {
        logger.error({ userId, error: error.message }, 'Failed to insert transaction log');
        throw error;
      }

      return data;
    } catch (err) {
      logger.error({ err: err.message }, 'Transaction Log Error');
      throw err;
    }
  }

  /**
   * Update transaction status & Flutterwave reference (replaces double-logging bug!)
   */
  async updateStatus(transactionId, status, { flwRef, transferId, errorReason } = {}) {
    try {
      const updateData = {
        status: status,
        opay_reference: flwRef || transferId || null,
        updated_at: new Date().toISOString(),
      };

      if (errorReason) {
        updateData.error_reason = errorReason;
      }

      const { data, error } = await supabase
        .from('transactions')
        .update(updateData)
        .eq('id', transactionId)
        .select()
        .single();

      if (error) {
        logger.error({ transactionId, error: error.message }, 'Failed to update transaction status');
        throw error;
      }

  /**
   * Update transaction status by Flutterwave reference
   */
  async updateStatusByRef(reference, status, errorReason = null) {
    try {
      const updateData = {
        status,
        updated_at: new Date().toISOString(),
      };
      if (errorReason) updateData.error_reason = errorReason;

      const { data, error } = await supabase
        .from('transactions')
        .update(updateData)
        .or(`opay_reference.eq.${reference},idempotency_key.eq.${reference}`)
        .select()
        .single();

      if (error) throw error;
      return { data };
    } catch (err) {
      logger.error({ reference, err: err.message }, 'Failed to update transaction status by reference');
      return { data: null };
    }
  }

  /**
   * Calculate total spent today by user
   */
  async getUserDailySpent(userId) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const { data, error } = await supabase
        .from('transactions')
        .select('amount')
        .eq('user_id', userId)
        .in('status', ['pending', 'completed', 'successful'])
        .gte('created_at', today.toISOString());

      if (error) {
        logger.error({ userId, error: error.message }, 'Failed to fetch daily spent');
        return 0;
      }

      return (data || []).reduce((sum, tx) => sum + (Number(tx.amount) || 0), 0);
    } catch (err) {
      logger.error({ err: err.message }, 'Get Daily Spent Error');
      return 0;
    }
  }

  /**
   * Get user transaction history
   */
  async getHistory(userId, limit = 10) {
    try {
      const { data, error } = await supabase
        .from('transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (err) {
      logger.error({ err: err.message }, 'Get History Error');
      return [];
    }
  }
}

export const transactionService = new TransactionService();
