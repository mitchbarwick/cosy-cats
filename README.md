# Cosy Cats

A quiet-classroom helper. A cosy night-time library is shown on screen. While the room stays quiet, cats wander in one by one. Each one sniffs its chosen spot, turns a circle, kneads, then curls up on the bookshelf, window sill, armchair, mantel, pouf, hearth or rug. Once settled they doze, groom, yawn, play with the yarn and say hello to each other.

If the room gets noisy, nothing happens straight away. After a moment of steady noise, the cats look up and the bar says "The cats are listening…". If the noise carries on, the cat that has been there longest wakes, stretches and wanders off. It's never startled: the aim is that children want the cats back, not that they feel told off. A cough or a dropped pencil does nothing, and new cats only start arriving again once the room has been calm for a while.

## Run it

```bash
node server.js
```

Then open http://localhost:5173. The microphone needs `localhost` or https. You can also host the folder as static files on any https site. There's no build step and nothing to install.

## Controls

The ⚙ button (top right) opens the teacher controls:

- **Noise limit**: where the marker sits on the volume bar.
- **Mic sensitivity**: raise it if the bar barely moves, lower it if it's always high.
- **New cat every**: how many seconds of quiet it takes for a new visitor to arrive.
- **Too loud for**: how long the room has to stay over the limit before a cat wanders off. Cats look up after 1.5 s.
- **Lo-fi music / Cat sounds**: toggles.
- **Battery saver (30 fps)**: on by default, so an older laptop can run a full lesson quietly.
- **+ Add a cat / Send a cat home**: manual controls, for testing.

Settings are saved in the browser.

## How it's built

Everything is drawn with Canvas 2D and Web Audio. There are no image or sound files, apart from optional cat clips.

- `js/scene.js`: the room, which is pre-rendered once, plus the animated sky, fire, candles, fairy lights and a lighting pass.
- `js/catArt.js`: the procedural cat rig (poses, ten looks, accessories).
- `js/clipCat.js`: plays pre-rendered alpha video clips, in place of the rig, for any cat that has them.
- `js/cats.js`: behaviour (routes, jumps, resting, play, greetings, leaving).
- `js/audio.js`: mic loudness, synthesised meows, purrs and trills, and the generative lo-fi loop.
- `js/main.js`: the noise state machine (with hysteresis), the HUD, the parallax camera and the render loop.

A cat is drawn by the procedural rig unless it has a clip set in `assets/cats/<name>/`. [ASSETS.md](ASSETS.md) describes that pre-rendered route: a Blender-rendered video clip with alpha for each behaviour, composited over the baked room. Biscuit currently has a felt cat set rendered in Blender by `tools/blender/render.mjs`, posed from the rig.
