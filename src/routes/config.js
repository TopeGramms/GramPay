import { Router } from 'express';
import { requireAdminAuth } from '../middleware/auth.js';
import { userContextService } from '../core/userContext.js';
import { PinService } from '../services/pin.js';
import { supabase } from '../db/supabase.js';

const router = Router();

router.use('/api', requireAdminAuth);

/**
 * GET /api/config - Get user configuration
 */
router.get('/api/config', async (req, res, next) => {
  try {
    const phone = req.query.phone || '2348000000000';
    const user = await userContextService.resolveUser(phone);
    res.json({
      success: true,
      data: {
        id: user.id,
        phone_number: user.phone_number,
        daily_limit: user.daily_limit,
        has_pin: Boolean(user.pin_hash),
        is_active: user.is_active,
      }
    });
  } catch (err) {
    next(err);
  }
});

/**
 * PUT /api/config - Update daily limit or PIN
 */
router.put('/api/config', async (req, res, next) => {
  try {
    const { phone, dailyLimit, pin } = req.body;
    const user = await userContextService.resolveUser(phone || '2348000000000');

    const updates = {};

    if (dailyLimit !== undefined && !isNaN(Number(dailyLimit))) {
      updates.daily_limit = Number(dailyLimit);
    }

    if (pin) {
      updates.pin_hash = await PinService.hashPin(pin);
    }

    if (Object.keys(updates).length > 0) {
      await supabase
        .from('beta_users')
        .update(updates)
        .eq('id', user.id);
    }

    res.json({ success: true, message: 'Configuration updated successfully' });
  } catch (err) {
    next(err);
  }
});

export default router;
