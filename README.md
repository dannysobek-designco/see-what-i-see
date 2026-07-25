# See What I See — a Visual Snow Syndrome simulator

A web app that simulates the symptoms of Visual Snow Syndrome (VSS) so people
who have it can show others what they experience. Built around the published
diagnostic criteria (see [visualsnowinitiative.org](https://www.visualsnowinitiative.org)).

## What it does

- **Visual snow** — animated static across the whole field (intensity, density,
  dot size, flicker speed, mono or colored)
- **Palinopsia** — afterimages / trailing via a feedback buffer
- **Enhanced entoptic phenomena** — floaters, blue-field darting dots,
  photopsia light flashes
- **Photophobia** — glare bloom and washout veil
- **Halos & starbursts** around light sources
- **Nyctalopia** — impaired night vision (shadow detail collapses)
- **Double vision** and **pulsating vision**

Sources: four built-in demo scenes (a sunny mountain landscape, a night street
full of lights, a book page — photos by Soham Banerjee, H&CO, and Brett Jordan
on Unsplash, stored in `assets/` — and an **"Eyes closed"** scene, because the
snow doesn't stop when the eyes do), your own photo, or the **live camera**.
Still images slowly pan side to side so motion effects (trailing, ghosting)
are visible without a camera. A **VR view** renders side-by-side for a
phone-in-headset (Cardboard-style) experience.

Extras:
- Severity presets with smooth transitions, plus a persistent **"My VSS"**
  preset that remembers your custom settings between visits (localStorage)
- Press-and-hold **compare** and a draggable **split view** (typical vision
  on one side, VSS on the other)
- **Shareable links** — copy a URL that reproduces your exact settings
- Opt-in **tinnitus** audio (a thin high-pitched tone), since most people
  with VSS also live with ringing ears; a mute toggle appears on screen only
  while the tone is active
- A first-visit intro with a photosensitivity heads-up, followed by an
  optional guided walkthrough (replayable anytime from the footer) that
  spotlights each part of the UI — on every screen size
- A prominent "Adjust the vision" control on mobile so it's clear the panel
  is the first thing to open, plus a mobile-only "Live camera" entry that
  expands (Normal / VR) into empty space without shifting the row
- On a first mobile visit, once onboarding wraps up, a quick chooser asks
  whether to start the live camera or explore a sample scene
- PWA: installable to the home screen, works offline after first load,
  adaptive render resolution for slower phones

## Running it

It's a fully static site — no build step. Serve the folder over HTTP:

```
npx serve .
```

**Camera and VR on a phone require HTTPS**, so to use those, deploy it
(Netlify, Vercel, GitHub Pages, etc.) and open the URL on your phone.

## Tech

Plain HTML/CSS/JS + WebGL2. Two-pass shader pipeline: pass 1 applies
scene-space effects (ghosting, nyctalopia) and palinopsia trailing through a
ping-pong feedback buffer; pass 2 adds light effects (glare, halos — computed
from the mipmapped source so they can't feed back) and the overlay phenomena
(snow, floaters, blue-field dots, flashes), rendered once normally or twice
for the stereo VR view.

*This is an educational approximation, not a medical or diagnostic tool.
Everyone's VSS is different.*
