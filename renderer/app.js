(() => {
'use strict';

const api = window.api;
const $ = (id) => document.getElementById(id);

document.documentElement.dataset.platform = api.platform;
const isMac = api.platform === 'darwin';
$('q-folder').textContent = isMac ? 'Show in Finder' : 'Show in Explorer';

let vod = null;          // VOD currently shown (info view)
const queue = [];        // all downloads of this session
let running = false;
let nextKey = 1;

const ICON_X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
const ICON_REVEAL = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>';

// ---------- Helpers ----------
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
  return new Date(ts * 1000).toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
}

function fmtSpeed(bps) {
  if (!bps) return '';
  const mb = bps / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB/s` : `${Math.round(bps / 1024)} KB/s`;
}

function fmtEta(sec) {
  if (sec == null || !Number.isFinite(sec)) return '';
  if (sec < 60) return 'a few seconds left';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min left`;
  return `${Math.floor(min / 60)} h ${min % 60} min left`;
}

function toSeconds(str) {
  const s = String(str || '').trim();
  if (!s) return null;
  if (!/^\d+(:\d{1,2}){0,2}$/.test(s)) return NaN;
  return s.split(':').map(Number).reduce((a, n) => a * 60 + n, 0);
}

function goStart() {
  $('url').value = '';
  setError($('start-error'), '');
  updateStartLink();
  show('start');
  $('url').focus();
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
    goStart();
  } catch (err) {
    $('view-setup').querySelector('h2').textContent = 'Setup failed';
    $('view-setup').querySelector('p').textContent = cleanError(err) + ' Check your internet connection and restart the app.';
    fill.parentElement.hidden = true;
  }
}

function updateStartLink() {
  const open = queue.filter((q) => q.status === 'queued' || q.status === 'active').length;
  const btn = $('to-queue');
  btn.hidden = queue.length === 0;
  btn.textContent = open ? `View downloads (${open} open)` : 'View downloads';
}
$('to-queue').addEventListener('click', () => {
  renderQueue();
  show('queue');
});

// ---------- Check link ----------
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
    o.textContent = 'Best';
    sel.appendChild(o);
  }

  $('section-toggle').checked = false;
  $('section-rows').classList.remove('open');
  $('start').value = '';
  $('end').value = '';
  $('end').placeholder = fmtDuration(vod.duration) || '0:00:00';
  setError($('info-error'), '');
  $('download').textContent = running ? 'Add to queue' : 'Download';
  $('back').textContent = queue.length ? 'Cancel' : 'Another VOD';
}

// ---------- Options ----------
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

$('back').addEventListener('click', goStart);

function validateSection() {
  if (!$('section-toggle').checked) return { start: null, end: null };
  const s = toSeconds($('start').value);
  const e = toSeconds($('end').value);
  let ok = true;
  if (Number.isNaN(s)) { $('start').classList.add('invalid'); ok = false; }
  if (Number.isNaN(e)) { $('end').classList.add('invalid'); ok = false; }
  if (!ok) return { error: 'Please enter times as h:mm:ss, e.g. 1:05:00.' };
  if (s == null && e == null) return { error: 'Enter at least a start or an end time.' };
  const start = s ?? 0;
  const end = e ?? vod.duration;
  if (vod.duration && (start >= vod.duration || end > vod.duration + 1)) {
    return { error: `This VOD is only ${fmtDuration(vod.duration)} long.` };
  }
  if (end <= start) {
    $('end').classList.add('invalid');
    return { error: 'The end must be after the start.' };
  }
  return { start: fmtDuration(start), end: fmtDuration(end) };
}

// ---------- Add to the queue ----------
$('download').addEventListener('click', () => {
  setError($('info-error'), '');
  const sec = validateSection();
  if (sec.error) return setError($('info-error'), sec.error);

  const opt = $('quality').selectedOptions[0];
  const dup = queue.find(
    (q) => q.vod.id === vod.id && q.start === sec.start && q.end === sec.end &&
      (q.status === 'queued' || q.status === 'active')
  );
  if (dup) return setError($('info-error'), 'This VOD is already in the queue.');

  queue.push({
    key: nextKey++,
    vod,
    formatId: opt.value,
    audio: !!opt.dataset.audio,
    quality: opt.textContent,
    start: sec.start,
    end: sec.end,
    status: 'queued',
    pct: null,
    stats: '',
    filePath: null,
    error: '',
  });
  renderQueue();
  show('queue');
  processQueue();
});

