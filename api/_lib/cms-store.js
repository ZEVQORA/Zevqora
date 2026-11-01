/**
 * CMS persistence: one open draft per key, atomic publish (cms_publish), and
 * rollback by republishing an earlier revision as a new version. History is
 * append-only in the database; nothing here can rewrite a published value.
 */
import { ApiError } from './http.js';
import { SCHEMAS } from './cms.js';

const must = ({ data, error }) => {
  if (error) throw error;
  return data;
};

async function nextVersion(admin, key) {
  const rows = must(await admin.from('site_content_revisions').select('version').eq('key', key).order('version', { ascending: false }).limit(1));
  return (rows[0]?.version || 0) + 1;
}

/** Creates or replaces the key's open draft. */
export async function saveDraft(admin, { key, value, userId, note = null, sourceRevisionId = null }) {
  if (!SCHEMAS[key]) throw new ApiError(400, 'Unknown content key.', 'VALIDATION');
  const [open] = must(await admin.from('site_content_revisions').select('id,version').eq('key', key).eq('status', 'draft').limit(1));
  if (open) {
    return must(await admin.from('site_content_revisions').update({ value, note, created_by: userId, created_at: new Date().toISOString(), source_revision_id: sourceRevisionId }).eq('id', open.id).select('*').single());
  }
  return must(await admin.from('site_content_revisions').insert({ key, version: await nextVersion(admin, key), value, status: 'draft', note, created_by: userId, source_revision_id: sourceRevisionId }).select('*').single());
}

export async function discardDraft(admin, { key }) {
  const [open] = must(await admin.from('site_content_revisions').select('id,version').eq('key', key).eq('status', 'draft').limit(1));
  if (!open) throw new ApiError(404, 'There is no open draft for this section.', 'NOT_FOUND');
  must(await admin.from('site_content_revisions').update({ status: 'discarded' }).eq('id', open.id).select('id'));
  return open;
}

/** Publishes a draft in one transaction (supersede live → publish draft → update site_content). */
export async function publishRevision(admin, { revisionId, userId, key = null }) {
  const rev = must(await admin.from('site_content_revisions').select('id,key,status,version').eq('id', revisionId).maybeSingle());
  if (!rev || (key && rev.key !== key)) throw new ApiError(404, 'Revision not found.', 'NOT_FOUND');
  if (rev.status !== 'draft') throw new ApiError(409, 'Only a draft can be published.', 'NOT_A_DRAFT');
  const { data, error } = await admin.rpc('cms_publish', { p_revision: revisionId, p_actor: userId });
  if (error) throw error;
  return data;
}

/** Restores an earlier revision by publishing a copy of it as the next version. */
export async function rollbackTo(admin, { key, revisionId, userId }) {
  const target = must(await admin.from('site_content_revisions').select('id,key,version,value,status').eq('id', revisionId).maybeSingle());
  if (!target || target.key !== key) throw new ApiError(404, 'Revision not found.', 'NOT_FOUND');
  if (!['published', 'superseded'].includes(target.status)) throw new ApiError(409, 'Only a revision that was published can be restored.', 'NOT_PUBLISHED');
  if (target.status === 'published') throw new ApiError(409, 'That revision is already live.', 'ALREADY_LIVE');
  const [open] = must(await admin.from('site_content_revisions').select('id').eq('key', key).eq('status', 'draft').limit(1));
  if (open) throw new ApiError(409, 'Publish or discard the open draft before restoring an older version.', 'DRAFT_OPEN');
  const draft = await saveDraft(admin, { key, value: target.value, userId, note: `Restore of version ${target.version}`, sourceRevisionId: target.id });
  const out = await publishRevision(admin, { revisionId: draft.id, userId });
  return { ...out, restored_version: target.version };
}

/** Live value, open draft and recent history for every editable key. */
export async function cmsState(admin) {
  const [live, revisions] = await Promise.all([must(await admin.from('site_content').select('key,value,updated_at,updated_by')), must(await admin.from('site_content_revisions').select('id,key,version,status,value,note,source_revision_id,created_by,created_at,published_by,published_at').order('version', { ascending: false }).limit(500))]);
  return Object.keys(SCHEMAS).map((key) => {
    const mine = revisions.filter((r) => r.key === key);
    return {
      key,
      live: live.find((l) => l.key === key) || null,
      live_revision: mine.find((r) => r.status === 'published') || null,
      draft: mine.find((r) => r.status === 'draft') || null,
      history: mine.filter((r) => r.status !== 'draft').slice(0, 20).map(({ value: _v, ...meta }) => meta),
    };
  });
}

export async function revision(admin, id) {
  return must(await admin.from('site_content_revisions').select('*').eq('id', id).maybeSingle());
}
