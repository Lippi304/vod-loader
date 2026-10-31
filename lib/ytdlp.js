// Manages yt-dlp (download, update) and runs info queries and downloads.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, execFile } = require('child_process');

const ASSETS = {
  darwin: 'yt-dlp_macos',
  win32: 'yt-dlp.exe',
  linux: process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux',
};
const RELEASE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';

const isWin = process.platform === 'win32';

function binDir() {
  // Loaded lazily so the pure helpers below can be tested without Electron.
  return path.join(require('electron').app.getPath('userData'), 'bin');
}

function binPath() {
  return path.join(binDir(), isWin ? 'yt-dlp.exe' : 'yt-dlp');
}

function ffmpegPath() {
  // Optional override (e.g. your own ffmpeg); otherwise the bundled one.
  if (process.env.VOD_LOADER_FFMPEG) return process.env.VOD_LOADER_FFMPEG;
  // In the packaged app ffmpeg lives outside the asar archive.
  return require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
}

function childEnv() {
  return { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
}

// Downloads a file, follows redirects, reports progress 0..1.
function fetchFile(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error('Too many redirects'));
    https
      .get(url, { headers: { 'User-Agent': 'VOD-Loader' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return resolve(fetchFile(next, dest, onProgress, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download failed (HTTP ${res.statusCode})`));
        }
        const total = Number(res.headers['content-length']) || 0;
        let done = 0;
        const out = fs.createWriteStream(dest);
        res.on('data', (chunk) => {
          done += chunk.length;
          if (total && onProgress) onProgress(done / total);
        });
        res.pipe(out);
        out.on('finish', () => out.close(resolve));
        out.on('error', reject);
        res.on('error', reject);
      })
      .on('error', reject);
  });
}

async function ensure(onProgress) {
  const target = binPath();
  if (fs.existsSync(target)) return { installed: false };
  const asset = ASSETS[process.platform];
  if (!asset) throw new Error('This operating system is not supported.');
  fs.mkdirSync(binDir(), { recursive: true });
  const tmp = target + '.download';
  await fetchFile(RELEASE_URL + asset, tmp, onProgress);
  if (!isWin) fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, target);
  return { installed: true };
}

// Updates yt-dlp quietly in the background. Errors are not critical.
function selfUpdate() {
  return new Promise((resolve) => {
    execFile(binPath(), ['-U'], { env: childEnv(), timeout: 120000 }, () => resolve());
  });
}

// Accepts links like twitch.tv/videos/123, twitch.tv/channel/v/123 or just the ID.
function normalizeUrl(input) {
  const s = String(input || '').trim();
  if (/^v?\d{6,}$/.test(s)) return `https://www.twitch.tv/videos/${s.replace(/^v/, '')}`;
  const m = s.match(/twitch\.tv\/(?:videos\/|[\w-]+\/v(?:ideo)?\/)(\d+)/i);
  if (m) return `https://www.twitch.tv/videos/${m[1]}`;
  return null;
}

function formatQualities(formats = []) {
  const map = new Map();
  for (const f of formats) {
    if (!f || !f.format_id) continue;
    if (f.vcodec === 'none' || /audio/i.test(f.format_id)) {
      if (!map.has('audio')) map.set('audio', { id: f.format_id, label: 'Audio only', height: 0, audio: true });
      continue;
    }
    if (!f.height) continue;
    const fps = f.fps && f.fps > 31 ? Math.round(f.fps) : '';
    const label = `${f.height}p${fps}`;
    const prev = map.get(label);
    if (!prev || (f.tbr || 0) > (prev.tbr || 0)) {
      map.set(label, { id: f.format_id, label, height: f.height, fps: f.fps || 30, tbr: f.tbr || 0 });
    }
  }
  return [...map.values()].sort((a, b) => b.height - a.height || (b.fps || 0) - (a.fps || 0));
}

function getInfo(input) {
  const url = normalizeUrl(input);
  if (!url) return Promise.reject(new Error("That doesn't look like a Twitch VOD link."));
  return new Promise((resolve, reject) => {
    execFile(
      binPath(),
      ['-J', '--no-warnings', '--no-playlist', url],
      { env: childEnv(), maxBuffer: 64 * 1024 * 1024, timeout: 60000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(friendlyError(stderr || err.message)));
        try {
          const j = JSON.parse(stdout);
          resolve({
            url,
            id: j.id,
            title: j.title || 'Untitled VOD',
            channel: j.uploader || j.channel || '',
            duration: j.duration || 0,
            timestamp: j.timestamp || null,
            thumbnail: j.thumbnail || (j.thumbnails && j.thumbnails.length ? j.thumbnails[j.thumbnails.length - 1].url : ''),
            qualities: formatQualities(j.formats),
          });
        } catch (e) {
          reject(new Error('Could not read the response from Twitch.'));
        }
      }
    );
  });
}

// ---------- Channels ----------
const CHANNEL_DAYS = 14;
const CHANNEL_MAX = 30; // newest VODs to fetch before filtering by age

// Accepts a channel name or a link like twitch.tv/name or twitch.tv/name/videos.
function parseChannel(input) {
  const m = String(input || '').trim()
    .match(/^(?:https?:\/\/)?(?:(?:www|m)\.)?(?:twitch\.tv\/)?@?(\w{3,25})(?:\/(?:videos|about|schedule)?)?\/?(?:\?.*)?$/i);
  return m ? m[1] : null;
}

// Twitch puts the broadcast start (unix seconds) at the end of the thumbnail URL.
function thumbTimestamp(url) {
  const m = String(url || '').match(/_(\d{10})\/\/thumb/);
  return m ? Number(m[1]) : null;
}

// Keeps VODs from the last `days` days; VODs with an unknown date are kept.
function recentOnly(vods, days, now = Date.now() / 1000) {
  return vods.filter((v) => v.timestamp == null || v.timestamp >= now - days * 86400);
}

// Fallback in case the thumbnail URL format ever changes: look the dates up one by one.
async function fillMissingTimestamps(vods) {
  const missing = vods.filter((v) => v.timestamp == null);
  for (let i = 0; i < missing.length; i += 6) {
    await Promise.all(missing.slice(i, i + 6).map((v) => new Promise((resolve) => {
      execFile(binPath(), ['--no-warnings', '--no-playlist', '-O', '%(timestamp)s', v.url],
        { env: childEnv(), timeout: 60000 }, (err, out) => {
          const ts = Number(String(out).trim());
          if (!err && Number.isFinite(ts) && ts > 0) v.timestamp = ts;
          resolve();
        });
    })));
  }
}

function getChannel(name) {
  const url = `https://www.twitch.tv/${name}/videos?filter=archives&sort=time`;
  return new Promise((resolve, reject) => {
    execFile(
      binPath(),
      ['-J', '--flat-playlist', '--no-warnings', '--playlist-end', String(CHANNEL_MAX), url],
      { env: childEnv(), maxBuffer: 64 * 1024 * 1024, timeout: 60000 },
      async (err, stdout, stderr) => {
        if (err) return reject(new Error(friendlyError(stderr || err.message)));
        try {
          // An unknown channel comes back as an empty list, not as an error.
          const vods = (JSON.parse(stdout).entries || []).map((e) => ({
            id: e.id, // keeps the "v" prefix, like getInfo() and the file names
            url: `https://www.twitch.tv/videos/${String(e.id).replace(/^v/, '')}`,
            title: e.title || 'Untitled VOD',
            thumbnail: String(e.thumbnail || '').replace('-320x180.', '-640x360.'),
            duration: e.duration || 0,
            views: e.view_count ?? null,
            timestamp: thumbTimestamp(e.thumbnail),
          }));
          await fillMissingTimestamps(vods);
          resolve({ channel: name, vods: recentOnly(vods, CHANNEL_DAYS) });
        } catch (e) {
          reject(new Error('Could not read the response from Twitch.'));
        }
      }
    );
  });
}

// Takes whatever the user typed: a VOD link/ID or a channel name/link.
async function lookup(input) {
  if (normalizeUrl(input)) return { kind: 'vod', vod: await getInfo(input) };
  const name = parseChannel(input);
  if (!name) throw new Error("That doesn't look like a Twitch VOD link or channel.");
  return { kind: 'channel', ...(await getChannel(name)) };
}

function friendlyError(text) {
  const t = String(text);
  if (/subscriber|sub-only|subscribers only/i.test(t)) return 'This VOD is only available to subscribers.';
  if (/does not exist|404|not found/i.test(t)) return 'This VOD does not exist (anymore).';
  if (/getaddrinfo|network|timed out|unable to download/i.test(t)) return 'No connection to Twitch. Check your internet connection.';
  const line = t.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('ERROR')).pop();
  return line ? line.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '') : 'Something went wrong.';
}

function toSeconds(hms) {
  if (hms == null || hms === '') return null;
  const parts = String(hms).trim().split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Starts the download. Returns an object with cancel() and a promise.
function download({ url, formatId, audio, start, end, dir, id }, onProgress) {
  const startS = toSeconds(start);
  const endS = toSeconds(end);
  const section = startS != null || endS != null;
  const sectionLen = section ? Math.max(1, (endS ?? 0) - (startS ?? 0)) : null;

  // Audio-only gets its own file name: yt-dlp downloads an .mp4 first and deletes it after
  // extracting the audio, which would also delete a video of the same VOD with the same name.
  const args = [
    url,
    '-f', formatId,
    '--ffmpeg-location', ffmpegPath(),
    '-o', path.join(dir, `%(uploader)s - %(title)s${section ? ` (${(start || '0').replace(/:/g, '-')} to ${(end || 'end').replace(/:/g, '-')})` : ''} [%(id)s]${audio ? ' (audio)' : ''}.%(ext)s`),
    '--trim-filenames', '180',
    '--no-mtime',
    '--concurrent-fragments', '8',
    '--newline', '--progress',
    '--progress-template',
    'download:PROG %(progress.fragment_index)s|%(progress.fragment_count)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s',
    '--print', 'after_move:FILE %(filepath)s',
    '--no-simulate',
    '--no-warnings',
  ];
  if (audio) args.push('-x', '--audio-format', 'm4a');
  else args.push('--remux-video', 'mp4');
  if (section) args.push('--download-sections', `*${start || '0'}-${end || 'inf'}`);

  const child = spawn(binPath(), args, { env: childEnv(), detached: !isWin, windowsHide: true });
  let filePath = null;
  let stderrBuf = '';
  let cancelled = false;
  const t0 = Date.now();

  // Estimate the remaining time from the progress so far (yt-dlp often gives none for HLS).
  const etaFrom = (pct) => {
    const elapsed = (Date.now() - t0) / 1000;
    if (!pct || pct < 0.02 || elapsed < 3) return null;
    return (elapsed * (1 - pct)) / pct;
  };

  const handleLine = (line) => {
    line = line.trim();
    if (line.startsWith('PROG ')) {
      const [fi, fc, db, tb, te, sp, eta] = line.slice(5).split('|').map(num);
      let pct = null;
      if (fi != null && fc) pct = fi / fc;
      else if (db != null && (tb || te)) pct = db / (tb || te);
      onProgress({ phase: 'download', pct, speed: sp, eta: eta ?? etaFrom(pct) });
    } else if (line.startsWith('FILE ')) {
      filePath = line.slice(5).trim();
    }
  };

  let outBuf = '';
  child.stdout.on('data', (d) => {
    outBuf += d.toString('utf8');
    const lines = outBuf.split(/\r?\n/);
    outBuf = lines.pop();
    lines.forEach(handleLine);
  });

  child.stderr.on('data', (d) => {
    const s = d.toString('utf8');
    stderrBuf = (stderrBuf + s).slice(-20000);
    // For sections ffmpeg downloads itself: read the progress from "time=hh:mm:ss".
    const times = [...s.matchAll(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
    if (times.length && sectionLen) {
      const [, h, m, sec] = times[times.length - 1];
      const t = Number(h) * 3600 + Number(m) * 60 + Number(sec);
      const sp = s.match(/speed=\s*([\d.]+)x/);
      const pct = Math.min(1, t / sectionLen);
      onProgress({ phase: 'download', pct, speed: null, eta: etaFrom(pct) });
    }
  });

  const done = new Promise((resolve, reject) => {
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (outBuf) handleLine(outBuf);
      if (cancelled) {
        cleanupPartials(dir, id);
        return reject(Object.assign(new Error('Cancelled'), { cancelled: true }));
      }
      if (code === 0) return resolve({ filePath });
      reject(new Error(friendlyError(stderrBuf)));
    });
  });

  return {
    done,
    cancel() {
      cancelled = true;
      try {
        if (isWin) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
        else process.kill(-child.pid, 'SIGTERM');
      } catch (_) {
        try { child.kill(); } catch (_) {}
      }
    },
  };
}

// Removes only clearly identifiable temp files of this VOD, never finished videos.
function cleanupPartials(dir, id) {
  if (!id) return;
  setTimeout(() => {
    try {
      for (const name of fs.readdirSync(dir)) {
        if (!name.includes(`[${id}]`)) continue;
        if (/\.(part|ytdl|temp)(\.|$)|\.part-Frag\d+|\.f\d+\./i.test(name)) {
          fs.rmSync(path.join(dir, name), { force: true });
        }
      }
    } catch (_) {}
  }, 800);
}

module.exports = {
  ensure, selfUpdate, getInfo, lookup, download,
  normalizeUrl, formatQualities, toSeconds, parseChannel, thumbTimestamp, recentOnly,
};
