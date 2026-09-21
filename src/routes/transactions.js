import { Router } from 'express';
import { transactionService } from '../services/transaction.js';
import { requireAdminAuth } from '../middleware/auth.js';
import { userContextService } from '../core/userContext.js';

const router = Router();

router.use('/api', requireAdminAuth);

/**
 * GET /api/transactions - Fetch transaction history
 */
router.get('/api/transactions', async (req, res, next) => {
  try {
    const phone = req.query.phone || '2348000000000';
    const limit = parseInt(req.query.limit || '20', 10);
    const user = await userContextService.resolveUser(phone);
    const transactions = await transactionService.getHistory(user.id, limit);
    res.json({ success: true, data: transactions });
  } catch (err) {
    next(err);
  }
});

export default router;
