/**
 * SpeedSense - Popup Script
 */

// i18n.js より先にロードされることを前提に applyTranslations() を即時実行
applyTranslations();

// ========== DOM 参照 ==========
const toggleEnabled    = document.getElementById('toggle-enabled');
const toggleLabel      = document.getElementById('toggle-label');
const statSaved        = document.getElementById('stat-saved');
const statSavedUnit    = document.getElementById('stat-saved-unit');
const statSpeed        = document.getElementById('stat-speed');
const statusDot        = document.getElementById('status-dot');
const statusText       = document.getElementById('status-text');
const normalSpeedEl    = document.getElementById('normal-speed');
const normalSpeedVal   = document.getElementById('normal-speed-val');
const silenceSpeedEl   = document.getElementById('silence-speed');
const silenceSpeedVal  = document.getElementById('silence-speed-val');
const silenceThreshEl  = document.getElementById('silence-threshold');
const silenceThreshVal = document.getElementById('silence-threshold-val');
const silenceDelayEl   = document.getElementById('silence-delay');
const silenceDelayVal  = document.getElementById('silence-delay-val');
const seekSecondsEl      = document.getElementById('seek-seconds');
const seekSecondsVal     = document.getElementById('seek-seconds-val');
const normalSpeedStepEl  = document.getElementById('normal-speed-step');
const normalSpeedStepVal = document.getElementById('normal-speed-step-val');
const showSpectrogramEl         = document.getElementById('show-spectrogram');
const showOverlayOnSpeedResetEl = document.getElementById('show-overlay-on-speed-reset');
const btnReset   = document.getElementById('btn-reset');
const btnSupport = document.getElementById('btn-support');
const volFill      = document.getElementById('vol-fill');
const volThreshold = document.getElementById('vol-threshold');
const kbKeys   = document.querySelectorAll('.kb-key');
const kbClears = document.querySelectorAll('.kb-clear');

// ========== ドメイン別設定キー ==========
let settingsKey    = 'smartSpeedSettings_unknown';
let keybindingsKey = 'smartSpeedKeybindings_unknown';

// ========== キーバインディング ==========
const DEFAULT_KEYBINDINGS = {
  normalSpeedUp:    { key: 'ArrowUp',    ctrl: false, alt: true, shift: false },
  normalSpeedDown:  { key: 'ArrowDown',  ctrl: false, alt: true, shift: false },
  toggleEnabled:    { key: 'KeyS',       ctrl: false, alt: true, shift: false },
  thresholdUp:      { key: 'ArrowRight', ctrl: false, alt: true, shift: false },
  thresholdDown:    { key: 'ArrowLeft',  ctrl: false, alt: true, shift: false },
  toggleSpeedReset: { key: 'KeyR',       ctrl: false, alt: true, shift: false },
  seekBackward:     null,
  seekForward:      null,
};
let keybindings = JSON.parse(JSON.stringify(DEFAULT_KEYBINDINGS));
let capturingAction = null;

// ========== 初期化 ==========
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]?.url) {
    try {
      const host  = new URL(tabs[0].url).hostname.split('.');
      const domain = host.length > 2 ? host.slice(-2).join('.') : host.join('.');
      settingsKey    = 'smartSpeedSettings_'    + domain;
      keybindingsKey = 'smartSpeedKeybindings_' + domain;
    } catch (_) {}
  }

  chrome.storage.local.get(
    [settingsKey, 'smartSpeedSettings', keybindingsKey, 'smartSpeedKeybindings', 'totalSavedSeconds'],
    (result) => {
      // 旧キーからドメイン別キーへ移行
      if (!result[settingsKey] && result['smartSpeedSettings']) {
        chrome.storage.local.set({ [settingsKey]: result['smartSpeedSettings'] });
      }
      if (!result[keybindingsKey] && result['smartSpeedKeybindings']) {
        chrome.storage.local.set({ [keybindingsKey]: result['smartSpeedKeybindings'] });
      }
      const s = result[settingsKey] || result['smartSpeedSettings'] || {};
      const saved = result.totalSavedSeconds || 0;

      applySettings({
        enabled:                s.enabled                !== undefined ? s.enabled                : true,
        normalSpeed:            s.normalSpeed            !== undefined ? s.normalSpeed            : 1.0,
        silenceSpeed:           s.silenceSpeed           !== undefined ? s.silenceSpeed           : 3.0,
        silenceThreshold:       s.silenceThreshold       !== undefined ? s.silenceThreshold       : 0.015,
        silenceDelay:           s.silenceDelay           !== undefined ? s.silenceDelay           : 250,
        seekSeconds:            s.seekSeconds            !== undefined ? s.seekSeconds            : 10,
        normalSpeedStep:        s.normalSpeedStep        !== undefined ? s.normalSpeedStep        : 0.05,
        showSpectrogram:        s.showSpectrogram        !== undefined ? s.showSpectrogram        : false,
        showOverlayOnSpeedReset: s.showOverlayOnSpeedReset !== undefined ? s.showOverlayOnSpeedReset : true,
      });

      const savedKb = result[keybindingsKey] || result['smartSpeedKeybindings'];
      if (savedKb) {
        keybindings = { ...DEFAULT_KEYBINDINGS, ...savedKb };
      }
      renderKeybindings();
      updateSavedDisplay(saved);
      startPolling();
    }
  );
});

