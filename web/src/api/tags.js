// Tag + tag-group API (Phase 1). Groups are the two-level hierarchy top
// (ezBookkeeping model); tags belong to a group (nullable) and carry an
// optional color. All tables are owner-scoped under RLS, so these run as the
// signed-in user with no special role (AGENTS §17 conventions).
import { supabase } from '../lib/supabaseClient.js';

// Groups with their tags nested (color + id), ordered by sort_order then name.
// Returns a flat array of tags for the picker: [{ id, name, color, group }].
export async function getTagGroups() {
  const { data, error } = await supabase
    .from('tag_groups')
    .select('id, name, sort_order, tags (id, name, color, group_id)')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
    .order('name', { ascending: true, foreignTable: 'tags' });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Insert a new group. Returns the created row (id) so the UI can bind to it.
export async function createTagGroup(name) {
  const { data, error } = await supabase
    .from('tag_groups')
    .insert({ name: String(name).trim() })
    .select('id, name, sort_order')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function renameTagGroup(id, name) {
  const { error } = await supabase
    .from('tag_groups')
    .update({ name: String(name).trim() })
    .eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteTagGroup(id) {
  // tags.group_id is `on delete set null` — deleting a group leaves its tags
  // behind, ungrouped, rather than silently deleting every tag inside it.
  const { error } = await supabase.from('tag_groups').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// Create a tag, optionally inside a group, with an optional color.
export async function createTag({ name, groupId = null, color = null }) {
  const { data, error } = await supabase
    .from('tags')
    .insert({
      name: String(name).trim(),
      group_id: groupId,
      color: color || null,
    })
    .select('id, name, color, group_id')
    .single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteTag(id) {
  // transaction_tags.tag_id is `on delete cascade` — removing a tag removes
  // its links everywhere.
  const { error } = await supabase.from('tags').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

// Set the exact set of tags on one transaction (replaces the current set).
// Implemented as delete-all + insert to keep the composite-PK idempotency key
// simple; the row set is tiny, so a two-step swap is fine.
export async function setTransactionTags(transactionId, tagIds) {
  const { error: delErr } = await supabase
    .from('transaction_tags')
    .delete()
    .eq('transaction_id', transactionId);
  if (delErr) throw new Error(delErr.message);

  if (!tagIds || tagIds.length === 0) return;

  const rows = tagIds.map((tagId) => ({ transaction_id: transactionId, tag_id: tagId }));
  const { error: insErr } = await supabase.from('transaction_tags').insert(rows);
  if (insErr) throw new Error(insErr.message);
}