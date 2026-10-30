// Verwaltet yt-dlp (Download, Update) und führt Info-Abfragen und Downloads aus.
const fs = require('fs');
const path = require('path');
const https = require('https');
const { spawn, execFile } = require('child_process');
const { app } = require('electron');

const ASSETS = {
  darwin: 'yt-dlp_macos',
  win32: 'yt-dlp.exe',
  linux: process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux',
};
const RELEASE_URL = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/';

const isWin = process.platform === 'win32';

function binDir() {
  return path.join(app.getPath('userData'), 'bin');
}

function binPath() {
  return path.join(binDir(), isWin ? 'yt-dlp.exe' : 'yt-dlp');
}

function ffmpegPath() {
  // Optionaler Override (z. B. eigenes ffmpeg); sonst das mitgelieferte.
  if (process.env.VOD_LOADER_FFMPEG) return process.env.VOD_LOADER_FFMPEG;
  // Im gepackten Programm liegt ffmpeg außerhalb des asar-Archivs.
  return require('ffmpeg-static').replace('app.asar', 'app.asar.unpacked');
}

function childEnv() {
  return { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
}

// Lädt eine Datei herunter, folgt Weiterleitungen, meldet Fortschritt 0..1.
function fetchFile(url, dest, onProgress, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 10) return reject(new Error('Zu viele Weiterleitungen'));
    https
      .get(url, { headers: { 'User-Agent': 'VOD-Loader' } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          return resolve(fetchFile(next, dest, onProgress, redirects + 1));
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Download fehlgeschlagen (HTTP ${res.statusCode})`));
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
  if (!asset) throw new Error('Dieses Betriebssystem wird nicht unterstützt.');
  fs.mkdirSync(binDir(), { recursive: true });
  const tmp = target + '.download';
  await fetchFile(RELEASE_URL + asset, tmp, onProgress);
  if (!isWin) fs.chmodSync(tmp, 0o755);
  fs.renameSync(tmp, target);
  return { installed: true };
}

// Aktualisiert yt-dlp still im Hintergrund. Fehler sind nicht kritisch.
function selfUpdate() {
  return new Promise((resolve) => {
    execFile(binPath(), ['-U'], { env: childEnv(), timeout: 120000 }, () => resolve());
  });
}

// Akzeptiert Links wie twitch.tv/videos/123, twitch.tv/kanal/v/123 oder nur die ID.
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
      if (!map.has('audio')) map.set('audio', { id: f.format_id, label: 'Nur Audio', height: 0, audio: true });
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
  if (!url) return Promise.reject(new Error('Das sieht nicht nach einem Twitch-VOD-Link aus.'));
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
            title: j.title || 'Unbenanntes VOD',
            channel: j.uploader || j.channel || '',
            duration: j.duration || 0,
            timestamp: j.timestamp || null,
            thumbnail: j.thumbnail || (j.thumbnails && j.thumbnails.length ? j.thumbnails[j.thumbnails.length - 1].url : ''),
            qualities: formatQualities(j.formats),
          });
        } catch (e) {
          reject(new Error('Antwort von Twitch konnte nicht gelesen werden.'));
        }
      }
    );
  });
}

function friendlyError(text) {
  const t = String(text);
  if (/subscriber|sub-only|subscribers only/i.test(t)) return 'Dieses VOD ist nur für Abonnenten verfügbar.';
  if (/does not exist|404|not found/i.test(t)) return 'Dieses VOD gibt es nicht (mehr).';
  if (/getaddrinfo|network|timed out|unable to download/i.test(t)) return 'Keine Verbindung zu Twitch. Prüfe deine Internetverbindung.';
  const line = t.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('ERROR')).pop();
  return line ? line.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/, '') : 'Da ist etwas schiefgelaufen.';
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

// Startet den Download. Gibt ein Objekt mit cancel() und einem Promise zurück.
function download({ url, formatId, audio, start, end, dir, id }, onProgress) {
  const startS = toSeconds(start);
  const endS = toSeconds(end);
  const section = startS != null || endS != null;
  const sectionLen = section ? Math.max(1, (endS ?? 0) - (startS ?? 0)) : null;

  const args = [
    url,
    '-f', formatId,
    '--ffmpeg-location', ffmpegPath(),
    '-o', path.join(dir, `%(uploader)s - %(title)s${section ? ` (${(start || '0').replace(/:/g, '-')} bis ${(end || 'Ende').replace(/:/g, '-')})` : ''} [%(id)s].%(ext)s`),
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

  // Restzeit aus bisherigem Fortschritt schätzen (yt-dlp liefert bei HLS oft keine).
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
    // Bei Ausschnitten lädt ffmpeg selbst: Fortschritt aus "time=hh:mm:ss" lesen.
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
        return reject(Object.assign(new Error('Abgebrochen'), { cancelled: true }));
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

// Entfernt nur eindeutige Zwischendateien dieses VODs, niemals fertige Videos.
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

module.exports = { ensure, selfUpdate, getInfo, download, normalizeUrl, formatQualities, toSeconds };