// ========== 設定 UI への反映 ==========
function applySettings(s) {
  toggleEnabled.checked = s.enabled;
  toggleLabel.textContent = s.enabled ? 'ON' : 'OFF';
  document.body.classList.toggle('disabled', !s.enabled);

  normalSpeedEl.value        = s.normalSpeed;
  normalSpeedVal.textContent = s.normalSpeed.toFixed(2);

  silenceSpeedEl.value        = s.silenceSpeed;
  silenceSpeedVal.textContent = s.silenceSpeed.toFixed(1);

  silenceThreshEl.value        = s.silenceThreshold;
  silenceThreshVal.textContent = (s.silenceThreshold * 100).toFixed(1);

  silenceDelayEl.value        = s.silenceDelay;
  silenceDelayVal.textContent = s.silenceDelay;

  seekSecondsEl.value        = s.seekSeconds;
  seekSecondsVal.textContent = s.seekSeconds;

  showSpectrogramEl.checked         = !!s.showSpectrogram;
  showOverlayOnSpeedResetEl.checked = s.showOverlayOnSpeedReset !== false;

  const step = s.normalSpeedStep ?? 0.05;
  normalSpeedStepEl.value        = step;
  normalSpeedStepVal.textContent = step.toFixed(2);
  const stepStr = step.toFixed(2);
  document.getElementById('kb-step-up-label').textContent   = '+' + stepStr + 'x';
  document.getElementById('kb-step-down-label').textContent = '−' + stepStr + 'x';
}

// ========== 設定保存 ==========
function saveSettings() {
  chrome.storage.local.set({
    [settingsKey]: {
      enabled:                toggleEnabled.checked,
      normalSpeed:            parseFloat(normalSpeedEl.value),
      silenceSpeed:           parseFloat(silenceSpeedEl.value),
      silenceThreshold:       parseFloat(silenceThreshEl.value),
      silenceDelay:           parseInt(silenceDelayEl.value, 10),
      seekSeconds:            parseInt(seekSecondsEl.value, 10),
      normalSpeedStep:        parseFloat(normalSpeedStepEl.value),
      showSpectrogram:        showSpectrogramEl.checked,
      showOverlayOnSpeedReset: showOverlayOnSpeedResetEl.checked,
    },
  });
}

// ========== キーバインド: 保存・表示 ==========
function saveKeybindings() {
  chrome.storage.local.set({ [keybindingsKey]: keybindings });
}

function formatKeyBinding(binding) {
  if (!binding || !binding.key) return '—';
  const parts = [];
  if (binding.ctrl)  parts.push('Ctrl');
  if (binding.alt)   parts.push('Alt');
  if (binding.shift) parts.push('Shift');
  const keyMap = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    Space: 'Space', Escape: 'Esc', Enter: 'Enter', Backspace: 'BS', Tab: 'Tab',
  };
  let k = keyMap[binding.key];
  if (!k) {
    if (/^Key([A-Z])$/.test(binding.key))     k = binding.key.slice(3);
    else if (/^Digit(\d)$/.test(binding.key)) k = binding.key.slice(5);
    else k = binding.key;
  }
  parts.push(k);
  return parts.join('+');
}

function renderKeybindings() {
  kbKeys.forEach((el) => {
    const binding = keybindings[el.dataset.action];
    el.textContent = formatKeyBinding(binding);
    el.classList.toggle('has-key', !!binding);
    el.classList.remove('capturing');
  });
}

// ========== イベント: トグル ==========
toggleEnabled.addEventListener('change', () => {
  const en = toggleEnabled.checked;
  toggleLabel.textContent = en ? 'ON' : 'OFF';
  document.body.classList.toggle('disabled', !en);
  saveSettings();
});

// ========== イベント: スライダー ==========
normalSpeedEl.addEventListener('input', () => {
  normalSpeedVal.textContent = parseFloat(normalSpeedEl.value).toFixed(2);
  saveSettings();
});

silenceSpeedEl.addEventListener('input', () => {
  silenceSpeedVal.textContent = parseFloat(silenceSpeedEl.value).toFixed(1);
  saveSettings();
});

