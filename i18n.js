/**
 * SpeedSense - i18n
 * chrome.i18n.getMessage() のラッパー。
 * 言語は Chrome / ブラウザの設定に従い _locales/ から自動選択される。
 */

function t(key) {
  return chrome.i18n.getMessage(key) || key;
}

function applyTranslations() {
  // data-i18n: textContent を置換
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const msg = t(el.dataset.i18n);
    if (msg) el.textContent = msg;
  });
  // data-i18n-title: title 属性を置換
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const msg = t(el.dataset.i18nTitle);
    if (msg) el.title = msg;
  });
}