async function processQueue() {
  if (running) return;
  const item = queue.find((q) => q.status === 'queued');
  if (!item) {
    renderQueue();
    return;
  }
  running = true;
  item.status = 'active';
  item.stats = 'Preparing …';
  renderQueue();
  try {
    const res = await api.download({
      url: item.vod.url,
      id: item.vod.id,
      formatId: item.formatId,
      audio: item.audio,
      start: item.start,
      end: item.end,
    });
    if (res.cancelled) {
      item.status = 'cancelled';
    } else {
      item.status = 'done';
      item.filePath = res.filePath;
    }
  } catch (err) {
    item.status = 'error';
    item.error = cleanError(err);
  }
  running = false;
  processQueue();
}

api.onProgress((p) => {
  const item = queue.find((q) => q.status === 'active');
  if (!item) return;
  if (p.pct == null) {
    item.pct = null;
    item.stats = 'Downloading …';
  } else {
    item.pct = Math.max(0, Math.min(1, p.pct));
    const pct = item.pct * 100;
    item.stats = pct >= 99.5
      ? 'Finishing …'
      : [`${Math.floor(pct)}%`, fmtSpeed(p.speed), fmtEta(p.eta)].filter(Boolean).join(' · ');
  }
  updateActiveRow(item);
});

// ---------- Show the list ----------
function statusText(q) {
  switch (q.status) {
    case 'queued': return `Waiting · ${q.quality}${q.start ? ` · ${q.start}–${q.end}` : ''}`;
    case 'active': return q.stats;
    case 'done': return 'Done';
    case 'cancelled': return 'Cancelled';
    case 'error': return q.error || 'Error';
    default: return '';
  }
}

function renderQueue() {
  const list = $('q-list');
  list.innerHTML = '';
  for (const q of queue) {
    const li = document.createElement('li');
    li.className = `q-item ${q.status}`;
    li.dataset.key = q.key;

    const img = document.createElement('img');
    img.className = 'q-thumb';
    img.alt = '';
    img.src = q.vod.thumbnail || '';

    const body = document.createElement('div');
    body.className = 'q-body';
    const name = document.createElement('div');
    name.className = 'q-name';
    name.textContent = q.vod.title;
    name.title = q.vod.title;
    const bar = document.createElement('div');
    bar.className = 'bar' + (q.pct == null ? ' indeterminate' : '');
    const fill = document.createElement('div');
    fill.className = 'bar-fill';
    fill.style.width = q.pct == null ? '' : `${q.pct * 100}%`;
    bar.appendChild(fill);
    const status = document.createElement('div');
    status.className = 'q-status';
    status.textContent = statusText(q);
    body.append(name, bar, status);

    const btn = document.createElement('button');
    btn.className = 'q-btn';
    if (q.status === 'done') {
      btn.innerHTML = ICON_REVEAL;
      btn.title = isMac ? 'Show in Finder' : 'Show in Explorer';
      btn.onclick = () => api.reveal(q.filePath);
    } else if (q.status === 'active') {
      btn.innerHTML = ICON_X;
      btn.title = 'Cancel';
      btn.onclick = () => {
        q.stats = 'Cancelling …';
        updateActiveRow(q);
        api.cancel();
      };
    } else {
      btn.innerHTML = ICON_X;
      btn.title = 'Remove';
      btn.onclick = () => {
        queue.splice(queue.indexOf(q), 1);
        if (!queue.length) return goStart();
        renderQueue();
      };
    }

    li.append(img, body, btn);
    list.appendChild(li);
  }
  renderHeader();
}

function updateActiveRow(item) {
  const li = $('q-list').querySelector(`[data-key="${item.key}"]`);
  if (!li) return;
  const bar = li.querySelector('.bar');
  bar.classList.toggle('indeterminate', item.pct == null);
  li.querySelector('.bar-fill').style.width = item.pct == null ? '' : `${item.pct * 100}%`;
  li.querySelector('.q-status').textContent = item.stats;
  renderHeader();
}

function renderHeader() {
  const total = queue.length;
  const done = queue.filter((q) => q.status === 'done').length;
  const open = queue.filter((q) => q.status === 'queued' || q.status === 'active').length;
  const failed = queue.filter((q) => q.status === 'error').length;
  if (open) {
    $('q-title').textContent = 'Downloads';
    $('q-sub').textContent = `${done} of ${total} done${open > 1 ? ` · ${open - 1} in queue` : ''}`;
  } else {
    $('q-title').textContent = 'Done';
    $('q-sub').textContent = `${done} of ${total} done${failed ? ` · ${failed} failed` : ''}`;
  }
  updateStartLink();
}

$('q-add').addEventListener('click', goStart);
$('q-folder').addEventListener('click', () => {
  const last = [...queue].reverse().find((q) => q.filePath);
  api.reveal(last ? last.filePath : null);
});

init();
})();
