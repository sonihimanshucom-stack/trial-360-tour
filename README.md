# Radisson Blu Udaipur — 360° Virtual Tour

An immersive, dependency-free 360° tour of Radisson Blu Udaipur Palace Resort & Spa, built on a custom WebGL2 renderer.

**Scenes:** Arrival Court · Palace Drive · Grand Lawn · Jharokha Courtyard · Ballroom

## Features

- **Little-planet intro.** The tour opens on a spinning stereographic "tiny planet" that unfolds into the normal view. There's also a toggle to switch any scene back to the planet view.
- **Seamless walk-through transitions.** The camera turns toward the hotspot, then dollies forward with a radial motion blur while the next panorama fades in, already facing the way you walked.
- **Gyroscope / motion control** on phones and tablets, including the iOS permission prompt and a smoothed sensor feed.
- **Hotspots.** Navigation hotspots show a preview of the destination; info hotspots open a story panel.
- **Guided tour mode** with auto-rotation and per-scene progress.
- **Live resort map** with a view cone that follows where you're looking.
- **Inertial drag**, pinch and wheel zoom, keyboard controls (arrows, `+`/`-`, `[`/`]`), fullscreen, share, and deep links (`#courtyard`).
- **Preloading** of neighbouring scenes so walking between them is instant.

## Photos

The panoramas are the original camera files, unedited. `assets/pano/<name>.jpg` is a byte-for-byte copy of `source/panoramas/<name>.jpg`. `tools/thumbs.py` copies them across and makes the small scene-card thumbnails:

```bash
python3 tools/thumbs.py   # needs Pillow
```

## Run locally

It's a static site, so any web server works:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

Add `?debug` to the URL and click anywhere to log yaw/pitch, which helps when placing new hotspots in `js/tour-data.js`.

## Deploy

`.github/workflows/pages.yml` publishes the site to GitHub Pages on every push to `main`. Turn it on under *Settings → Pages → Source: GitHub Actions*.

## Structure

```
index.html          markup & UI shell
css/style.css       design system
js/viewer.js        WebGL2 panorama engine (projection, transitions, gyro, input)
js/tour.js          tour controller (hotspots, dock, map, guided mode)
js/tour-data.js     scenes, hotspots and copy
tools/thumbs.py     thumbnail generator
source/panoramas/   original captures
assets/pano/        panoramas served to the viewer (unedited) + thumbnails
```
