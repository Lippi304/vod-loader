# VOD Loader

Download Twitch VODs. Simple. Paste a link, pick a quality, done.

Runs on **macOS (Apple Silicon)** and **Windows**. Under the hood,
[yt-dlp](https://github.com/yt-dlp/yt-dlp) downloads the VOD and ffmpeg remuxes it into an MP4.

## Features

- Paste a link → thumbnail, title, channel, duration
- Or type a channel name → the VODs from the last 14 days as cards (grid or list); tick the ones
  you want, with one quality for all of them or a separate quality per VOD
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
Pushing a version tag starts a build that signs, notarizes and publishes a release (see
[Releasing a new version](#releasing-a-new-version)). **Actions → Build → Run workflow** builds and
verifies without publishing. After about 10 minutes the DMG and EXE are available under **Releases**
on the right side of the repo.

## First launch: security warning

- **Mac:** The app is signed and notarized by Apple. Open the DMG, drag the app into *Applications*
  and launch it. On first launch macOS asks once whether you want to open an app downloaded from
  the internet: click *Open*.
- **Windows:** The app is not signed (that costs money). If SmartScreen appears, click
  *More info → Run anyway*.

## Updates

The app checks GitHub for a newer version in the background (at startup and every few hours) and
downloads it by itself. A bar at the bottom then says "Version X is ready": click *Restart* to
install it now, or ignore it and it is installed the next time you quit.
Versions before 1.2.0 have no updater and need one manual update.

## Releasing a new version

1. Raise `version` in `package.json` (e.g. to `1.2.1`) and commit.
2. Tag and push: `git tag v1.2.1 && git push origin main v1.2.1`

CI then builds, signs, notarizes and publishes the release, and installed apps pick it up. The tag
has to match `version`, otherwise the build fails. Pushing to `main` alone does not create a release.

## Limitations

- Subscriber-only VODs are not supported (that would require a Twitch login).
- VODs only, no clips and no chat. That is intentional.
- In the channel view you pick whole VODs and a quality step (Best, 1080p, 720p, 480p, audio only).
  If a VOD lacks that step, the next lower one is used. Sections (from / to) need a single VOD link.
- The channel view shows up to the 30 newest VODs, limited to the last 14 days.
- The Mac build is for Apple Silicon only (M1 and newer).

## License

MIT
