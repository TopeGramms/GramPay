import { supabase } from '../db/supabase.js';
import { logger } from '../lib/logger.js';

// In-memory LRU caches for fast replay detection and offline fallback
const recentMessageIds = new Map(); // messageId -> timestamp
const recentWebhookEvents = new Map(); // eventId -> timestamp

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour TTL
const MAX_CACHE_SIZE = 2000;

function pruneCache(map) {
  if (map.size <= MAX_CACHE_SIZE) return;
  const now = Date.now();
  for (const [key, ts] of map.entries()) {
    if (now - ts > CACHE_TTL_MS || map.size > MAX_CACHE_SIZE) {
      map.delete(key);
    }
  }
}

export class DeduplicationService {
  /**
   * Check and record an incoming Meta WhatsApp message ID for replay protection
   * @param {string} messageId Meta WhatsApp message ID (e.g. wamid.HBg...)
   * @param {string} senderPhone Sender's clean phone number
   * @returns {Promise<boolean>} true if message is new and should be processed; false if replay
   */
  async checkAndRecordInboundMessage(messageId, senderPhone) {
    if (!messageId) return true; // If provider didn't pass an ID, allow

    // 1. Fast in-memory check
    if (recentMessageIds.has(messageId)) {
      logger.warn({ messageId, senderPhone }, '⚠️ Replay detected in memory: inbound WhatsApp message already received');
      return false;
    }

    recentMessageIds.set(messageId, Date.now());
    pruneCache(recentMessageIds);

    // 2. Database-backed deduplication
    try {
      const { error } = await supabase
        .from('inbound_messages')
        .insert({
          message_id: messageId,
          sender_phone: senderPhone || null,
        });

      if (error) {
        // Postgres unique violation code 23505
        if (error.code === '23505' || error.message?.includes('duplicate key') || error.message?.includes('unique constraint')) {
          logger.warn({ messageId, senderPhone }, '⚠️ Replay detected in DB: inbound WhatsApp message already recorded');
          return false;
        }
        // If table doesn't exist yet, warn and allow (memory cache will protect)
        logger.warn({ messageId, error: error.message }, 'Could not record message in inbound_messages table (relying on memory cache)');
      }

      return true;
    } catch (err) {
      logger.warn({ messageId, err: err.message }, 'Deduplication DB error; falling back to memory cache');
      return true;
    }
  }

  /**
   * Check and record a provider webhook event ID for replay protection
   * @param {string} eventId Unique webhook event ID or reference
   * @param {string} provider Provider name (e.g. 'flutterwave')
   * @param {string} eventType Event name (e.g. 'transfer.completed')
   * @param {string} reference Provider transaction reference
   * @param {object} payload Event payload
   * @returns {Promise<boolean>} true if event is new; false if duplicate replay
   */
  async checkAndRecordWebhookEvent(eventId, provider = 'flutterwave', eventType = 'transfer.completed', reference = null, payload = {}) {
    if (!eventId) return true;

    const cacheKey = `${provider}:${eventId}`;

    // 1. Fast in-memory check
    if (recentWebhookEvents.has(cacheKey)) {
      logger.info({ eventId, provider }, '⚠️ Replay detected in memory: webhook event already processed');
      return false;
    }

    recentWebhookEvents.set(cacheKey, Date.now());
    pruneCache(recentWebhookEvents);

    // 2. Database-backed deduplication
    try {
      const { error } = await supabase
        .from('processed_webhook_events')
        .insert({
          event_id: String(eventId),
          provider,
          event_type: eventType,
          reference: reference || null,
          payload: payload || {},
        });

      if (error) {
        if (error.code === '23505' || error.message?.includes('duplicate key') || error.message?.includes('unique constraint')) {
          logger.info({ eventId, provider }, '⚠️ Replay detected in DB: webhook event already processed');
          return false;
        }
        logger.warn({ eventId, error: error.message }, 'Could not record webhook in processed_webhook_events table');
      }

      return true;
    } catch (err) {
      logger.warn({ eventId, err: err.message }, 'Webhook deduplication DB error; relying on memory cache');
      return true;
    }
  }
}

export const dedupService = new DeduplicationService();
