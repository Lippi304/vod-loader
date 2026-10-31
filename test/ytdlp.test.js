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
