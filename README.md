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
- **Progressive loading.** The 2K image paints first, then the 4K master streams in on desktop, and neighbouring scenes are preloaded.

## Image enhancement

`tools/enhance.py` grades the raw captures in `source/panoramas/`. It applies levels, shadow lift and highlight roll-off, local contrast, vibrance and a warm balance. It also removes the camera/hand smear at the nadir and blends the wrap-around seam. Then it exports these renditions to `assets/pano/`:

- a 4096×2048 master
- a 2048×1024 version
- a thumbnail

```bash
python3 tools/enhance.py   # needs Pillow + NumPy
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
tools/enhance.py    photo grading pipeline
source/panoramas/   original captures
assets/pano/        graded renditions
```
