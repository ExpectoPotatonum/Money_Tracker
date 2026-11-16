import { supabase } from '../lib/supabaseClient.js';
import { sortCategoryRows } from '../utils/categories.js';

// Categories are shared reference data (no user_id). Read is open to every
// authenticated user (202608170000); writes are granted by
// 202611160001_categories_and_debit_card.sql for the web category manager.
// Single-user project today — see the migration note before going multi-user.

function asError(error) {
  const e = new Error(error.message);
  if (error.code) e.code = error.code;
  return e;
}

export async function listCategories() {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, parent_id, icon, color, created_at')
    .order('name', { ascending: true });
  if (error) throw asError(error);
  return sortCategoryRows(Array.isArray(data) ? data : []);
}

export async function saveCategory(category) {
  const clean = {
    name: String(category.name ?? '').trim(),
    parent_id: category.parent_id || null,
    icon: String(category.icon ?? '').trim() || null,
    color: category.color || null,
  };
  if (!clean.name) throw new Error('category name is required');

  if (category.id) {
    const { data, error } = await supabase
      .from('categories')
      .update(clean)
      .eq('id', category.id)
      .select('id, name, parent_id, icon, color')
      .single();
    if (error) throw asError(error);
    return data;
  }
  const { data, error } = await supabase
    .from('categories')
    .insert(clean)
    .select('id, name, parent_id, icon, color')
    .single();
  if (error) throw asError(error);
  return data;
}

// Refuse to delete a category that owns transactions or has child categories —
// the fix is to re-categorize/move first, never to cascade financial history.
export async function deleteCategory(id) {
  const [{ count: txnCount, error: txnErr }, { count: childCount, error: childErr }] =
    await Promise.all([
      supabase
        .from('transactions')
        .select('id', { count: 'exact', head: true })
        .eq('category_id', id),
      supabase.from('categories').select('id', { count: 'exact', head: true }).eq('parent_id', id),
    ]);
  if (txnErr) throw asError(txnErr);
  if (childErr) throw asError(childErr);
  if ((txnCount ?? 0) > 0) {
    const e = new Error(`${txnCount} transaction(s) still use this category`);
    e.code = 'CATEGORY_IN_USE';
    e.count = txnCount;
    throw e;
  }
  if ((childCount ?? 0) > 0) {
    const e = new Error(`${childCount} sub-category/ies still use this category`);
    e.code = 'CATEGORY_HAS_CHILDREN';
    e.count = childCount;
    throw e;
  }
  const { error } = await supabase.from('categories').delete().eq('id', id);
  if (error) throw asError(error);
}
