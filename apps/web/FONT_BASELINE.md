# Web Font Baseline

The Web app uses system fonts only. The global CSS stack prefers these CJK families:

- Sans: `Noto Sans SC`, `Noto Sans CJK SC`, `Source Han Sans SC`, `PingFang SC`, `Microsoft YaHei`.
- Serif: `Noto Serif SC`, `Noto Serif CJK SC`, `Source Han Serif SC`, `Songti SC`, `SimSun`.
- Mono: `JetBrains Mono`, `SFMono-Regular`, `Liberation Mono`, `Noto Sans Mono CJK SC`.

Chromium screenshots need at least one installed Chinese font. If local Playwright screenshots show square glyph boxes, install a CJK font package in the OS or container, then restart the browser process.

Linux check:

```bash
fc-list :lang=zh family | head
```

Current local check on 2026-05-17 returned no Chinese font families in this
container, so Playwright screenshots render Chinese glyph boxes until a CJK font
package is installed.

Linux package examples:

```bash
sudo apt-get install fonts-noto-cjk fonts-noto-cjk-extra
```

No remote font is loaded by default. This keeps screenshots and production rendering independent from third-party font CDNs.
