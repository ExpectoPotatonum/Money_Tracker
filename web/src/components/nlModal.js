import { openModal } from './common.js';
import { parseTransactionText, llmErrorMessage } from '../utils/ai.js';
import { insertTransaction } from '../api/transactions.js';
import { toDateTimeLocal, fromDateTimeLocal, currencyOptions } from '../utils/format.js';
import { buildSourceEditor, DEFAULT_SOURCE } from '../utils/sources.js';
import { llmConfigured } from '../utils/llm.js';
import { openSettings } from './settingsDialog.js';
import { t } from '../lib/i18n.js';
import { getSettings } from '../lib/settings.js';

const DIRECTIONS = ['debit', 'credit'];

// Click-to-talk voice input (Phase F web half). Wraps the Web Speech API and
// is a no-op when unsupported (the button stays hidden). Tapping starts the
// recognizer; tapping again (or silence) stops it; transcripts append to the
// target textarea so the user can edit before parsing.
function hookUpVoice({ text, status, lang }) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const voiceBtn = document.getElementById('nl-voice-btn');
  if (!SR || !voiceBtn) return;
  voiceBtn.classList.remove('d-none');

  let rec = null;

  function setRecording(on) {
    voiceBtn.classList.toggle('btn-danger', on);
    voiceBtn.classList.toggle('btn-outline-secondary', !on);
    voiceBtn.querySelector('.mic-glyph').textContent = on ? '⏹' : '🎤';
    if (on) {
      status.textContent = t('nl.voice.recording');
      status.classList.remove('text-danger');
    } else {
      status.textContent = '';
    }
  }

  function start() {
    const r = new SR();
    r.lang = lang === 'zh' ? 'zh-CN' : 'en-MY';
    r.interimResults = false;
    r.maxAlternatives = 1;

    r.onresult = (e) => {
      const said = Array.from(e.results)
        .map((res) => res[0].transcript)
        .join(' ');
      text.value = (text.value.trim() ? text.value.trim() + ' ' : '') + said.trim();
    };
    r.onerror = (e) => {
      setRecording(false);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        status.textContent = t('nl.voice.denied');
      } else if (e.error !== 'aborted' && e.error !== 'no-speech') {
        status.textContent = t('nl.voice.error');
      } else {
        status.textContent = '';
      }
      status.classList.add('text-danger');
    };
    r.onend = () => {
      setRecording(false);
      rec = null;
    };
    r.onstart = () => setRecording(true);

    rec = r;
    try {
      r.start();
    } catch {
      setRecording(false);
      rec = null;
    }
  }

  function stop() {
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
    }
    rec = null;
    setRecording(false);
  }

  voiceBtn.addEventListener('click', () => {
    if (rec) {
      stop();
    } else {
      start();
    }
  });
}

