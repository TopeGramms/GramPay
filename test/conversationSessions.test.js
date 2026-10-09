import test from 'node:test';
import assert from 'node:assert/strict';
import { PersistentSessionStore } from '../src/services/conversationSessions.js';

function fakeSupabase(seed = []) {
  const rows = new Map(seed.map(row => [row.phone_number, row]));
  return {
    rows,
    from(table) {
      assert.equal(table, 'conversation_sessions');
      let phone;
      return {
        upsert(row) {
          rows.set(row.phone_number, structuredClone(row));
          return Promise.resolve({ data: row, error: null });
        },
        select() {
          return {
            eq(column, value) {
              assert.equal(column, 'phone_number');
              phone = value;
              return {
                maybeSingle: async () => ({ data: rows.get(phone) || null, error: null }),
              };
            },
          };
        },
        delete() {
          return {
            eq(column, value) {
              assert.equal(column, 'phone_number');
              rows.delete(value);
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
}

test('conversation step survives a new handler session and sensitive PIN values are never persisted', async () => {
  const supabase = fakeSupabase();
  const firstProcess = new PersistentSessionStore({ supabase, ttlMs: 300_000 });
  firstProcess.set('2348012345678', {
    state: 'ONBOARDING_CONFIRMING_PIN',
    timestamp: Date.now(),
    displayName: 'Ada',
    pinCandidate: '1234',
  });
  await firstProcess.flush('2348012345678');

  const newProcess = new PersistentSessionStore({ supabase, ttlMs: 300_000 });
  const restored = await newProcess.load('2348012345678');

  assert.equal(restored.state, 'ONBOARDING_SETTING_PIN');
  assert.equal(restored.displayName, 'Ada');
  assert.equal('pinCandidate' in restored, false);
  assert.equal('pinCandidate' in supabase.rows.get('2348012345678').session_state, false);
});

test('expired conversation state does not restore', async () => {
  const supabase = fakeSupabase();
  const store = new PersistentSessionStore({ supabase, ttlMs: 1 });
  store.set('2348012345678', { state: 'ONBOARDING_AWAITING_NAME', timestamp: Date.now() - 100 });
  await store.flush('2348012345678');

  const newProcess = new PersistentSessionStore({ supabase, ttlMs: 1 });
  assert.equal(await newProcess.load('2348012345678'), null);
  assert.equal(supabase.rows.has('2348012345678'), false);
});
