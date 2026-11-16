// Category ordering shared by every dropdown and the category manager.
// Alphabetical (locale-aware) with the catch-all "Other"/"Others" pinned last —
// the owner's rule is that the bucket you pick only when nothing else fits
// should never sit in the middle of a long list.
const OTHER_RE = /^others?$/i;

export function isOtherCategory(name) {
  return OTHER_RE.test(String(name ?? '').trim());
}

function byName(a, b) {
  const ao = isOtherCategory(a);
  const bo = isOtherCategory(b);
  if (ao !== bo) return ao ? 1 : -1;
  return String(a ?? '').localeCompare(String(b ?? ''), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
}

// Sort full category rows by name with Other last.
export function sortCategoryRows(rows) {
  return [...(rows ?? [])].sort((a, b) => byName(a?.name, b?.name));
}

// Sort Map entries ([id, name]) by name with Other last.
export function sortCategoryEntries(entries) {
  return [...(entries ?? [])].sort((a, b) => byName(a?.[1], b?.[1]));
}

// Build the id -> name Map the dashboard/table/pickers consume, preserving the
// sorted order (Map iteration order is insertion order).
export function categoryNameMap(rows) {
  return new Map(sortCategoryRows(rows).map((c) => [c.id, c.name]));
}
