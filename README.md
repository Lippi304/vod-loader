# VOD Loader

Download Twitch VODs. Simple. Paste a link, pick a quality, done.

Runs on **macOS (Apple Silicon)** and **Windows**. Under the hood,
[yt-dlp](https://github.com/yt-dlp/yt-dlp) downloads the VOD and ffmpeg remuxes it into an MP4.

## Features

- Paste a link → thumbnail, title, channel, duration
- Pick a quality (e.g. 1080p60, 720p60 … or audio only)
- Optionally download just a section (from / to)
- Queue: add several VODs, they are downloaded one after another
- Choose where to save (remembered, default: Downloads)
- Progress with speed and time remaining, also shown in the Dock / taskbar; cancel at any time
- Light and dark mode, following the system automatically

## Run directly (no installation)

Requires [Node.js](https://nodejs.org) 20 or newer.

```bash
npm install
npm start
```

On first launch the app downloads yt-dlp once (about 35 MB) and keeps it up to date on its own.

## Build an installable app

**Option A, locally:** on the respective system

```bash
npm install
npm run dist
```

The result is in `dist/` (`.dmg` on macOS, `.exe` on Windows).
Mac builds only work on a Mac, Windows builds only on Windows.

**Option B, via GitHub (both at once):**
Every push to `main` automatically starts a build (manually: **Actions → Build → Run workflow**).
After about 10 minutes the DMG and EXE are available under **Releases** on the right side of the repo.

## First launch: security warning

- **Mac:** The app is signed and notarized by Apple. Open the DMG, drag the app into *Applications*
  and launch it. On first launch macOS asks once whether you want to open an app downloaded from
  the internet: click *Open*.
- **Windows:** The app is not signed (that costs money). If SmartScreen appears, click
  *More info → Run anyway*.

## Limitations

- Subscriber-only VODs are not supported (that would require a Twitch login).
- VODs only, no clips and no chat. That is intentional.
- The Mac build is for Apple Silicon only (M1 and newer).

## License

MIT
