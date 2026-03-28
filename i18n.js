/**
 * SpeedSense - i18n
 * 翻訳辞書と applyTranslations() を提供する。popup.js より先に読み込む。
 */

const TRANSLATIONS = {
  ja: {
    'stat-saved-label':      '節約時間',
    'stat-speed-label':      '現在の速度',
    'unit-sec':              '秒',
    'unit-min':              '分',
    'unit-hour':             '時間',
    'unit-sec-suffix':       '秒',
    'status-detecting':      '動画を検出中...',
    'status-no-video':       '動画を開いてください',
    'status-disabled':       'SpeedSense が無効です',
    'status-skipping':       '無音スキップ中',
    'status-playing':        '音声検出中 — 通常再生',
    'section-speed':         '速度設定',
    'section-silence':       '無音検出',
    'section-overlay':       'オーバーレイ',
    'section-keyboard':      'キーボードショートカット',
    'label-normal-speed':    '通常速度',
    'label-normal-speed-sub':'音声あり時',
    'label-skip-speed':      'スキップ速度',
    'label-skip-speed-sub':  '無音時',
    'label-seek-sec':        'シーク秒数',
    'label-seek-sec-sub':    '巻き戻し/早送り',
    'label-speed-step':      '速度調整幅',
    'label-speed-step-sub':  'キー1回の変化量',
    'label-threshold':       'しきい値',
    'label-threshold-sub':   '音量検出感度',
    'label-delay':           '遅延',
    'label-delay-sub':       '判定までの時間',
    'label-spectrogram':     'スペクトラグラム',
    'label-spectrogram-sub': '周波数表示',
    'kb-speed-up':           '通常速度 +',
    'kb-speed-down':         '通常速度 −',
    'kb-toggle':             'ON/OFF 切替',
    'kb-toggle-sub':         'SpeedSense',
    'kb-threshold-up':       'しきい値 +',
    'kb-threshold-down':     'しきい値 −',
    'kb-reset-speed':        '速度リセット',
    'kb-reset-speed-sub':    '1.0x トグル',
    'kb-seek-back':          '巻き戻し',
    'kb-seek-back-sub':      '−N秒',
    'kb-seek-fwd':           '早送り',
    'kb-seek-fwd-sub':       '+N秒',
    'btn-support':           '♥ サポート',
    'btn-reset':             'リセット',
    'kb-clear-title':        '解除',
    'confirm-reset':         '節約時間の記録をリセットしますか？',
  },
  en: {
    'stat-saved-label':      'Time Saved',
    'stat-speed-label':      'Current Speed',
    'unit-sec':              'sec',
    'unit-min':              'min',
    'unit-hour':             'hr',
    'unit-sec-suffix':       'sec',
    'status-detecting':      'Detecting video...',
    'status-no-video':       'Open a video page',
    'status-disabled':       'SpeedSense is disabled',
    'status-skipping':       'Skipping silence',
    'status-playing':        'Audio detected — playing',
    'section-speed':         'Speed',
    'section-silence':       'Silence Detection',
    'section-overlay':       'Overlay',
    'section-keyboard':      'Keyboard Shortcuts',
    'label-normal-speed':    'Normal Speed',
    'label-normal-speed-sub':'with audio',
    'label-skip-speed':      'Skip Speed',
    'label-skip-speed-sub':  'silence',
    'label-seek-sec':        'Seek Seconds',
    'label-seek-sec-sub':    'back / forward',
    'label-speed-step':      'Speed Step',
    'label-speed-step-sub':  'per key press',
    'label-threshold':       'Threshold',
    'label-threshold-sub':   'volume sensitivity',
    'label-delay':           'Delay',
    'label-delay-sub':       'before silence',
    'label-spectrogram':     'Spectrogram',
    'label-spectrogram-sub': 'frequency view',
    'kb-speed-up':           'Speed +',
    'kb-speed-down':         'Speed −',
    'kb-toggle':             'Toggle ON/OFF',
    'kb-toggle-sub':         'SpeedSense',
    'kb-threshold-up':       'Threshold +',
    'kb-threshold-down':     'Threshold −',
    'kb-reset-speed':        'Speed Reset',
    'kb-reset-speed-sub':    '1.0x toggle',
    'kb-seek-back':          'Seek Back',
    'kb-seek-back-sub':      '−N sec',
    'kb-seek-fwd':           'Seek Fwd',
    'kb-seek-fwd-sub':       '+N sec',
    'btn-support':           '♥ Support',
    'btn-reset':             'Reset',
    'kb-clear-title':        'Clear',
    'confirm-reset':         'Reset saved time record?',
  },
};

// popup.js から参照・変更可能なグローバル変数
let currentLang = 'en';

function t(key) {
  return (TRANSLATIONS[currentLang] || TRANSLATIONS.ja)[key] ?? key;
}

function applyTranslations() {
  // data-i18n: textContent を丸ごと置換
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  // data-i18n-title: title 属性を置換
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  // lang ボタンのアクティブ状態を更新
  document.querySelectorAll('.lang-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.lang === currentLang);
  });
  document.documentElement.lang = currentLang;
}
