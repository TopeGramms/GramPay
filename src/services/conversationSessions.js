import { supabase as defaultSupabase } from '../db/supabase.js';
import { logger } from '../lib/logger.js';

const NEVER_PERSIST = new Set(['pinCandidate', 'newPinCandidate', 'billAuthToken']);

function safeSession(session) {
  const safe = structuredClone(session);
  for (const key of NEVER_PERSIST) delete safe[key];

  // After a restart the confirmation value cannot be checked because it is deliberately not stored.
  if (safe.state === 'CONFIRMING_NEW_PIN') safe.state = 'SETTING_PIN_FIRST';
  if (safe.state === 'ONBOARDING_CONFIRMING_PIN') safe.state = 'ONBOARDING_SETTING_PIN';
  // Secure web authorization tokens are process-local; require fresh user confirmation after restart.
  if (safe.state === 'BILL_AWAITING_SECURE_PIN') safe.state = 'BILL_AWAITING_CONFIRMATION';
  return safe;
}

export class PersistentSessionStore {
  constructor({ supabase = defaultSupabase, ttlMs }) {
    this.supabase = supabase;
    this.ttlMs = ttlMs;
    this.sessions = new Map();
    this.pendingWrites = new Map();
  }

  get(phone) {
    return this.sessions.get(phone);
  }

  set(phone, session) {
    this.sessions.set(phone, session);
    const safe = safeSession(session);
    const timestamp = Number(session.timestamp) || Date.now();
    const row = {
      phone_number: String(phone).replace(/\D/g, ''),
      session_state: safe,
      expires_at: new Date(timestamp + this.ttlMs).toISOString(),
      updated_at: new Date().toISOString(),
    };

    const prior = this.pendingWrites.get(phone) || Promise.resolve();
    const write = prior.catch(() => {}).then(async () => {
      const { error } = await this.supabase
        .from('conversation_sessions')
        .upsert(row, { onConflict: 'phone_number' });
      if (error) throw error;
    });
    const trackedWrite = write.catch(error => {
      logger.error({ phone, error: error.message }, 'Could not persist conversation session');
    });
    this.pendingWrites.set(phone, trackedWrite);
    trackedWrite.finally(() => {
      if (this.pendingWrites.get(phone) === trackedWrite) this.pendingWrites.delete(phone);
    });
    return this;
  }

  delete(phone) {
    this.sessions.delete(phone);
    const prior = this.pendingWrites.get(phone) || Promise.resolve();
    const deletion = prior.catch(() => {}).then(async () => {
      const { error } = await this.supabase
        .from('conversation_sessions')
        .delete()
        .eq('phone_number', String(phone).replace(/\D/g, ''));
      if (error) throw error;
    });
    const trackedDelete = deletion.catch(error => {
      logger.error({ phone, error: error.message }, 'Could not delete conversation session');
    });
    this.pendingWrites.set(phone, trackedDelete);
    trackedDelete.finally(() => {
      if (this.pendingWrites.get(phone) === trackedDelete) this.pendingWrites.delete(phone);
    });
    return true;
  }

  async flush(phone) {
    const pending = this.pendingWrites.get(phone);
    if (pending) await pending;
  }

  async load(phone) {
    await this.flush(phone);
    if (this.sessions.has(phone)) return this.sessions.get(phone);

    const cleanPhone = String(phone).replace(/\D/g, '');
    try {
      const { data, error } = await this.supabase
        .from('conversation_sessions')
        .select('session_state, expires_at')
        .eq('phone_number', cleanPhone)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      if (!data.expires_at || new Date(data.expires_at).getTime() <= Date.now()) {
        this.delete(cleanPhone);
        await this.flush(cleanPhone);
        return null;
      }

      const session = safeSession(data.session_state || {});
      this.sessions.set(cleanPhone, session);
      return session;
    } catch (error) {
      logger.error({ phone: cleanPhone, error: error.message }, 'Could not restore conversation session');
      return null;
    }
  }
}
