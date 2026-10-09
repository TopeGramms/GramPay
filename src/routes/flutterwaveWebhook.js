import { Router } from 'express';
import { paymentService } from '../services/payment.js';
import { transactionService } from '../services/transaction.js';
import { dedupService } from '../services/dedup.js';
import { logger } from '../lib/logger.js';
import { supabase } from '../db/supabase.js';
import { commandHandler } from '../core/commandHandler.js';

const router = Router();

router.post('/api/flutterwave/webhook', async (req, res) => {
  const signature = req.headers['verif-hash'];

  if (!paymentService.verifyWebhookSignature(signature)) {
    logger.warn('Unauthorized Flutterwave webhook attempt');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // Acknowledge receipt immediately
  res.status(200).send('OK');

  const { event, data } = req.body || {};
  logger.info({ event, dataId: data?.id, status: data?.status }, 'Received Flutterwave webhook');

  // Replay protection: deduplicate webhook events
  const billReference = data?.tx_ref || data?.reference;
  const eventId = String(data?.id || `${event}_${data?.tx_ref || data?.reference || 'unknown'}_${data?.status || 'unknown'}`);
  const isNew = await dedupService.checkAndRecordWebhookEvent(eventId, 'flutterwave', event, billReference, req.body);
  if (!isNew) {
    logger.info({ eventId }, 'Skipping already processed Flutterwave webhook event');
    return;
  }

  if (String(event || '').toLowerCase().includes('bill') && billReference) {
    // Treat the webhook as a notification only; re-fetch the bill from Flutterwave before changing state.
    const { data: bill } = await supabase
      .from('bill_transactions')
      .select('requester_phone')
      .eq('provider_reference', billReference)
      .maybeSingle();
    if (bill?.requester_phone) {
      const updatedBill = await commandHandler.handleBillStatus(bill.requester_phone, billReference, { notify: false });
      if (updatedBill && ['completed', 'failed'].includes(updatedBill.status)) {
        await commandHandler.sendBillStatusReply(bill.requester_phone, updatedBill);
      }
    }
    return;
  }

  if (event === 'transfer.completed') {
    const flwRef = data.reference;
    const status = data.status === 'SUCCESSFUL' ? 'completed' : 'failed';
    const errorReason = data.complete_message || null;

    try {
      // Find transaction by opay_reference / reference
      const { data: tx } = await transactionService.updateStatusByRef(flwRef, status, errorReason);
      logger.info({ flwRef, status, txId: tx?.id }, 'Updated transaction via Flutterwave webhook');
    } catch (err) {
      logger.error({ flwRef, err: err.message }, 'Failed to update transaction via Flutterwave webhook');
    }
  }
});

export default router;
