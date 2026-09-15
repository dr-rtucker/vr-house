# VR House

Three WebXR scenes built on three.js, meant to be viewed on a phone in a Cardboard
viewer. No build step, no dependencies, no server-side anything — it is a folder of
static files.

| page               | scene                     |
|--------------------|---------------------------|
| `house.html`       | two-storey walkable house |
| `living-room.html` | single room               |
| `index.html`       | grass field + monolith    |
| `study.html`       | fixed-viewpoint psych study (Cardboard) |
| `vantage.html`     | one standing spot in the house, look around only (Cardboard or flat) |
| `office.html`      | a real office rebuilt from a phone video; stand in the middle and look around |
| `samila.html`      | generative Samila shapes as glitching 3D point clouds (Cardboard or flat) |

`scene-house.js` holds the house geometry, materials and lighting. `house.html`,
`study.html` and `vantage.html` all import it, so the walkthrough and the study render the
identical scene — if those two ever drift, differences between study conditions
stop being interpretable.

## Viewing it

Live at **https://www.rileytucker.com/vr-house/house.html**

Because that is real HTTPS, WebXR works with no browser flags **on a real headset**.
It does not work in a Cardboard viewer: Chrome for Android retired phone-based VR,
so `isSessionSupported('immersive-vr')` returns false on a phone and the "Enter VR"
button reports *VR not available here*. `study.html` therefore does not use WebXR at
all — it renders side-by-side stereo itself with `THREE.StereoCamera` and takes head
orientation from `deviceorientation`.

On the phone, use Chrome's *Add to Home Screen* — a service worker precaches every
file, so after one load the house runs with no network at all.

On a laptop it is WASD + mouse, which is the fastest way to check a change.

## Working on it locally

    ../scripts/04_serve_vr.sh

`localhost` is already a secure context, so no flags are needed there either.

## Deploying a change

Push to `main`; GitHub Pages publishes from the repository root.

**Bump `CACHE` in `sw.js` every time you deploy.** The service worker is
deliberately cache-first so the scenes load offline, which also means a phone that
has already installed the app will keep serving the old files until that version
string changes.


## The vantage demo (`vantage.html`)

Puts you at a single spot — just inside the living-room doorway, facing down the
room — and lets you look around without moving. Same stereo + `deviceorientation`
approach as the study, minus trials and data.

* **Cardboard viewer** — side-by-side stereo, fullscreen, landscape. The viewer's
  button re-centres yaw on whatever is in front of you. Back gesture exits.
* **Just the screen** — flat view; move the phone to look, tap to re-centre, or
  drag with a mouse on a laptop.
* The spot is `VANTAGE` at the top of the script. Dev flags: `?at=x,y,z`, `?yaw=`,
  `?start=mono|stereo` (skip the menu), `?look=yaw,pitch` (turn the head, for
  screenshots).

## The office (`office.html`)

A real room from a ~20 s phone video of walking round it. The room is a box
fitted to the walls and floor, each face textured from the video frames; you stand
at the middle of the box, at the height the video was shot from. Same viewer
controls and dev flags as the vantage demo (`?at=x,y,z`, `?yaw=`, `?start=`, `?look=`).

The room lives in `rooms/office/` — `room.json` (box size, the vantage, and each
face's position) plus one JPEG per face. It is built outside this repo by
`../scripts/05_room_sfm.py` (COLMAP structure-from-motion: where the phone was for
each frame) then `../scripts/06_room_box.py` (level, scale, fit the box, texture it).
The source video is not committed (`*.mp4` is gitignored).

What a box can't do: furniture is painted onto the walls and floor rather than
standing in the room, so it looks right from the vantage and only there — which is
why you can't walk. Nobody filmed the ceiling, so it is a flat tone.

## The Samila shapes (`samila.html`)

Five generative shapes (Samila `GenerativeImage`, then a glitch and pixel-sort pass)
recomputed in the browser as point clouds of ~400k points each — no data files. Depth
is the formula's own input grid, so straight on each shape is the original picture.
The glitch is the band shift from `glitch_this`, redone live as sliding slabs, on
noise-driven timing rather than a fixed beat. Same Cardboard / flat viewer as the vantage demo;
hold to move to the next shape.

Dev flags: `?shape=1..5`, `&place=front|inside`, `&start=mono|stereo`, `&t=`, `&seed=`,
`&look=yaw,pitch`, `&glitch=0..1`, `&freeze`. `?record&loop=S` is for rendering a
seamless wallpaper loop with `../scripts/08_render_samila_loop.py` and does nothing
useful on the live site.

## The study (`study.html`)

Fixed-viewpoint trials in a Cardboard viewer. The participant cannot move; they
press the viewer's one button when they would run away, and the press is recorded.

* **Stations** — one per room, in `STATIONS`. Position is the feet; the eye sits
  `EYE` above it.
* **Trial** — fade to black, reposition, re-zero yaw, fade in (**t=0 is the moment
  fade-in completes**), then press or time out, then the "run away" text, then a
  jittered gap. Order is block-randomised per participant from a seed derived from
  the participant ID, and the seed is stored with every row.
* **Yaw recentring** — every trial re-zeros yaw so the intended view is dead ahead
  whichever way the participant happens to be sitting. Yaw only: offsetting pitch
  or roll tilts the horizon away from gravity and makes people sick. Pitch at
  response is logged instead, as a QC column.
* **Timing** — RT comes from the `pointerdown` event timestamp, not from the render
  loop, so it survives the frame-rate drop as the phone heats up in the viewer.
  Head orientation is sampled per frame; `fps` is logged per trial so throttling is
  visible in the data.
* **Data** — IndexedDB, exported as two CSVs (one row per trial, one per head
  sample). Nothing is sent anywhere; the phone can stay in airplane mode.

Dev flags: `?mono` flat render, `?mouse` drag to look, `?stats` fps/state readout,
`?demo=N` jump straight to station N, `&label` pin the response text on. For
checking framing on a laptop: `study.html?demo=2&mono`.

**On iPhone the study must be launched from the home-screen icon**, not from a
Safari tab. iPhone Safari has no Fullscreen API, so the browser chrome stays on
screen and breaks the stereo framing; installing it via *Add to Home Screen* runs it
standalone. Motion access also needs granting on the first tap — if it is refused,
Settings > Safari > Motion & Orientation Access.
