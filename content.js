/**
 * SpeedSense - Content Script
 * 無音区間を自動検出して高速スキップする。<video> 要素を持つ全サイトで動作。
 */

(function () {
  'use strict';

  // ドメイン別設定キー（サブドメインを除く）
  const _host = location.hostname.split('.');
  const _domain = _host.length > 2 ? _host.slice(-2).join('.') : _host.join('.');
  const SETTINGS_KEY    = 'smartSpeedSettings_'    + _domain;
  const KEYBINDINGS_KEY = 'smartSpeedKeybindings_' + _domain;

  // ========== 状態管理 ==========
  let audioContext    = null;
  let analyser        = null;
  let dataArray       = null;  // 周波数域データ（音量計算用）
  let animFrameId     = null;
  let isSilent        = false;
  let silenceTimer    = null;
  let silenceStartTime = null;
  let totalSavedSeconds = 0;
  let currentVideoEl    = null;
  let isInitialized     = false;
  let currentAudioTracks  = null;  // muted 状態チェック用のトラック参照
  let usingCaptureStream  = true;  // false = createMediaElementSource フォールバック中
  let drmDetected         = false; // DRM コンテンツ検出済み（音声解析不可）

  let settings = {
    enabled:          true,
    normalSpeed:      1.0,
    silenceSpeed:     3.0,
    silenceThreshold: 0.015,
    silenceDelay:     250,
    seekSeconds:      10,
    normalSpeedStep:  0.05,
    showSpectrogram:        false,
    showOverlayOnSpeedReset: true,
  };

  let keybindings = {
    normalSpeedUp:    { key: 'ArrowUp',    ctrl: false, alt: true, shift: false },
    normalSpeedDown:  { key: 'ArrowDown',  ctrl: false, alt: true, shift: false },
    toggleEnabled:    { key: 'KeyS',       ctrl: false, alt: true, shift: false },
    thresholdUp:      { key: 'ArrowRight', ctrl: false, alt: true, shift: false },
    thresholdDown:    { key: 'ArrowLeft',  ctrl: false, alt: true, shift: false },
    toggleSpeedReset: { key: 'KeyR',       ctrl: false, alt: true, shift: false },
    seekBackward:     null,
    seekForward:      null,
  };

  // isSpeedReset はタブリロードで自動解除される一時フラグ
  let isSpeedReset = false;

  // setupAudio リトライ制御
  let setupAudioNextRetry = 0;

  // encrypted イベントハンドラ（DRM コンテンツ早期検出用）
  function onVideoEncrypted() {
    if (setupAudioNextRetry > performance.now()) return;
    console.warn('[SmartSpeed] DRM content detected (encrypted event), audio analysis disabled.');
    drmDetected        = true;
    isInitialized      = false;
    usingCaptureStream = false;
    setupAudioNextRetry = performance.now() + 30000;
  }

  // seeking/seeked イベントハンドラ（stale captureStream 再接続用）
  function onVideoSeeking() {
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
  }
  function onVideoSeeked() {
    // createMediaElementSource は動画要素に常時接続済みのためシーク後も有効
    // captureStream のみ stale になるため、そちらだけ再接続する
    if (!usingCaptureStream) return;
    console.warn('[SmartSpeed] seeked detected, reconnecting audio stream...');
    resetAudio();
  }

  // Netflix 等が video インスタンスの playbackRate を上書きしてもプロトタイプ経由でセットする
  const _nativePlaybackRateDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'playbackRate');
  const _nativeSetPlaybackRate  = _nativePlaybackRateDesc?.set;
  const _nativeGetPlaybackRate  = _nativePlaybackRateDesc?.get;
  function setPlaybackRate(video, rate) {
    if (_nativeSetPlaybackRate) {
      _nativeSetPlaybackRate.call(video, rate);
    } else {
      video.playbackRate = rate;
    }
  }
  function getPlaybackRate(video) {
    return _nativeGetPlaybackRate ? _nativeGetPlaybackRate.call(video) : video.playbackRate;
  }

  // 速度ランプ（線形補間）
  let speedRampFrom     = null;
  let speedRampTo       = null;
  let speedRampStart    = null;
  let speedRampDuration = 400;
  const SPEED_RAMP_MS_ENTER = 400;  // 無音に入るときのランプ時間
  const SPEED_RAMP_MS_EXIT  = 120;  // 無音から出るときのランプ時間（頭切れ低減）

  // ライブ配信制御
  const LIVE_EDGE_THRESHOLD_SEC = 60;   // 汎用ライブストリーム用: seekable.end との差がこの秒数以内ならライブエッジ
  let isLiveLocked = false;             // 現在ライブエッジにいるか（速度ロック中か）

  // 音量履歴リングバッファ（先読みトレンド検出用）
  const VOLUME_HISTORY_SIZE = 30;  // ~500ms @60fps
  const volumeHistory = new Float32Array(VOLUME_HISTORY_SIZE);
  let volumeHistoryIdx = 0;

  // ========== 初期化 ==========
  chrome.storage.local.get([SETTINGS_KEY, 'smartSpeedSettings', KEYBINDINGS_KEY, 'smartSpeedKeybindings', 'totalSavedSeconds'], (result) => {
    const savedSettings = result[SETTINGS_KEY] || result['smartSpeedSettings'];
    if (savedSettings) {
      settings = { ...settings, ...savedSettings };
      if (!result[SETTINGS_KEY] && result['smartSpeedSettings']) {
        chrome.storage.local.set({ [SETTINGS_KEY]: savedSettings });
      }
    }
    const savedKeybindings = result[KEYBINDINGS_KEY] || result['smartSpeedKeybindings'];
    if (savedKeybindings) {
      keybindings = { ...keybindings, ...savedKeybindings };
      if (!result[KEYBINDINGS_KEY] && result['smartSpeedKeybindings']) {
        chrome.storage.local.set({ [KEYBINDINGS_KEY]: savedKeybindings });
      }
    }
    if (result.totalSavedSeconds) totalSavedSeconds = result.totalSavedSeconds;
    document.addEventListener('keydown', handleKeydown, true);
    startObserver();
    scheduleLoop();
  });

  // ========== メインループ ==========
  function scheduleLoop() {
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = requestAnimationFrame(mainLoop);
  }

  function mainLoop() {
    animFrameId = requestAnimationFrame(mainLoop);

    const video = getVideo();
    if (!video) return;

    if (video !== currentVideoEl) {
      if (currentVideoEl) {
        currentVideoEl.removeEventListener('seeking',   onVideoSeeking);
        currentVideoEl.removeEventListener('seeked',    onVideoSeeked);
        currentVideoEl.removeEventListener('encrypted', onVideoEncrypted);
      }
      resetAudio();
      currentVideoEl = video;
      setPlaybackRate(video, settings.normalSpeed);
      video.addEventListener('seeking',   onVideoSeeking);
      video.addEventListener('seeked',    onVideoSeeked);
      video.addEventListener('encrypted', onVideoEncrypted);
    }

    // オーバーレイは常に更新（一時停止・無効時も設定変更を即時反映）
    const now = performance.now();
    if (now - lastIndicatorMs > 16) {
      lastIndicatorMs = now;
      updateIndicator(video);
    }

    if (video.paused || video.ended) {
      if (isSilent) endSilence(video);
      return;
    }

    if (!audioContext || audioContext.state === 'closed') {
      if (!drmDetected) {
        setupAudio(video);
        return;  // 音声セットアップ待ち
      }
      // DRM: audioContext は作れないが速度制御は継続
    }

    if (audioContext && audioContext.state === 'suspended') {
      audioContext.resume();
      return;
    }

    if (!settings.enabled) {
      if (isSilent) endSilence(video);
      return;
    }

    if (isSpeedReset) {
      if (Math.abs(getPlaybackRate(video) - 1.0) > 0.005) setPlaybackRate(video, 1.0);
      return;
    }

    // ライブ配信のライブエッジ中は速度を 1.0x に固定
    isLiveLocked = checkLiveEdge(video);
    if (isLiveLocked) {
      if (isSilent) endSilence(video);
      cancelSpeedRamp();
      if (Math.abs(getPlaybackRate(video) - 1.0) > 0.005) setPlaybackRate(video, 1.0);
      return;
    }

    currentVolume = getVolume();
    if (!drmDetected) {
      processSilence(video, currentVolume);
    }
    applySpeedRamp(video, now);
  }

  // ========== 音声セットアップ ==========
  function setupAudio(video) {
    if (isInitialized) return;
    const now = performance.now();
    if (now < setupAudioNextRetry) return;
    isInitialized = true;

    try {
      // DRM コンテンツ（MediaKeys 設定済み）は captureStream が無音データを返すため解析不可
      if (video.mediaKeys) {
        console.warn('[SmartSpeed] DRM content detected (mediaKeys), audio analysis disabled.');
        drmDetected        = true;
        isInitialized      = false;
        usingCaptureStream = false;
        setupAudioNextRetry = now + 30000;
        return;
      }

      audioContext = new AudioContext();
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.6;

      let source;
      try {
        // captureStream() で YouTube の CORS 制限を回避する
        const stream = video.captureStream();
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
          // 音声トラックがまだ存在しない（読み込み中）→ 500ms 後にリトライ
          audioContext.close();
          audioContext  = null;
          isInitialized = false;
          setupAudioNextRetry = now + 500;
          return;
        }
        // MSE のセグメント切り替え時に音声トラックが無効化されたら再初期化
        audioTracks.forEach(track => {
          track.addEventListener('ended', () => {
            log('audio track ended (MSE switch), reinitializing...');
            resetAudio();
          });
          // unmute 時に再接続（品質切り替え完了後に新しいトラックで再初期化）
          track.addEventListener('unmute', () => {
            log('audio track unmuted, reinitializing...');
            resetAudio();
          });
        });
        currentAudioTracks = audioTracks;
        source = audioContext.createMediaStreamSource(new MediaStream(audioTracks));
        usingCaptureStream = true;
      } catch (e) {
        // captureStream 自体が失敗した場合のみ createMediaElementSource にフォールバック
        // （EME/DRM 動画など）
        try {
          source = audioContext.createMediaElementSource(video);
          source.connect(audioContext.destination);
          usingCaptureStream = false;
        } catch (e2) {
          // DRM コンテンツは両方のメソッドがブロックされる → 音声解析を無効化
          console.warn('[SmartSpeed] DRM content detected, audio analysis disabled on this page.');
          audioContext.close();
          audioContext       = null;
          drmDetected        = true;
          isInitialized      = false;
          usingCaptureStream = false; // seeked ハンドラの再トリガーを防ぐ
          // 30秒後まで再試行しない（ページ遷移やリロードで再挑戦）
          setupAudioNextRetry = performance.now() + 30000;
          return;
        }
      }

      source.connect(analyser);
      dataArray = new Uint8Array(analyser.frequencyBinCount);

    } catch (err) {
      console.error('[SmartSpeed] Audio setup error:', err);
      if (audioContext) { try { audioContext.close(); } catch (_) {} }
      audioContext        = null;
      isInitialized       = false;
      setupAudioNextRetry = performance.now() + 1000;
    }
  }

  function resetAudio() {
    // silenceSpeed のまま固着するのを防ぐ
    if (isSilent && currentVideoEl) {
      setPlaybackRate(currentVideoEl, settings.normalSpeed);
    }
    if (audioContext) {
      try { audioContext.close(); } catch (_) {}
    }
    audioContext       = null;
    analyser           = null;
    dataArray          = null;
    currentAudioTracks = null;
    usingCaptureStream = true;
    drmDetected        = false;
    isSilent           = false;
    silenceTimer && clearTimeout(silenceTimer);
    silenceTimer     = null;
    silenceStartTime = null;
    isInitialized       = false;
    isSpeedReset        = false;
    setupAudioNextRetry = 0;
    volumeHistoryIdx    = 0;
    volumeHistory.fill(0);
    cancelSpeedRamp();
    if (overlayEl) overlayEl.style.opacity = '0';
  }

  // ========== 速度ランプ ==========
  function setTargetSpeed(video, target, rampMs = SPEED_RAMP_MS_ENTER) {
    if (speedRampTo === target) return;
    speedRampFrom     = video.playbackRate;
    speedRampTo       = target;
    speedRampStart    = performance.now();
    speedRampDuration = rampMs;
  }

  function cancelSpeedRamp() {
    speedRampFrom  = null;
    speedRampTo    = null;
    speedRampStart = null;
  }

  /**
   * ライブ配信かつライブエッジにいるか判定する。
   *
   * YouTube の場合:
   *   .ytp-live-badge[disabled] → ライブエッジ（1.0x 固定）
   *   .ytp-live-badge が disabled なし → タイムシフト再生中（速度制御有効）
   *
   * 汎用ライブストリーム（duration === Infinity）:
   *   seekable.end() - currentTime <= LIVE_EDGE_THRESHOLD_SEC でライブエッジ判定
   */
  function checkLiveEdge(video) {
    // YouTube ライブ: .ytp-live-badge の disabled 属性で判定
    const liveBadge = document.querySelector('.ytp-live-badge');
    if (liveBadge) return liveBadge.hasAttribute('disabled');

    // 汎用ライブストリーム（duration === Infinity）
    if (video.duration !== Infinity) return false;
    if (video.seekable.length === 0) return true;
    const liveEnd = video.seekable.end(video.seekable.length - 1);
    return (liveEnd - video.currentTime) <= LIVE_EDGE_THRESHOLD_SEC;
  }

  function applySpeedRamp(video, now) {
    if (speedRampTo === null) {
      // 定常時：バッファリング中は強制しない（Netflix の ABR を妨げない）
      if (video.readyState < 3) return;
      // 実際にズレているときだけ再設定（不要な ratechange を防ぐ）
      const target  = isSilent ? settings.silenceSpeed : settings.normalSpeed;
      const current = getPlaybackRate(video);
      if (Math.abs(current - target) > 0.005) {
        setPlaybackRate(video, target);
      }
      return;
    }
    // DRM コンテンツはランプをスキップして即時適用（ratechange を1回に抑える）
    if (drmDetected) {
      setPlaybackRate(video, speedRampTo);
      cancelSpeedRamp();
      return;
    }
    const t = Math.min(1, (now - speedRampStart) / speedRampDuration);
    setPlaybackRate(video, speedRampFrom + (speedRampTo - speedRampFrom) * t);
    if (t >= 1) cancelSpeedRamp();
  }

  // ========== 音量取得 ==========
  function getVolume() {
    if (!analyser || !dataArray) return 1;
    analyser.getByteFrequencyData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) sum += dataArray[i];
    const vol = sum / dataArray.length / 255;
    volumeHistory[volumeHistoryIdx % VOLUME_HISTORY_SIZE] = vol;
    volumeHistoryIdx++;
    return vol;
  }

  // 直近 N フレームの音量上昇量を返す（無音区間からの早期脱出判定に使用）
  const TREND_WINDOW = 10;  // ~167ms @60fps
  function getVolumeTrend() {
    if (volumeHistoryIdx < TREND_WINDOW * 2) return 0;
    let recentSum = 0, olderSum = 0;
    for (let i = 0; i < TREND_WINDOW; i++) {
      recentSum += volumeHistory[(volumeHistoryIdx - 1 - i                     + VOLUME_HISTORY_SIZE) % VOLUME_HISTORY_SIZE];
      olderSum  += volumeHistory[(volumeHistoryIdx - 1 - i - TREND_WINDOW + VOLUME_HISTORY_SIZE) % VOLUME_HISTORY_SIZE];
    }
    return (recentSum - olderSum) / TREND_WINDOW;
  }

  // ========== 無音処理 ==========
  function processSilence(video, volume) {
    // バッファリング中（HAVE_FUTURE_DATA 未満）は誤検出を防ぐ
    if (video.readyState < 3) {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
      return;
    }
    // MSE 品質切り替え等でトラックが mute 中は誤検出を防ぐ
    if (currentAudioTracks && currentAudioTracks.some(t => t.muted)) {
      if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
      return;
    }
    if (volume < settings.silenceThreshold) {
      if (!isSilent && !silenceTimer) {
        silenceTimer = setTimeout(() => {
          silenceTimer = null;
          if (!isSilent) {
            isSilent = true;
            silenceStartTime = performance.now();
            setTargetSpeed(video, settings.silenceSpeed, SPEED_RAMP_MS_ENTER);
            notifyBackground({ type: 'silenceStart' });
          }
        }, settings.silenceDelay);
      }

      // 無音中に音量が上昇トレンドを示していれば早期減速開始
      if (isSilent && getVolumeTrend() > 0.003) {
        console.log('[SmartSpeed] volume rising trend detected, pre-decelerating');
        endSilence(video);
      }
    } else {
      if (silenceTimer) {
        clearTimeout(silenceTimer);
        silenceTimer = null;
      }
      if (isSilent) endSilence(video);
    }
  }

  function endSilence(video) {
    if (!isSilent) return;
    isSilent = false;

    if (silenceStartTime !== null) {
      const realSilenceSec = (performance.now() - silenceStartTime) / 1000;
      const saved = (settings.silenceSpeed / settings.normalSpeed - 1) * realSilenceSec;
      totalSavedSeconds += saved;
      chrome.storage.local.set({ totalSavedSeconds: Math.round(totalSavedSeconds * 10) / 10 });
      silenceStartTime = null;
      notifyBackground({ type: 'silenceEnd', totalSavedSeconds });
    }

    setTargetSpeed(video, settings.normalSpeed, SPEED_RAMP_MS_EXIT);
  }

  // ========== 動画要素の取得 ==========
  function getVideo() {
    const videos = Array.from(document.querySelectorAll('video'));
    return videos.find(v => !v.paused && !v.ended) || videos[0] || null;
  }

  // ========== 速度オーバーレイ ==========
  let overlayEl       = null;
  let overlayDragState = null;
  let overlayPos      = { left: null, top: null };
  let currentVolume   = 0;
  let lastIndicatorMs = 0;

  function injectOverlayStyles() {
    if (document.getElementById('__ss_overlay_styles__')) return;
    const style = document.createElement('style');
    style.id = '__ss_overlay_styles__';
    style.textContent = [
      '#__smart_speed_overlay__{',
        'position:fixed;z-index:2147483647;',
        'background:rgba(0,0,0,0.65);',
        "font-family:'DM Mono','Courier New',monospace;",
        'pointer-events:auto;cursor:grab;user-select:none;',
        'opacity:0;border-radius:8px;width:auto;',
        'padding:6px 10px 8px;transition:opacity 0.2s ease;',
      '}',
      '#__smart_speed_overlay__.ss-dragging{cursor:grabbing;transition:none;}',
      '#__smart_speed_overlay__ .ss-row{display:flex;align-items:center;gap:6px;margin-bottom:5px;}',
      '#__smart_speed_overlay__ .ss-icon{font-size:12px;}',
      '#__smart_speed_overlay__ .ss-speed{font-size:18px;font-weight:600;letter-spacing:-0.5px;line-height:1;}',
      '#__smart_speed_overlay__ .ss-wave{display:block;height:auto;}',
    ].join('');
    document.head.appendChild(style);
  }

  // フルスクリーン時はその要素内に、通常時は document.body に追加する
  function overlayParent() {
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (!fsEl) return document.body;
    return fsEl.tagName === 'VIDEO' ? (fsEl.parentElement || document.body) : fsEl;
  }

  function getOrCreateOverlay() {
    if (overlayEl && overlayEl.isConnected) return overlayEl;

    injectOverlayStyles();

    overlayEl = document.createElement('div');
    overlayEl.id = '__smart_speed_overlay__';
    overlayEl.innerHTML =
      '<div class="ss-row">' +
        '<span class="ss-icon">\u25b6</span>' +
        '<span class="ss-speed">1.0\u00d7</span>' +
      '</div>' +
      '<canvas class="ss-wave" width="140" height="29"></canvas>';

    overlayEl.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const rect = overlayEl.getBoundingClientRect();
      overlayDragState = {
        startX: e.clientX,
        startY: e.clientY,
        origLeft: rect.left,
        origTop:  rect.top,
      };
      overlayEl.classList.add('ss-dragging');
    });

    document.addEventListener('mousemove', (e) => {
      if (!overlayDragState) return;
      const rawLeft = overlayDragState.origLeft + (e.clientX - overlayDragState.startX);
      const rawTop  = overlayDragState.origTop  + (e.clientY - overlayDragState.startY);
      const vid = getVideo();
      if (vid) {
        const vr = vid.getBoundingClientRect();
        const ow = overlayEl.offsetWidth;
        const oh = overlayEl.offsetHeight;
        overlayPos.left = Math.max(vr.left, Math.min(rawLeft, vr.right  - ow));
        overlayPos.top  = Math.max(vr.top,  Math.min(rawTop,  vr.bottom - oh));
      } else {
        overlayPos.left = rawLeft;
        overlayPos.top  = rawTop;
      }
      overlayEl.style.left   = overlayPos.left + 'px';
      overlayEl.style.top    = overlayPos.top  + 'px';
      overlayEl.style.right  = 'auto';
      overlayEl.style.bottom = 'auto';
    });

    document.addEventListener('mouseup', () => {
      if (!overlayDragState) return;
      overlayDragState = null;
      overlayEl.classList.remove('ss-dragging');
    });

    overlayParent().appendChild(overlayEl);
    return overlayEl;
  }

  function updateIndicator(video) {
    const el = getOrCreateOverlay();

    // 初回配置: 動画の左上付近
    if (overlayPos.left === null) {
      const rect = video.getBoundingClientRect();
      overlayPos.left = rect.left + 12;
      overlayPos.top  = rect.top  + 12;
    }

    // ビデオ枠内にクランプ（毎フレーム、リサイズ・スクロールに追従）
    const vr = video.getBoundingClientRect();
    const ow = el.offsetWidth  || 80;
    const oh = el.offsetHeight || 40;
    overlayPos.left = Math.max(vr.left, Math.min(overlayPos.left, vr.right  - ow));
    overlayPos.top  = Math.max(vr.top,  Math.min(overlayPos.top,  vr.bottom - oh));
    el.style.left   = overlayPos.left + 'px';
    el.style.top    = overlayPos.top  + 'px';
    el.style.right  = 'auto';
    el.style.bottom = 'auto';

    // SpeedSense が OFF の場合はオーバーレイを非表示
    if (!settings.enabled) {
      el.style.opacity = '0';
      return;
    }

    // 速度リセット中かつ非表示設定の場合もオーバーレイを非表示
    if (isSpeedReset && !settings.showOverlayOnSpeedReset) {
      el.style.opacity = '0';
      return;
    }

    const color = isSpeedReset ? 'rgba(255,255,255,0.55)'
                : isSilent     ? '#0077ff'
                :                '#00e5a0';

    const icon = isSpeedReset ? '\u23f8'   // ⏸
               : isSilent     ? '\u23e9'   // ⏩
               :                '\u25b6';  // ▶

    const speed = video.playbackRate;
    const speedText = speed.toFixed(2) + '\u00d7';

    el.querySelector('.ss-icon').textContent  = icon;
    el.querySelector('.ss-icon').style.color  = color;
    el.querySelector('.ss-speed').textContent = speedText;
    el.querySelector('.ss-speed').style.color = color;

    const canvas = el.querySelector('.ss-wave');
    if (canvas) drawSpectrogram(canvas);

    el.style.opacity = '1';
  }

  // ========== スペクトラグラム ==========
  const SPEC_H = 29;

  function drawSpectrogram(canvas) {
    if (!settings.showSpectrogram) {
      canvas.style.display = 'none';
      return;
    }
    canvas.style.display = '';
    if (canvas.height !== SPEC_H) canvas.height = SPEC_H;

    const ctx = canvas.getContext('2d');
    const W = canvas.width;

    ctx.drawImage(canvas, -1, 0);
    ctx.clearRect(W - 1, 0, 1, SPEC_H);

    if (dataArray && analyser) {
      const usableBins = Math.floor(dataArray.length / 2);
      const col = new Uint8ClampedArray(SPEC_H * 4);
      for (let py = 0; py < SPEC_H; py++) {
        const binIdx = Math.floor((SPEC_H - 1 - py) * usableBins / SPEC_H);
        const [r, g, b] = spectrogramRGB(dataArray[binIdx]);
        col[py * 4]     = r;
        col[py * 4 + 1] = g;
        col[py * 4 + 2] = b;
        col[py * 4 + 3] = 255;
      }
      ctx.putImageData(new ImageData(col, 1, SPEC_H), W - 1, 0);
    }
  }

  function spectrogramRGB(val) {
    if (val < 64) {
      const t = val / 64;
      return [0, 0, Math.round(t * 210)];
    }
    if (val < 128) {
      const t = (val - 64) / 64;
      return [0, Math.round(t * 210), 210];
    }
    if (val < 192) {
      const t = (val - 128) / 64;
      return [Math.round(t * 255), 210, Math.round((1 - t) * 210)];
    }
    const t = (val - 192) / 63;
    return [255, Math.round(210 + t * 45), Math.round(t * 255)];
  }

  // ========== キーボードショートカット ==========
  function matchKey(e, binding) {
    if (!binding) return false;
    return e.code      === binding.key   &&
           e.ctrlKey   === binding.ctrl  &&
           e.altKey    === binding.alt   &&
           e.shiftKey  === binding.shift;
  }

  function handleKeydown(e) {
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (document.activeElement && document.activeElement.isContentEditable) return;

    if (!Object.values(keybindings).some(b => b && matchKey(e, b))) return;
    e.preventDefault();
    e.stopPropagation();

    if (matchKey(e, keybindings.normalSpeedUp)) {
      const step = settings.normalSpeedStep || 0.05;
      const next = Math.min(16.0, Math.round((settings.normalSpeed + step) * 100) / 100);
      chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, normalSpeed: next } });
      if (isSpeedReset) exitSpeedReset(getVideo());
    }
    else if (matchKey(e, keybindings.normalSpeedDown)) {
      const step = settings.normalSpeedStep || 0.05;
      const next = Math.max(step, Math.round((settings.normalSpeed - step) * 100) / 100);
      chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, normalSpeed: next } });
      if (isSpeedReset) exitSpeedReset(getVideo());
    }
    else if (matchKey(e, keybindings.toggleEnabled)) {
      chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, enabled: !settings.enabled } });
    }
    else if (matchKey(e, keybindings.thresholdUp)) {
      const next = Math.min(0.08, Math.round((settings.silenceThreshold + 0.005) * 1000) / 1000);
      chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, silenceThreshold: next } });
    }
    else if (matchKey(e, keybindings.thresholdDown)) {
      const next = Math.max(0.005, Math.round((settings.silenceThreshold - 0.005) * 1000) / 1000);
      chrome.storage.local.set({ [SETTINGS_KEY]: { ...settings, silenceThreshold: next } });
    }
    else if (matchKey(e, keybindings.toggleSpeedReset)) {
      isSpeedReset ? exitSpeedReset(getVideo()) : enterSpeedReset(getVideo());
    }
    else if (matchKey(e, keybindings.seekBackward)) {
      const video = getVideo();
      if (video) video.currentTime = Math.max(0, video.currentTime - settings.seekSeconds);
    }
    else if (matchKey(e, keybindings.seekForward)) {
      const video = getVideo();
      if (video) video.currentTime = Math.min(video.duration || video.currentTime, video.currentTime + settings.seekSeconds);
    }
  }

  function enterSpeedReset(video) {
    isSpeedReset = true;
    cancelSpeedRamp();
    if (silenceTimer) { clearTimeout(silenceTimer); silenceTimer = null; }
    isSilent = false;
    if (video) setPlaybackRate(video, 1.0);
  }

  function exitSpeedReset(video) {
    isSpeedReset = false;
    if (video) setTargetSpeed(video, isSilent ? settings.silenceSpeed : settings.normalSpeed);
  }

  // ========== SPA ナビゲーション対応 ==========
  function startObserver() {
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(() => {
          resetAudio();
          currentVideoEl = null;
          overlayPos = { left: null, top: null };
        }, 500);
      }
    }).observe(document.body, { subtree: true, childList: true });

    // フルスクリーン切り替え時にオーバーレイを正しい親に移動
    function onFullscreenChange() {
      if (!overlayEl) return;
      overlayParent().appendChild(overlayEl);
      overlayPos = { left: null, top: null };
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
  }

  // ========== 設定変更のリスニング ==========
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes[SETTINGS_KEY]) {
      settings = { ...settings, ...changes[SETTINGS_KEY].newValue };
      const video = getVideo();
      if (video) {
        if (isSpeedReset) {
          setPlaybackRate(video, 1.0);
        } else if (isSilent) {
          setTargetSpeed(video, settings.silenceSpeed);
        } else {
          setTargetSpeed(video, settings.normalSpeed);
        }
      }
    }
    if (changes[KEYBINDINGS_KEY]) {
      keybindings = { ...keybindings, ...changes[KEYBINDINGS_KEY].newValue };
    }
  });

  // ========== ポップアップとの通信 ==========
  function notifyBackground(msg) {
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch (_) {}
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'getStatus') {
      sendResponse({
        enabled: settings.enabled,
        isSilent,
        totalSavedSeconds,
        currentSpeed:  getVideo()?.playbackRate ?? 1,
        currentVolume,
      });
    }
    if (msg.type === 'resetSavedTime') {
      totalSavedSeconds = 0;
      chrome.storage.local.set({ totalSavedSeconds: 0 });
      sendResponse({ ok: true });
    }
  });

})();
