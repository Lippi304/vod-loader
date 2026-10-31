// Helpers for installing from the DMG: find the disk image the app was started from,
// eject it and tell which .dmg file may be thrown away afterwards.
const path = require('path');
const { execFile, execFileSync } = require('child_process');

// "/Volumes/VOD Loader/VOD Loader.app/Contents/MacOS/VOD Loader" -> "/Volumes/VOD Loader"
function volumeOf(exePath) {
  const m = String(exePath).match(/^(\/Volumes\/[^/]+)\//);
  return m ? m[1] : null;
}

// Mounted disk images as `hdiutil info -plist` reports them, converted to an object.
function mountedImages() {
  const plist = execFileSync('hdiutil', ['info', '-plist'], { encoding: 'utf8' });
  return JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist, encoding: 'utf8' }));
}

// The .dmg file behind a mounted volume, or null.
function dmgForVolume(info, volume) {
  const image = (info.images || []).find((i) => (i['system-entities'] || []).some((e) => e['mount-point'] === volume));
  return image ? image['image-path'] : null;
}

// Only our own installer is ever moved to the Trash, never some other disk image.
function isOurInstaller(file) {
  return /^VOD.Loader.*\.dmg$/i.test(path.basename(String(file)));
}

function eject(volume) {
  return new Promise((resolve) => execFile('hdiutil', ['detach', volume], (err) => resolve(!err)));
}

module.exports = { volumeOf, mountedImages, dmgForVolume, isOurInstaller, eject };
