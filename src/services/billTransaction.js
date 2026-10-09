import { supabase } from '../db/supabase.js';
import { logger } from '../lib/logger.js';

const SPENDING_STATUSES = ['processing', 'pending', 'completed', 'manual_review'];

export class BillTransactionService {
  async createPurchase({
    requesterPhone,
    product,
    network,
    customerPhone,
    billerCode,
    itemCode,
    planName,
    amount,
    providerFee = 0,
    reference,
  }) {
    const payload = {
      requester_phone: String(requesterPhone).replace(/\D/g, ''),
      product,
      network,
      customer_phone: customerPhone,
      biller_code: billerCode,
      item_code: itemCode,
      plan_name: planName || null,
      amount: Number(amount),
      provider_fee: Number(providerFee) || 0,
      status: 'processing',
      idempotency_key: reference,
      provider_reference: reference,
    };

    const { data, error } = await supabase
      .from('bill_transactions')
      .insert(payload)
      .select('*')
      .single();

    if (!error && data) return { ...data, isNew: true };

    if (error?.code === '23505') {
      const { data: existing, error: lookupError } = await supabase
        .from('bill_transactions')
        .select('*')
        .eq('idempotency_key', reference)
        .eq('requester_phone', payload.requester_phone)
        .single();
      if (!lookupError && existing) return { ...existing, isDuplicate: true };
    }

    logger.error({ error: error?.message, reference }, 'Could not persist bill purchase; provider call blocked');
    throw new Error('Could not safely initialize this purchase. No provider request was made.');
  }

  async getDailySpent(requesterPhone) {
    const phone = String(requesterPhone).replace(/\D/g, '');
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const [{ data: transfers, error: transferError }, { data: bills, error: billError }] = await Promise.all([
      supabase.from('transactions')
        .select('amount')
        .eq('requester_phone', phone)
        .in('status', SPENDING_STATUSES)
        .gte('created_at', startOfDay.toISOString()),
      supabase.from('bill_transactions')
        .select('amount, provider_fee')
        .eq('requester_phone', phone)
        .in('status', SPENDING_STATUSES)
        .gte('created_at', startOfDay.toISOString()),
    ]);

    if (transferError || billError) {
      logger.error({ phone, transferError: transferError?.message, billError: billError?.message }, 'Daily spending check failed closed');
      throw new Error('Could not verify your daily spending limit. Please try again later.');
    }
    return (transfers || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0) +
      (bills || []).reduce((sum, item) => sum + (Number(item.amount) || 0) + (Number(item.provider_fee) || 0), 0);
  }

  async updateStatus(reference, status, { providerTransactionId, providerFee, providerResponse, errorReason } = {}) {
    const updates = { status, updated_at: new Date().toISOString() };
    if (providerTransactionId) updates.provider_transaction_id = String(providerTransactionId);
    if (Number.isFinite(Number(providerFee))) updates.provider_fee = Number(providerFee);
    if (providerResponse) updates.provider_response = providerResponse;
    if (errorReason) updates.error_reason = String(errorReason).slice(0, 500);

    const { data, error } = await supabase
      .from('bill_transactions')
      .update(updates)
      .eq('provider_reference', reference)
      .in('status', ['processing', 'pending', 'manual_review'])
      .select('*')
      .maybeSingle();

    if (error) {
      logger.error({ reference, error: error.message }, 'Failed to update bill transaction');
      return null;
    }
    return data;
  }

  async findByReference(reference, requesterPhone) {
    const { data, error } = await supabase
      .from('bill_transactions')
      .select('*')
      .eq('provider_reference', reference)
      .eq('requester_phone', String(requesterPhone).replace(/\D/g, ''))
      .maybeSingle();
    if (error) throw new Error('Could not retrieve bill transaction status');
    return data;
  }
}

export const billTransactionService = new BillTransactionService();