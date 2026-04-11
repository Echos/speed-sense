# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト概要

`<video>` 要素を持つ全サイトで動作する Chrome 拡張機能。無音区間を自動検出して高速スキップする。

**background script は存在しない**（Manifest V3 の service worker も未使用）。
`content.js` ↔ `popup.js` の通信は `chrome.runtime.sendMessage` / `onMessage` で直接行う。

---

## 開発コマンド

ビルドステップなし。ファイルを編集後、以下の手順でリロードする。

```
chrome://extensions/ → SpeedSense → 更新ボタン（↺）
```

content.js のログは対象ページの DevTools コンソールに出力される（`[SmartSpeed]` プレフィックス付き）。
popup.js のログはポップアップの DevTools（右クリック → 検証）に出力される。

---

## アーキテクチャ

### データフロー

```
<video> 要素
  └─ captureStream() → MediaStream（音声トラックのみ）
       └─ AudioContext → AnalyserNode (fftSize=256, 128bins)
            └─ getByteFrequencyData() → 音量計算 → 無音判定 → playbackRate 制御
```

### 設定の永続化と伝達

- `chrome.storage.local` にキー `smartSpeedSettings`（設定オブジェクト）と `totalSavedSeconds`（数値）を保存
- `popup.js` が `saveSettings()` で書き込み → `content.js` の `chrome.storage.onChanged` が即時反映
- キーバインドは別キー `smartSpeedKeybindings` で管理（スキーマ: `{ action: { key: e.code, ctrl, alt, shift } | null }`）

### 節約時間の計算式

```
saved += (silenceSpeed / normalSpeed - 1) × 無音区間の実経過時間(秒)
```

---

## 設定スキーマ

```js
// smartSpeedSettings
{
  enabled:          boolean,  // SpeedSense の ON/OFF
  normalSpeed:      number,   // 通常再生速度 (0.05〜16.0, step 0.05)
  silenceSpeed:     number,   // 無音時スキップ速度 (1.5〜16.0, step 0.5)
  silenceThreshold: number,   // 音量しきい値 0〜1（UI 表示は ×100 の % 値、実効範囲 0.005〜0.08）
  silenceDelay:     number,   // 無音判定遅延 ms (50〜800, step 50)
  seekSeconds:             number,   // 巻き戻し/早送り秒数 (1〜60, デフォルト 10)
  showSpectrogram:         boolean,  // スペクトラグラム表示 ON/OFF（デフォルト false）
  showOverlayOnSpeedReset: boolean,  // 速度リセット（1.0x トグル）中にオーバーレイを表示するか（デフォルト true）
  // ※ enabled=false 時はオーバーレイを常に非表示
}

// smartSpeedKeybindings
{
  normalSpeedUp, normalSpeedDown,   // 通常速度 ±0.05x
  toggleEnabled,                    // Smart Speed ON/OFF
  thresholdUp, thresholdDown,       // しきい値 ±0.005
  toggleSpeedReset,                 // 1.0x トグル（isSpeedReset フラグ）
  seekBackward, seekForward,        // ±seekSeconds シーク（デフォルト null）
}
```

---

## content.js の重要な設計判断

### `captureStream()` を優先する理由
`createMediaElementSource()` は YouTube の CORS ポリシーにより失敗する場合がある。
`captureStream()` が音声トラックなし（0 件）を返した場合は動画読み込み中と見なし、警告なしで 500ms 後にリトライする。
`captureStream()` 自体が例外を投げた場合のみ `createMediaElementSource()` にフォールバックする。
`setupAudioNextRetry` タイムスタンプで 60fps リトライの連打を防ぐ。

### `requestAnimationFrame` ループ
タブが非アクティブ時は rAF が自動停止し CPU 負荷を抑える。インジケータ更新は `lastIndicatorMs` で 60fps に上限を設けている。

### SPA ナビゲーション対応
`MutationObserver` で `location.href` の変化を監視し、遷移検出から 500ms 後に `resetAudio()` を呼ぶ。
オーバーレイ位置（`overlayPos`）も同時にリセットする。

### 速度線形遷移（Speed Ramp）
速度変化はすべて `setTargetSpeed(video, target)` を経由し、`applySpeedRamp()` が 400ms かけて線形補間する。
`enterSpeedReset` など即時変更が必要な場合は先に `cancelSpeedRamp()` を呼んでから `video.playbackRate` を直接設定する。

### オーバーレイのビデオ枠クランプ
`updateIndicator()` が毎フレーム `video.getBoundingClientRect()` を取得し、`overlayPos` をビデオ要素の矩形内に収める。
ドラッグ中も `mousemove` ハンドラ内で同様のクランプを適用するため、枠外にはみ出せない。

---

## popup.js の重要な設計判断

### ポーリングによるステータス更新
`getStatus` メッセージを 800ms ごとに content.js へ送信してステータス表示を更新する。
`notifyBackground()` による push 通知も存在するが、ポップアップが閉じている間は届かないためポーリングが主軸。

### 設定追加時の作業箇所（3点セット）
1. `popup.html` にスライダー/入力要素を追加
2. `popup.js` の `applySettings()` と `saveSettings()` に追加
3. `content.js` の `settings` デフォルト値と `chrome.storage.onChanged` ハンドラに追加

---

## Chrome Extension の制約

- `content_scripts` の `run_at: document_idle` で全 URL に挿入される
- `host_permissions: <all_urls>` が必要（captureStream の音声取得に使用）
- `permissions: storage`（chrome.storage.local）と `tabs`（popup.js からのアクティブタブ取得）

---

## 今後の拡張候補

- [ ] 動画ごとの設定プロファイル保存
- [ ] Firefox 対応（WebExtensions API との互換性確認）
- [ ] 統計グラフ（日別・動画別の節約時間）