silenceThreshEl.addEventListener('input', () => {
  silenceThreshVal.textContent = (parseFloat(silenceThreshEl.value) * 100).toFixed(1);
  volThreshold.style.left = Math.min(100, parseFloat(silenceThreshEl.value) * 100 / 0.08) + '%';
  saveSettings();
});

silenceDelayEl.addEventListener('input', () => {
  silenceDelayVal.textContent = silenceDelayEl.value;
  saveSettings();
});

seekSecondsEl.addEventListener('input', () => {
  seekSecondsVal.textContent = seekSecondsEl.value;
  saveSettings();
});

normalSpeedStepEl.addEventListener('input', () => {
  const v = parseFloat(normalSpeedStepEl.value).toFixed(2);
  normalSpeedStepVal.textContent = v;
  document.getElementById('kb-step-up-label').textContent   = '+' + v + 'x';
  document.getElementById('kb-step-down-label').textContent = '−' + v + 'x';
  saveSettings();
});

showSpectrogramEl.addEventListener('change', () => {
  saveSettings();
});

showOverlayOnSpeedResetEl.addEventListener('change', () => {
  saveSettings();
});

// ========== ボタン: サポート ==========
btnSupport.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://ko-fi.com/echos0507' });
});

// ========== ボタン: 節約時間リセット ==========
btnReset.addEventListener('click', () => {
  if (!confirm(t('confirmReset'))) return;
  sendToContent({ type: 'resetSavedTime' }, () => updateSavedDisplay(0));
  chrome.storage.local.set({ totalSavedSeconds: 0 });
});

// ========== 節約時間の表示フォーマット ==========
function updateSavedDisplay(seconds) {
  seconds = Math.max(0, seconds);
  if (seconds < 60) {
    statSaved.textContent     = Math.round(seconds);
    statSavedUnit.textContent = t('unitSec');
  } else if (seconds < 3600) {
    statSaved.textContent     = (seconds / 60).toFixed(1);
    statSavedUnit.textContent = t('unitMin');
  } else {
    statSaved.textContent     = (seconds / 3600).toFixed(2);
    statSavedUnit.textContent = t('unitHour');
  }
}

// ========== コンテンツスクリプトへの送信 ==========
function sendToContent(msg, cb) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs[0]) return;
    chrome.tabs.sendMessage(tabs[0].id, msg, (res) => {
      if (chrome.runtime.lastError) return;
      if (cb) cb(res);
    });
  });
}

// ========== ステータスポーリング ==========
function startPolling() {
  poll();
  setInterval(poll, 800);
}

function poll() {
  sendToContent({ type: 'getStatus' }, (res) => {
    if (!res) {
      statusDot.className    = 'dot';
      statusText.textContent = t('statusNoVideo');
      statSpeed.innerHTML    = '—';
      volFill.style.width    = '0%';
      return;
    }

    updateSavedDisplay(res.totalSavedSeconds || 0);

    const spd = res.currentSpeed ? res.currentSpeed.toFixed(1) : '—';
    statSpeed.innerHTML = `${spd}<span style="font-size:11px">x</span>`;

    if (!res.enabled) {
      statusDot.className    = 'dot';
      statusText.textContent = t('statusDisabled');
    } else if (res.isSilent) {
      statusDot.className    = 'dot skipping';
      statusText.textContent = `${t('statusSkipping')} (${res.currentSpeed?.toFixed(1) ?? '—'}x)`;
    } else {
      statusDot.className    = 'dot active';
      statusText.textContent = t('statusPlaying');
    }

    volFill.style.width = Math.min(100, (res.currentVolume || 0) * 100 / 0.08) + '%';
    volFill.className   = 'vol-meter-fill' + (res.isSilent ? ' skipping' : '');

    volThreshold.style.left = Math.min(100, parseFloat(silenceThreshEl.value) * 100 / 0.08) + '%';
  });
}

// ========== キーバインド キャプチャ ==========
kbKeys.forEach((el) => {
  el.addEventListener('click', () => {
    if (capturingAction) cancelCapture();
    capturingAction = el.dataset.action;
    el.textContent = '…';
    el.classList.add('capturing');
  });
});

kbClears.forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.action;
    keybindings[action] = null;
    saveKeybindings();
    renderKeybindings();
    if (capturingAction === action) capturingAction = null;
  });
});

document.addEventListener('keydown', (e) => {
  if (!capturingAction) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.code === 'Escape') { cancelCapture(); return; }
  if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
  keybindings[capturingAction] = { key: e.code, ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey };
  saveKeybindings();
  capturingAction = null;
  renderKeybindings();
});

function cancelCapture() {
  if (!capturingAction) return;
  kbKeys.forEach((el) => {
    if (el.dataset.action === capturingAction) {
      el.textContent = formatKeyBinding(keybindings[capturingAction]);
      el.classList.remove('capturing');
    }
  });
  capturingAction = null;
}
