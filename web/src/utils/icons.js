// Inline SVG icon set (no icon font, no external sprite). Each entry is the
// trusted static inner markup for a 24×24 stroke icon. User data never reaches
// this file — callers only pass a fixed icon name.
const PATHS = {
  dashboard:
    '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
  review: '<path d="M4 5h16v14H4z"/><path d="M4 5v6h5l2 3h2l2-3h5V5"/>',
  reports:
    '<path d="M4 20V4"/><path d="M4 20h16"/><rect x="7" y="11" width="3" height="6" rx="1"/><rect x="12" y="7" width="3" height="10" rx="1"/><rect x="17" y="13" width="3" height="4" rx="1"/>',
  raw: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/>',
  text: '<path d="M5 4h11l3 3v13H5z"/><path d="M16 4v4h4"/><path d="M8 12h8M8 16h6"/>',
  // The "Add from text" action is a plain letter T (type a sentence) rather
  // than the document glyph `text` above.
  textT: '<path d="M5 6V4h14v2"/><path d="M12 4v16"/><path d="M9 20h6"/>',
  menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
  signOut:
    '<path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
  transfer:
    '<path d="M4 7h13"/><path d="m14 4 3 3-3 3"/><path d="M20 17H7"/><path d="m10 14-3 3 3 3"/>',
  toggle: '<rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="8" cy="12" r="2.5"/>',
  tags: '<path d="M20.6 13.6 12 22l-9-9V3h10l7.6 7.6a2 2 0 0 1 0 3z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  accounts:
    '<path d="M3 7a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M16 12h4"/><circle cx="16.5" cy="12" r="1"/>',
  categories:
    '<path d="M4 4h7v7H4z"/><path d="M13 4h7v7h-7z"/><path d="M4 13h7v7H4z"/><path d="M16.5 13v7M13 16.5h7"/>',
  budgets: '<circle cx="12" cy="12" r="9"/><path d="M12 3v9l6.4 6.4"/>',
  export: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>',
  settings:
    '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1z"/>',
  chevronLeft: '<path d="m15 5-7 7 7 7"/>',
  chevronRight: '<path d="m9 5 7 7-7 7"/>',
  dot: '<circle cx="12" cy="12" r="3"/>',
  // Theme toggle (sidebar) — monochrome line icons matching the other sidebar
  // glyphs, replacing the bright-yellow ☀️/🌙 emoji.
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  // Asset-composition empty state.
  wallet:
    '<path d="M19 7V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2H5"/><circle cx="16.5" cy="13" r="1.3"/>',
  // Edit-mode row actions. These replace the 🔁 emoji and the raster
  // `red-cross-mark.png`, so every row action is now a monochrome line icon
  // that inherits `currentColor` like the rest of the set.
  repeat:
    '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
  trash:
    '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M6 6v14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V6"/><path d="M10 11v6M14 11v6"/>',
};

export function icon(name, { size = 18, className = '', title = null } = {}) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.classList.add('mt-icon');
  if (className) svg.classList.add(...className.split(/\s+/).filter(Boolean));
  svg.innerHTML = PATHS[name] ?? PATHS.dot;
  if (title) {
    svg.setAttribute('role', 'img');
    const tEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    tEl.textContent = title;
    svg.appendChild(tEl);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  return svg;
}
