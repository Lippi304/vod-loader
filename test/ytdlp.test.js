const test = require('node:test');
const assert = require('node:assert/strict');
const { parseChannel, thumbTimestamp, recentOnly, normalizeUrl } = require('../lib/ytdlp');

test('parseChannel accepts names and channel links, rejects everything else', () => {
  assert.equal(parseChannel('papaplatte'), 'papaplatte');
  assert.equal(parseChannel('  https://www.twitch.tv/papaplatte/videos?filter=all '), 'papaplatte');
  assert.equal(parseChannel('twitch.tv/Papaplatte'), 'Papaplatte');
  assert.equal(parseChannel('m.twitch.tv/gronkh'), 'gronkh');
  assert.equal(parseChannel('@gronkh'), 'gronkh');
  assert.equal(parseChannel('hello world'), null);
  assert.equal(parseChannel('https://example.com/foo'), null);
  assert.equal(parseChannel('twitch.tv/gronkh/v/123456789'), null);
  assert.equal(parseChannel('ab'), null);
  assert.equal(parseChannel(''), null);
});

test('VOD links and IDs are not mistaken for channels', () => {
  for (const s of ['https://www.twitch.tv/videos/2914030937', 'twitch.tv/gronkh/v/2914030937', 'v2914030937', '2914030937']) {
    assert.ok(normalizeUrl(s), s);
  }
  assert.equal(normalizeUrl('papaplatte'), null);
});

test('thumbTimestamp reads the broadcast start from the thumbnail URL', () => {
  const url = 'https://static-cdn.jtvnw.net/cf_vods/d3stzm2eumvgb4/9dcf922a0d0e22024a7b_papaplatte_318173893091_1793291431//thumb/thumb0-320x180.jpg';
  assert.equal(thumbTimestamp(url), 1793291431);
  assert.equal(thumbTimestamp('https://example.com/thumb.jpg'), null);
  assert.equal(thumbTimestamp(undefined), null);
});

test('recentOnly keeps the last N days and VODs with an unknown date', () => {
  const now = 1_000_000_000;
  const day = 86400;
  const vods = [
    { id: 'new', timestamp: now - 1 * day },
    { id: 'edge', timestamp: now - 14 * day },
    { id: 'old', timestamp: now - 14 * day - 1 },
    { id: 'unknown', timestamp: null },
  ];
  assert.deepEqual(recentOnly(vods, 14, now).map((v) => v.id), ['new', 'edge', 'unknown']);
});

const { normalizeYouTube, parseYouTubeTime, linkTime, youTubeQualities, uploadDateToTs } = require('../lib/ytdlp');

test('normalizeYouTube accepts the usual link forms and reads the start time', () => {
  const id = 'ANoZNWQXYZ4';
  const url = `https://www.youtube.com/watch?v=${id}`;
  assert.deepEqual(normalizeYouTube(`https://youtu.be/${id}?is=SXOqvyqQHr9M081m`), { url, id, t: null });
  assert.deepEqual(normalizeYouTube(`https://youtu.be/${id}?t=3938`), { url, id, t: 3938 });
  assert.deepEqual(normalizeYouTube(`youtube.com/watch?v=${id}&t=1h5m38s`), { url, id, t: 3938 });
  assert.deepEqual(normalizeYouTube(`https://m.youtube.com/watch?feature=share&v=${id}&t=95s`), { url, id, t: 95 });
  assert.equal(normalizeYouTube(`https://www.youtube.com/shorts/${id}`).id, id);
  assert.equal(normalizeYouTube(`https://www.youtube.com/live/${id}?si=abc`).id, id);
  assert.equal(normalizeYouTube('https://www.youtube.com/@core'), null);
  assert.equal(normalizeYouTube('https://www.twitch.tv/videos/2914030937'), null);
  assert.equal(normalizeYouTube('papaplatte'), null);
  assert.equal(normalizeYouTube(''), null);
});

test('YouTube links are not mistaken for Twitch VODs or channels', () => {
  assert.equal(normalizeUrl('https://youtu.be/ANoZNWQXYZ4'), null);
  assert.equal(parseChannel('https://youtu.be/ANoZNWQXYZ4'), null);
});

test('parseYouTubeTime and linkTime read start times', () => {
  assert.equal(parseYouTubeTime('95'), 95);
  assert.equal(parseYouTubeTime('95s'), 95);
  assert.equal(parseYouTubeTime('2m'), 120);
  assert.equal(parseYouTubeTime('1h2m3s'), 3723);
  assert.equal(parseYouTubeTime('abc'), null);
  assert.equal(parseYouTubeTime(''), null);
  assert.equal(linkTime('https://www.twitch.tv/videos/2914030937?t=1h2m3s'), 3723);
  assert.equal(linkTime('https://www.twitch.tv/videos/2914030937'), null);
});

test('youTubeQualities offers sensible steps plus audio, H.264 first', () => {
  const formats = [
    { format_id: '140', vcodec: 'none', acodec: 'mp4a' },
    { format_id: '137', vcodec: 'avc1.640028', height: 1080 },
    { format_id: '136', vcodec: 'avc1.4d401f', height: 720 },
    { format_id: '247', vcodec: 'vp9', height: 720 },
    { format_id: '18', vcodec: 'avc1', acodec: 'mp4a', height: 360 },
  ];
  const q = youTubeQualities(formats);
  assert.deepEqual(q.map((x) => x.label), ['1080p', '720p', '480p', '360p', 'Audio only']);
  assert.match(q[0].id, /^bv\*\[height<=1080\]\[vcodec\^=avc1\]\+ba\[ext=m4a\]/);
  assert.ok(q.at(-1).audio);
});

test('uploadDateToTs turns YYYYMMDD into a timestamp', () => {
  assert.equal(new Date(uploadDateToTs('20261108') * 1000).toISOString().slice(0, 10), '2026-11-08');
  assert.equal(uploadDateToTs(undefined), null);
});
