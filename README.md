# VOD Loader

Twitch-VODs laden. Einfach. Link einfügen, Qualität wählen, fertig.

Läuft auf **macOS (Apple Silicon)** und **Windows**. Unter der Haube arbeiten
[yt-dlp](https://github.com/yt-dlp/yt-dlp) (lädt das VOD) und ffmpeg (setzt es zur MP4 zusammen).

## Funktionen

- Link einfügen → Vorschaubild, Titel, Kanal, Länge
- Qualität wählen (z. B. 1080p60, 720p60 … oder nur Audio)
- Optional nur einen Ausschnitt laden (Von / Bis)
- Speicherort wählen (wird gemerkt, Standard: Downloads)
- Fortschritt mit Geschwindigkeit und Restzeit, Abbrechen jederzeit möglich
- Hell- und Dunkelmodus automatisch nach System

## Direkt starten (ohne Installation)

Voraussetzung: [Node.js](https://nodejs.org) 20 oder neuer.

```bash
npm install
npm start
```

Beim ersten Start lädt die App yt-dlp einmalig herunter (ca. 35 MB) und hält es danach
selbstständig aktuell.

## Installierbare App bauen

**Variante A, lokal:** auf dem jeweiligen System

```bash
npm install
npm run dist
```

Das Ergebnis liegt in `dist/` (`.dmg` auf dem Mac, `.exe` unter Windows).
Mac-Builds gehen nur auf einem Mac, Windows-Builds nur unter Windows.

**Variante B, über GitHub (beide auf einmal):**
Repo auf GitHub hochladen → Tab **Actions** → **Build** → **Run workflow**.
Nach ein paar Minuten liegen DMG und EXE unten bei *Artifacts* zum Download.
Alternativ startet der Build automatisch bei einem Tag wie `v1.0.0`.

## Erster Start: Sicherheitswarnung

Die App ist nicht bei Apple bzw. Microsoft signiert (das kostet Geld). Deshalb:

- **Mac:** App in *Programme* ziehen. Wenn macOS sie blockiert: *Systemeinstellungen →
  Datenschutz & Sicherheit → „Dennoch öffnen“*. Falls „beschädigt“ angezeigt wird, einmal im Terminal:
  `xattr -dr com.apple.quarantine "/Applications/VOD Loader.app"`
- **Windows:** Bei SmartScreen auf *Weitere Informationen → Trotzdem ausführen* klicken.

## Grenzen

- VODs nur für Abonnenten werden nicht unterstützt (dafür wäre ein Twitch-Login nötig).
- Nur VODs, keine Clips und kein Chat. Das ist so gewollt.
- Mac-Build nur für Apple Silicon (M1 und neuer).

## Lizenz

MIT
