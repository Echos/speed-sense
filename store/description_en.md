# SpeedSense — Chrome Web Store Listing (English)

---

## Short Description (max 132 chars)

Auto-detects silence in videos and fast-forwards through it. Works on any site with a video element.

---

## Detailed Description

SpeedSense watches your videos in real time and automatically speeds through silent or pause-heavy sections — so you spend less time waiting and more time learning.

**How it works**

SpeedSense uses the Web Audio API to analyze the audio signal of any playing video. When it detects silence below your configured threshold, it smoothly ramps up the playback speed. The moment speech or audio resumes, it gently returns to your normal speed. All detection happens locally — no audio is ever recorded or sent anywhere.

**Key Features**

- Silence auto-skip — automatically fast-forwards during silent sections
- Smooth speed ramping — speed changes are linearly interpolated over 400 ms to avoid jarring transitions
- Works everywhere — any site with a `<video>` element
- Per-site speed memory — each domain remembers your preferred playback speed
- Live waveform overlay — a real-time scrolling waveform and optional spectrogram appear directly on the video (draggable, stays inside the video frame)
- Time saved counter — see exactly how much time you've saved in total
- Fully customizable — normal speed, silence speed, detection threshold, delay, and seek amount are all adjustable
- Keyboard shortcuts — assign any key to speed control, toggle, seek, or threshold adjustments

**Settings**

| Setting | Default | Range |
|---|---|---|
| Normal speed | 1.0× | 0.05 – 16.0× |
| Silence speed | 3.0× | 1.5 – 16.0× |
| Silence threshold | 1.5% | 0.5 – 8% |
| Silence delay | 250 ms | 50 – 800 ms |
| Seek amount | 10 s | 1 – 60 s |

**Permissions**

- `storage` — saves your settings locally on your device
- `tabs` — allows the popup to communicate with the active tab and open the support page
- `host permissions (<all_urls>)` — required to inject the silence-detection script into any page that contains a video element; no data is read or transmitted from those pages

**Privacy**

SpeedSense collects no personal data. Everything runs locally in your browser. See the full privacy policy at: https://echos.github.io/speed-sense/

---

## Category

Productivity

## Language

English

## Tags (up to 5)

video speed, silence skip, auto speed, playback control, lecture speed
