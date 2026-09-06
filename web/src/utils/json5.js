// Tolerant parsing of JSON from LLM output. Models routinely wrap objects in
// prose or code fences and occasionally emit JSON5-ish syntax — trailing
// commas, single-quoted strings, unquoted keys. This mirrors BeeCount's
// tolerant-parser idea without pulling in a JSON5 dependency: try strict first,
// then progressively relax, returning null only when nothing parses.
export function extractJsonObject(text) {
  if (typeof text !== 'string') return null;

  let s = text.trim();
  // Strip ```json ... ``` fences (with or without the "json" tag).
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();

  // Only the outermost object matters; ignore any leading/trailing prose.
  const start = s.indexOf('{');
  const end = s.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  s = s.slice(start, end + 1);

  const attempts = [s, dropTrailingCommas(s), json5ish(s)];
  for (const candidate of attempts) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    } catch {
      // fall through to the next attempt
    }
  }
  return null;
}

function dropTrailingCommas(s) {
  return s.replace(/,\s*([}\]])/g, '$1');
}

function json5ish(s) {
  let out = dropTrailingCommas(s);
  // Unquoted keys: `{ amount: 1 }` -> `{ "amount": 1 }`.
  out = out.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');
  // Single-quoted strings -> double-quoted (values and quoted keys).
  out = out.replace(/'([^'\n\\]*(?:\\.[^'\n\\]*)*)'/g, '"$1"');
  return out;
}
