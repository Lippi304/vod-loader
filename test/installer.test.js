const test = require('node:test');
const assert = require('node:assert/strict');
const { volumeOf, dmgForVolume, isOurInstaller } = require('../lib/installer');

test('volumeOf finds the disk image volume an app runs from', () => {
  assert.equal(volumeOf('/Volumes/VOD Loader/VOD Loader.app/Contents/MacOS/VOD Loader'), '/Volumes/VOD Loader');
  assert.equal(volumeOf('/Volumes/VOD Loader 1/VOD Loader.app/Contents/MacOS/VOD Loader'), '/Volumes/VOD Loader 1');
  assert.equal(volumeOf('/Applications/VOD Loader.app/Contents/MacOS/VOD Loader'), null);
  assert.equal(volumeOf('/Users/me/Downloads/VOD Loader.app/Contents/MacOS/VOD Loader'), null);
});

test('dmgForVolume picks the image mounted at the volume', () => {
  const info = {
    images: [
      { 'image-path': '/Users/me/Downloads/Other.dmg', 'system-entities': [{ 'mount-point': '/Volumes/Other' }] },
      { 'image-path': '/Users/me/Downloads/VOD-Loader-1.2.0-arm64.dmg', 'system-entities': [{ 'dev-entry': '/dev/disk4' }, { 'mount-point': '/Volumes/VOD Loader' }] },
    ],
  };
  assert.equal(dmgForVolume(info, '/Volumes/VOD Loader'), '/Users/me/Downloads/VOD-Loader-1.2.0-arm64.dmg');
  assert.equal(dmgForVolume(info, '/Volumes/Nope'), null);
  assert.equal(dmgForVolume({}, '/Volumes/VOD Loader'), null);
});

test('only our own installer may be thrown away', () => {
  assert.ok(isOurInstaller('/Users/me/Downloads/VOD-Loader-1.2.0-arm64.dmg'));
  assert.ok(isOurInstaller('/Users/me/Downloads/VOD-Loader-1.2.0-arm64 (1).dmg'));
  assert.ok(isOurInstaller('/Users/me/Downloads/VOD Loader.dmg'));
  assert.ok(!isOurInstaller('/Users/me/Downloads/Holiday-Photos.dmg'));
  assert.ok(!isOurInstaller('/Users/me/Documents/VOD-Loader-notes.txt'));
});
