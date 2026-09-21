import bcrypt from 'bcrypt';
import { CONSTANTS } from '../config/constants.js';

export class PinService {
  static async hashPin(pin) {
    if (!pin || typeof pin !== 'string' || !/^\d{4}$/.test(pin.trim())) {
      throw new Error('PIN must be exactly 4 digits');
    }
    return await bcrypt.hash(pin.trim(), CONSTANTS.BCRYPT_SALT_ROUNDS);
  }

  static async verifyPin(pin, hash) {
    if (!pin || !hash) return false;
    return await bcrypt.compare(pin.trim(), hash);
  }
}

export const pinService = new PinService();

