/**
 * Product events: emitted server-side where the action happens, deduplicated
 * by key, and never allowed to break the action that emitted them.
 */
import { EVENTS, TAXONOMY_VERSION, cleanProperties } from './taxonomy.js';
import { globalFlag } from '../flags.js';

const KEY = /^[A-Za-z0-9_.:-]{8,200}$/;

/**
 * Records one event. Returns { recorded } and never throws: analytics must not
 * change whether a baseline, search or verdict succeeds.
 */
export async function emitProductEvent(admin, { event, workspaceId = null, userId = null, subjectType = null, subjectId = null, properties = {}, dedupeKey, source = 'server', at = null }) {
  try {
    if (!EVENTS.includes(event)) return { recorded: false, reason: 'unknown_event' };
    if (!dedupeKey || !KEY.test(dedupeKey)) return { recorded: false, reason: 'bad_key' };
    if (!(await globalFlag(admin, 'product_analytics'))) return { recorded: false, reason: 'disabled' };
    const row = {
      event,
      version: TAXONOMY_VERSION,
      workspace_id: workspaceId,
      user_id: userId,
      subject_type: subjectType,
      subject_id: subjectId ? String(subjectId).slice(0, 80) : null,
      properties: cleanProperties(event, properties),
      source,
      dedupe_key: dedupeKey,
    };
    if (at) row.occurred_at = at;
    // On a duplicate key nothing is inserted and nothing comes back.
    const { data, error } = await admin.from('product_events').upsert(row, { onConflict: 'dedupe_key', ignoreDuplicates: true }).select('id');
    if (error) {
      console.error('[analytics] product event not recorded', event, error.message);
      return { recorded: false, reason: 'error' };
    }
    return data && data.length ? { recorded: true } : { recorded: false, reason: 'duplicate' };
  } catch (error) {
    console.error('[analytics] product event not recorded', event, error?.message || error);
    return { recorded: false, reason: 'error' };
  }
}

/** Verdict events for a set of evaluated plans or evaluations, one per subject. */
export async function emitVerdicts(admin, { workspaceId, userId, items, stage }) {
  for (const it of items) {
    const verdict = String(it.verdict || '').toUpperCase();
    const event = verdict === 'VERIFIED' ? 'verdict_verified' : verdict === 'REJECTED' ? 'verdict_rejected' : verdict === 'INCOMPLETE' ? 'verdict_incomplete' : null;
    if (!event) continue;
    await emitProductEvent(admin, { event, workspaceId, userId, subjectType: it.subjectType, subjectId: it.id, properties: { stage, strategy: it.strategy || undefined }, dedupeKey: `verdict:${it.subjectType}:${it.id}` });
  }
}
