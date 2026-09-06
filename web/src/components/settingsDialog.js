import { openModal } from './common.js';
import { getSettings, saveSettings, DEFAULT_MODEL } from '../lib/settings.js';
import { setLocale, t } from '../lib/i18n.js';
import { updatePassword } from '../api/auth.js';

// Settings dialog (Phase A). Stored browser-local only — the LLM key never
// leaves this machine (Q2). Language applies immediately on save; the app
// reloads so every view re-renders in the new locale.
export function openSettings() {
  const { dialog, body, footer } = openModal({ title: t('settings.title') });
  const s = getSettings();

  const form = document.createElement('form');
  form.addEventListener('submit', (e) => e.preventDefault());

  // --- AI section ---
  const aiHeading = document.createElement('h6');
  aiHeading.className = 'mt-2';
  aiHeading.textContent = t('settings.ai');
  form.appendChild(aiHeading);

  const enableWrap = document.createElement('div');
  enableWrap.className = 'form-check form-switch mb-2';
  const enable = document.createElement('input');
  enable.type = 'checkbox';
  enable.className = 'form-check-input';
  enable.id = 'settings-ai-enable';
  enable.checked = s.llmEnabled;
  const enableLabel = document.createElement('label');
  enableLabel.className = 'form-check-label';
  enableLabel.setAttribute('for', 'settings-ai-enable');
  enableLabel.textContent = t('settings.ai.enable');
  const enableHint = document.createElement('div');
  enableHint.className = 'form-text';
  enableHint.textContent = t('settings.ai.enableHint');
  enableWrap.append(enable, enableLabel, enableHint);
  form.appendChild(enableWrap);

  const keyGroup = document.createElement('div');
  keyGroup.className = 'mb-2';
  const keyLabel = document.createElement('label');
  keyLabel.className = 'form-label';
  keyLabel.setAttribute('for', 'settings-ai-key');
  keyLabel.textContent = t('settings.ai.key');
  const key = document.createElement('input');
  key.type = 'password';
  key.className = 'form-control';
  key.id = 'settings-ai-key';
  key.placeholder = t('settings.ai.keyPlaceholder');
  key.value = s.llmKey;
  key.autocomplete = 'off';
  keyGroup.append(keyLabel, key);
  form.appendChild(keyGroup);

  const modelGroup = document.createElement('div');
  modelGroup.className = 'mb-2';
  const modelLabel = document.createElement('label');
  modelLabel.className = 'form-label';
  modelLabel.setAttribute('for', 'settings-ai-model');
  modelLabel.textContent = t('settings.ai.model');
  const model = document.createElement('input');
  model.type = 'text';
  model.className = 'form-control';
  model.id = 'settings-ai-model';
  model.placeholder = DEFAULT_MODEL;
  model.value = s.llmModel;
  modelGroup.append(modelLabel, model);
  form.appendChild(modelGroup);

  const divider = document.createElement('hr');
  divider.className = 'my-3';
  form.appendChild(divider);

  // --- Language ---
  const langGroup = document.createElement('div');
  langGroup.className = 'mb-2';
  const langLabel = document.createElement('label');
  langLabel.className = 'form-label';
  langLabel.setAttribute('for', 'settings-lang');
  langLabel.textContent = t('settings.lang');
  const lang = document.createElement('select');
  lang.className = 'form-select';
  lang.id = 'settings-lang';
  for (const [code, label] of [
    ['en', 'English'],
    ['zh', '简体中文'],
  ]) {
    const opt = document.createElement('option');
    opt.value = code;
    opt.textContent = label;
    opt.selected = s.lang === code;
    lang.appendChild(opt);
  }
  langGroup.append(langLabel, lang);
  form.appendChild(langGroup);

  const divider2 = document.createElement('hr');
  divider2.className = 'my-3';
  form.appendChild(divider2);

  // --- Account ---
  const accountHeading = document.createElement('h6');
  accountHeading.className = 'mt-2';
  accountHeading.textContent = 'Account';
  form.appendChild(accountHeading);

  const pwGroup = document.createElement('div');
  pwGroup.className = 'mb-2';
  const pwLabel = document.createElement('label');
  pwLabel.className = 'form-label';
  pwLabel.setAttribute('for', 'settings-new-password');
  pwLabel.textContent = t('auth.newPassword');
  const pw = document.createElement('input');
  pw.type = 'password';
  pw.className = 'form-control';
  pw.id = 'settings-new-password';
  pw.autocomplete = 'new-password';
  pwGroup.append(pwLabel, pw);
  form.appendChild(pwGroup);

  const pwStatus = document.createElement('div');
  pwStatus.className = 'small text-danger d-none';
  form.appendChild(pwStatus);

  const changePw = document.createElement('button');
  changePw.type = 'button';
  changePw.id = 'settings-change-password';
  changePw.className = 'btn btn-outline-secondary btn-sm';
  changePw.textContent = t('auth.updatePassword');
  changePw.addEventListener('click', async () => {
    pwStatus.classList.add('d-none');
    if (pw.value.length < 8) {
      pwStatus.textContent = t('auth.passwordTooShort');
      pwStatus.classList.remove('d-none');
      return;
    }
    changePw.disabled = true;
    try {
      await updatePassword(pw.value);
      pw.value = '';
      pwStatus.className = 'small text-success';
      pwStatus.textContent = t('auth.passwordUpdated');
      pwStatus.classList.remove('d-none');
    } catch (err) {
      // Supabase requires a recently-authenticated session for password edits;
      // the recovery flow covers the stale-session case.
      pwStatus.textContent = `${err.message} — ${t('auth.forgot')}`;
      pwStatus.classList.remove('d-none');
    } finally {
      changePw.disabled = false;
    }
  });
  form.appendChild(changePw);

  body.appendChild(form);

  const status = document.createElement('div');
  status.className = 'text-success small d-none';
  footer.appendChild(status);

  const save = document.createElement('button');
  save.type = 'button';
  save.className = 'btn btn-primary';
  save.textContent = t('settings.save');
  save.addEventListener('click', () => {
    saveSettings({
      llmEnabled: enable.checked,
      llmKey: key.value,
      llmModel: model.value.trim() || DEFAULT_MODEL,
      lang: lang.value,
    });
    setLocale(lang.value);
    status.textContent = t('settings.saved');
    status.classList.remove('d-none');
    setTimeout(() => window.location.reload(), 400);
  });
  footer.appendChild(save);

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'btn btn-outline-secondary';
  cancel.textContent = t('settings.close');
  cancel.addEventListener('click', () => dialog.close());
  footer.appendChild(cancel);
}