// Phase B — NL bookkeeping. Freeform sentence -> AI-parsed preview -> insert a
// manual transaction (source_package 'manual', no raw_notifications link —
// needs the 202609060003 migration). Manual rows carry confidence 'low' (no
// notification cross-check) and are ready for normal edit-mode correction.
export function openNlModal({ categoryNames, onSaved = null }) {
  const { dialog, body, footer } = openModal({ title: t('nl.title') });

  const text = document.createElement('textarea');
  text.className = 'form-control';
  text.rows = 3;
  text.placeholder = t('nl.placeholder');
  text.required = true;
  body.appendChild(text);

  // Click-to-talk voice input (hidden when the browser has no Web Speech API).
  const micWrap = document.createElement('div');
  micWrap.className = 'mt-2';
  const voiceBtn = document.createElement('button');
  voiceBtn.type = 'button';
  voiceBtn.id = 'nl-voice-btn';
  voiceBtn.className = 'btn btn-outline-secondary btn-sm d-none';
  voiceBtn.title = t('nl.voice');
  voiceBtn.setAttribute('aria-label', t('nl.voice'));
  const glyph = document.createElement('span');
  glyph.className = 'mic-glyph';
  glyph.textContent = '🎤';
  voiceBtn.appendChild(glyph);
  micWrap.appendChild(voiceBtn);
  body.appendChild(micWrap);

  const status = document.createElement('div');
  status.className = 'small text-muted mt-2';
  body.appendChild(status);

  const isZh = getSettings().lang === 'zh';
  hookUpVoice({ text, status, lang: isZh ? 'zh' : 'en' });

  const parseBtn = document.createElement('button');
  parseBtn.type = 'button';
  parseBtn.className = 'btn btn-primary';
  parseBtn.id = 'nl-parse-btn';
  parseBtn.textContent = t('nl.parse');

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-outline-secondary';
  cancel.textContent = t('nl.cancel');
  cancel.addEventListener('click', () => dialog.close());

  footer.appendChild(parseBtn);
  footer.appendChild(cancel);

  parseBtn.addEventListener('click', async () => {
    if (!text.value.trim()) return;
    if (!llmConfigured()) {
      status.textContent = t('settings.ai.keyMissing');
      status.classList.add('text-danger');
      status.classList.remove('text-muted');
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn btn-link btn-sm p-0 ms-2';
      go.textContent = t('nav.settings');
      go.addEventListener('click', () => openSettings());
      status.appendChild(go);
      return;
    }
    parseBtn.disabled = true;
    status.textContent = t('nl.parsing');
    status.classList.remove('text-danger');

    const { draft, error } = await parseTransactionText(text.value.trim(), categoryNames);
    if (error) {
      parseBtn.disabled = false;
      status.classList.add('text-danger');
      if (error.code === 'llm') {
        status.textContent = llmErrorMessage(error);
        const go = document.createElement('button');
        go.type = 'button';
        go.className = 'btn btn-link btn-sm p-0 ms-2';
        go.textContent = t('nav.settings');
        go.addEventListener('click', () => openSettings());
        status.appendChild(go);
      } else {
        status.textContent = t('nl.failed');
      }
      return;
    }
    status.classList.remove('text-danger');
    showPreview(draft);
  });

  function showPreview(draft) {
    parseBtn.style.display = 'none';
    body.replaceChildren();
    body.classList.add('pt-2');

    const note = document.createElement('div');
    note.className = 'small text-muted mb-3';
    note.textContent = t('nl.preview');
    body.appendChild(note);

    const fields = document.createElement('div');
    fields.className = 'row g-2';

    const amount = field('number', t('nl.field.amount'), String(draft.amount));
    amount.input.step = '0.01';
    amount.input.min = '0';
    fields.appendChild(amount.wrap('col-4'));

    const currency = selectField(t('nl.field.currency'), currencyOptions(), draft.currency);
    fields.appendChild(currency.wrap('col-4'));

    const direction = selectField(t('nl.field.direction'), DIRECTIONS, draft.direction, {
      debit: t('nl.direction.debit'),
      credit: t('nl.direction.credit'),
    });
    fields.appendChild(direction.wrap('col-4'));

    const merchant = field('text', t('nl.field.merchant'), draft.merchant_raw ?? '');
    fields.appendChild(merchant.wrap('col-12'));

    const category = selectField(
      t('nl.field.category'),
      [...categoryNames.values()],
      categoryLabel(draft.category_id),
      undefined,
      true,
    );
    fields.appendChild(category.wrap('col-12'));

    // Source (payment method) — defaults to Cash; the picker allows any custom
    // label. Manual rows keep source_package 'manual'; only the label changes.
    const sourceCol = document.createElement('div');
    sourceCol.className = 'col-6';
    let sourceLabel = DEFAULT_SOURCE;
    sourceCol.appendChild(
      buildSourceEditor(sourceLabel, {
        onChange: (v) => {
          sourceLabel = v || DEFAULT_SOURCE;
        },
      }),
    );
    fields.appendChild(sourceCol);

    const date = field(
      'datetime-local',
      t('nl.field.date'),
      toDateTimeLocal(draft.transaction_date),
    );
    fields.appendChild(date.wrap('col-6'));

    const notes = field('text', t('nl.field.notes'), draft.notes ?? '');
    fields.appendChild(notes.wrap('col-12'));

    body.appendChild(fields);

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'btn btn-primary';
    save.id = 'nl-save-btn';
    save.textContent = t('nl.save');
    save.addEventListener('click', async () => {
      const row = {
        amount: Number(amount.input.value),
        currency: currency.input.value,
        direction: direction.input.value,
        merchant_raw: merchant.input.value.trim() || null,
        category_id: categoryIdFromLabel(category.input.value),
        transaction_date: fromDateTimeLocal(date.input.value),
        notes: notes.input.value.trim() || null,
        source_package: 'manual',
        source_app_label: sourceLabel,
        confidence: 'low',
        status: 'confirmed',
        notification_posted_at: fromDateTimeLocal(date.input.value),
      };
      save.disabled = true;
      try {
        await insertTransaction(row);
        status.className = 'small text-success mt-2';
        status.textContent = t('nl.saved');
        body.appendChild(status);
        if (onSaved) onSaved();
        setTimeout(() => dialog.close(), 700);
      } catch (err) {
        save.disabled = false;
        status.className = 'small text-danger mt-2';
        status.textContent = `${t('nl.saveFailed')} ${err.message}`;
        body.appendChild(status);
      }
    });
    footer.replaceChildren(save, cancel);
  }

  function categoryLabel(id) {
    if (!id) return '';
    return categoryNames.get(id) ?? '';
  }
  function categoryIdFromLabel(label) {
    if (!label) return null;
    for (const [id, name] of categoryNames) {
      if (name === label) return id;
    }
    return null;
  }
}

// Small form-field helpers (labels rendered via textContent — user data never
// goes through innerHTML, matching the rest of the app).
function field(type, label, value) {
  const wrapEl = document.createElement('div');
  const l = document.createElement('label');
  l.className = 'form-label small mb-1';
  l.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  input.className = 'form-control form-control-sm';
  input.value = value;
  return { wrap: (col) => ((wrapEl.className = col), wrapEl.append(l, input), wrapEl), input };
}

function selectField(label, options, selected, labels = {}, allowEmpty = false) {
  const wrapEl = document.createElement('div');
  const l = document.createElement('label');
  l.className = 'form-label small mb-1';
  l.textContent = label;
  const select = document.createElement('select');
  select.className = 'form-select form-select-sm';
  if (allowEmpty) {
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = '—';
    select.appendChild(empty);
  }
  for (const opt of options) {
    const el = document.createElement('option');
    el.value = opt;
    el.textContent = labels[opt] ?? opt;
    el.selected = opt === selected;
    select.appendChild(el);
  }
  select.value = selected;
  return {
    wrap: (col) => ((wrapEl.className = col), wrapEl.append(l, select), wrapEl),
    input: select,
  };
}
