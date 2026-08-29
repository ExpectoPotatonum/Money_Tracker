/* Client-side auto-logger.
 *
 * Captures three classes of events and appends them to a CSV file that
 * auto-rotates (max 5 files, max 5 MB each):
 *   1. window errors + unhandled promise rejections
 *   2. thrown errors in the dashboard/review render path
 *   3. details of the Supabase request that caused the failure
 *
 * Storage is IndexedDB-backed so it keeps working headlessly, survives
 * reloads, and can be rotated into at most MAX_FILES historical files, each
 * capped at MAX_BYTES. A convenience CSV download also fires per write.
 * The logger never throws into the app.
 */
const LOG_NAME = 'expense-tracker-errors';
const MAX_FILES = 5;
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const COLUMNS = ['timestamp', 'level', 'source', 'status', 'url', 'message', 'detail'];
const CSV_HEADER = COLUMNS.join(',') + '\n';

function ts() {
  return new Date().toISOString();
}

function csvEscape(value) {
  const s = String(value ?? '');
  return '"' + s.replace(/"/g, '""').replace(/\r?\n/g, ' ') + '"';
}

function toCsvRow(fields) {
  return COLUMNS.map((c) => csvEscape(fields[c] ?? '')).join(',') + '\n';
}

/* ---- IndexedDB persistence ---- */
const DB_NAME = 'tracker-log';
const DB_STORE = 'errors';
// Bumped from 1 -> 2 to force onupgradeneeded on databases created before the
// store existed (a pre-release could have left a v1 DB with no object store).
const DB_VERSION = 2;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(DB_STORE)) {
        req.result.createObjectStore(DB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function storeKey(index) {
  return index === 0 ? 'current' : `${LOG_NAME}.${index}`;
}

async function readStored(index) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const g = db.transaction(DB_STORE, 'readonly').objectStore(DB_STORE).get(storeKey(index));
    g.onsuccess = () => resolve(g.result || { name: LOG_NAME, size: 0, rows: CSV_HEADER });
    g.onerror = () => reject(g.error);
  });
}

async function writeStored(index, meta) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    const store = tx.objectStore(DB_STORE);
    store.put(meta, storeKey(index));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/* Shift every existing file one slot down the rotation chain (current -> .1,
 * .1 -> .2, ...), dropping anything beyond MAX_FILES. Caller then starts a
 * fresh current file. */
async function rotateDown() {
  const snapshots = [];
  for (let i = 0; i < MAX_FILES; i++) {
    snapshots.push(await readStored(i));
  }
  // Drop the oldest first so the chain never exceeds MAX_FILES.
  for (let i = MAX_FILES - 2; i >= 0; i--) {
    const meta = snapshots[i];
    if (meta && meta.rows && meta.rows !== CSV_HEADER) {
      await writeStored(i + 1, meta);
    }
  }
}

async function logEvent(entry) {
  try {
    const meta = await readStored(0);
    const existingSize = (meta.rows || CSV_HEADER).length;

    // Rotate before append so a burst that would overflow the cap instead
    // rolls into a fresh file rather than silently dropping the newest entry.
    if (existingSize + 160 >= MAX_BYTES) {
      await rotateDown();
    }

    const base = (await readStored(0)).rows || CSV_HEADER;
    const next = {
      name: LOG_NAME,
      size: base.length + entry.length,
      rows: base + entry,
    };
    await writeStored(0, next);

    try {
      const blob = new Blob([next.rows], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = next.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch {
      /* download is a convenience; IndexedDB is the source of truth */
    }
  } catch (err) {
    // Logger must never throw into the app.
    console.error('logger failure', err);
  }
}

/* ---- hooks ---- */

function installGlobalHandlers() {
  window.addEventListener('error', (e) => {
    logEvent(
      toCsvRow({
        timestamp: ts(),
        level: 'error',
        source: 'window',
        url: e.filename || (window.location && window.location.href) || '',
        message: e.message,
        detail: e.error && e.error.stack ? e.error.stack.split('\n').slice(0, 2).join(' | ') : '',
      }),
    );
  });

  window.addEventListener('unhandledrejection', (e) => {
    logEvent(
      toCsvRow({
        timestamp: ts(),
        level: 'error',
        source: 'unhandledrejection',
        message: (e.reason && (e.reason.message || e.reason)) || 'unhandled rejection',
        detail: (e.reason && e.reason.stack) || '',
      }),
    );
  });
}

export function installLogger() {
  installGlobalHandlers();
}

export function logApiError(source, error) {
  logEvent(
    toCsvRow({
      timestamp: ts(),
      level: 'error',
      source,
      status: (error && (error.status || error.code)) || '',
      url: (error && error.url) || '',
      message: (error && error.message) || String(error),
      detail: (error && error.details) || '',
    }),
  );
}

// Export for tests / manual triggering without tree-shaking it out.
export { logEvent, readStored, storeKey };
