(() => {
'use strict';

const api = window.api;
const $ = (id) => document.getElementById(id);

document.documentElement.dataset.platform = api.platform;
const isMac = api.platform === 'darwin';
$('reveal').textContent = isMac ? 'Im Finder zeigen' : 'Im Explorer zeigen';

let vod = null;
let lastFile = null;

// ---------- Hilfsfunktionen ----------
function show(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
}

function cleanError(err) {
  const msg = (err && err.message) || String(err);
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
}

function setError(el, msg) {
  el.textContent = msg || '';
  el.hidden = !msg;
}

function fmtDuration(sec) {
  sec = Math.round(sec || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = String(m).padStart(h ? 2 : 1, '0');
  return h ? `${h}:${mm}:${String(s).padStart(2, '0')}` : `${mm}:${String(s).padStart(2, '0')}`;
}

function fmtDate(ts) {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtSpeed(bps) {
  if (!bps) return '';
  const mb = bps / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1).replace('.', ',')} MB/s` : `${Math.round(bps / 1024)} KB/s`;
}

function fmtEta(sec) {
  if (sec == null || !Number.isFinite(sec)) return '';
  if (sec < 60) return 'noch wenige Sekunden';
  const min = Math.round(sec / 60);
  if (min < 60) return `noch ${min} Min.`;
  return `noch ${Math.floor(min / 60)} Std. ${min % 60} Min.`;
}

function toSeconds(str) {
  const s = String(str || '').trim();
  if (!s) return null;
  if (!/^\d+(:\d{1,2}){0,2}$/.test(s)) return NaN;
  return s.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
}

// ---------- Start ----------
async function init() {
  show('setup');
  const fill = $('setup-fill');
  fill.parentElement.classList.add('indeterminate');
  api.onSetupProgress((p) => {
    fill.parentElement.classList.remove('indeterminate');
    fill.style.width = `${Math.round(p * 100)}%`;
  });
  try {
    await api.setup();
    const d = await api.getDir();
    $('dir-name').textContent = d.name;
    show('start');
    $('url').focus();
  } catch (err) {
    $('view-setup').querySelector('h2').textContent = 'Einrichtung fehlgeschlagen';
    $('view-setup').querySelector('p').textContent = cleanError(err) + ' Prüfe deine Internetverbindung und starte die App neu.';
    fill.parentElement.hidden = true;
  }
}

// ---------- Link prüfen ----------
const form = $('url-form');
let busy = false;

async function lookup() {
  const value = $('url').value.trim();
  if (!value || busy) return;
  busy = true;
  setError($('start-error'), '');
  form.classList.add('loading');
  try {
    vod = await api.info(value);
    renderInfo();
    show('info');
  } catch (err) {
    setError($('start-error'), cleanError(err));
  } finally {
    busy = false;
    form.classList.remove('loading');
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  lookup();
});
$('url').addEventListener('paste', () => setTimeout(lookup, 0));

function renderInfo() {
  $('thumb').src = vod.thumbnail || '';
  $('title').textContent = vod.title;
  $('meta').textContent = [vod.channel, fmtDate(vod.timestamp)].filter(Boolean).join(' · ');
  $('duration').textContent = fmtDuration(vod.duration);
  $('duration').hidden = !vod.duration;

  const sel = $('quality');
  sel.innerHTML = '';
  for (const q of vod.qualities) {
    const o = document.createElement('option');
    o.value = q.id;
    o.textContent = q.label;
    o.dataset.audio = q.audio ? '1' : '';
    sel.appendChild(o);
  }
  if (!vod.qualities.length) {
    const o = document.createElement('option');
    o.value = 'best';
    o.textContent = 'Beste';
    sel.appendChild(o);
  }

  $('section-toggle').checked = false;
  $('section-rows').classList.remove('open');
  $('start').value = '';
  $('end').value = '';
  $('end').placeholder = fmtDuration(vod.duration) || '0:00:00';
  setError($('info-error'), '');
}

// ---------- Optionen ----------
$('section-toggle').addEventListener('change', (e) => {
  $('section-rows').classList.toggle('open', e.target.checked);
  if (e.target.checked) setTimeout(() => $('start').focus(), 150);
});

for (const id of ['start', 'end']) {
  $(id).addEventListener('input', () => $(id).classList.remove('invalid'));
}

$('dir-btn').addEventListener('click', async () => {
  const d = await api.chooseDir();
  if (d) $('dir-name').textContent = d.name;
});

$('back').addEventListener('click', () => {
  $('url').value = '';
  show('start');
  $('url').focus();
});

// ---------- Download ----------
function validateSection() {
  if (!$('section-toggle').checked) return { start: null, end: null };
  const s = toSeconds($('start').value);
  const e = toSeconds($('end').value);
  let ok = true;
  if (Number.isNaN(s)) { $('start').classList.add('invalid'); ok = false; }
  if (Number.isNaN(e)) { $('end').classList.add('invalid'); ok = false; }
  if (!ok) return { error: 'Bitte Zeiten im Format h:mm:ss angeben, z. B. 1:05:00.' };
  if (s == null && e == null) return { error: 'Gib mindestens eine Start- oder Endzeit an.' };
  const start = s ?? 0;
  const end = e ?? vod.duration;
  if (vod.duration && (start >= vod.duration || end > vod.duration + 1)) {
    return { error: `Das VOD ist nur ${fmtDuration(vod.duration)} lang.` };
  }
  if (end <= start) {
    $('end').classList.add('invalid');
    return { error: 'Das Ende muss nach dem Start liegen.' };
  }
  return { start: fmtDuration(start), end: fmtDuration(end) };
}

$('download').addEventListener('click', async () => {
  setError($('info-error'), '');
  const sec = validateSection();
  if (sec.error) return setError($('info-error'), sec.error);

  const opt = $('quality').selectedOptions[0];
  $('p-thumb').src = vod.thumbnail || '';
  $('p-title').textContent = vod.title;
  $('p-fill').style.width = '0%';
  $('p-fill').parentElement.classList.add('indeterminate');
  $('p-stats').textContent = 'Wird vorbereitet …';
  show('progress');

  try {
    const res = await api.download({
      url: vod.url,
      id: vod.id,
      formatId: opt.value,
      audio: !!opt.dataset.audio,
      start: sec.start,
      end: sec.end,
    });
    if (res.cancelled) {
      show('info');
      return;
    }
    lastFile = res.filePath;
    $('d-file').textContent = lastFile ? lastFile.split(/[\\/]/).pop() : '';
    show('done');
  } catch (err) {
    show('info');
    setError($('info-error'), cleanError(err));
  }
});

api.onProgress((p) => {
  const bar = $('p-fill').parentElement;
  if (p.pct == null) {
    bar.classList.add('indeterminate');
    $('p-stats').textContent = 'Wird geladen …';
    return;
  }
  bar.classList.remove('indeterminate');
  const pct = Math.max(0, Math.min(100, p.pct * 100));
  $('p-fill').style.width = `${pct}%`;
  const parts = [`${Math.floor(pct)} %`, fmtSpeed(p.speed), fmtEta(p.eta)].filter(Boolean);
  if (pct >= 99.5) parts.splice(0, parts.length, 'Wird fertiggestellt …');
  $('p-stats').textContent = parts.join(' · ');
});

$('cancel').addEventListener('click', () => {
  $('p-stats').textContent = 'Wird abgebrochen …';
  api.cancel();
});

// ---------- Fertig ----------
$('reveal').addEventListener('click', () => api.reveal(lastFile));
$('again').addEventListener('click', () => {
  $('url').value = '';
  show('start');
  $('url').focus();
});

init();
})();
