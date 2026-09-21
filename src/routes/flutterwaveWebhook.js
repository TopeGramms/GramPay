import { Router } from 'express';
import { paymentService } from '../services/payment.js';
import { transactionService } from '../services/transaction.js';
import { logger } from '../lib/logger.js';

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
