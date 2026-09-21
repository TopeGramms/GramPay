import { Router } from 'express';
import { recipientService } from '../services/recipient.js';
import { requireAdminAuth } from '../middleware/auth.js';
import { userContextService } from '../core/userContext.js';

const router = Router();

router.use('/api', requireAdminAuth);

/**
 * GET /api/recipients - Fetch saved recipients
 */
router.get('/api/recipients', async (req, res, next) => {
  try {
    const phone = req.query.phone || '2348000000000';
    const user = await userContextService.resolveUser(phone);
    const recipients = await recipientService.getRecipients(user.id);
    res.json({ success: true, data: recipients });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/recipients - Create recipient
 */
router.post('/api/recipients', async (req, res, next) => {
  try {
    const { name, nickname, accountNumber, bankName, bankCode, phone } = req.body;
    const user = await userContextService.resolveUser(phone || '2348000000000');
    
    const recipient = await recipientService.addRecipient(user.id, {
      name,
      nickname,
      accountNumber,
      bankName,
      bankCode,
    });
    res.status(201).json({ success: true, data: recipient });
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/recipients/:id - Delete recipient
 */
router.delete('/api/recipients/:id', async (req, res, next) => {
  try {
    const phone = req.query.phone || '2348000000000';
    const user = await userContextService.resolveUser(phone);
    await recipientService.deleteRecipient(user.id, req.params.id);
    res.json({ success: true, message: 'Recipient deleted' });
  } catch (err) {
    next(err);
  }
});

export default router;
