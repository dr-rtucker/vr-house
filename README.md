# VR House

Three WebXR scenes built on three.js, meant to be viewed on a phone in a Cardboard
viewer. No build step, no dependencies, no server-side anything — it is a folder of
static files.

| page               | scene                     |
|--------------------|---------------------------|
| `house.html`       | two-storey walkable house |
| `living-room.html` | single room               |
| `index.html`       | grass field + monolith    |

## Viewing it

Live at **https://www.rileytucker.com/vr-house/house.html**

Because that is real HTTPS, WebXR works with no browser flags. On the phone, use
Chrome's *Add to Home Screen* — a service worker precaches every file, so after one
load the house runs with no network at all.

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
