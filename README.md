# Cosy Cats

A quiet-time timer for the classroom. The teacher picks an activity and a length ("Quiet reading, 15 minutes") and a cosy night-time library appears on the projector. Over that time, while the room stays calm, ten cats wander in one by one. Each one sniffs its chosen spot, turns a circle, kneads, then curls up on the bookshelf, window sill, armchair, mantel, pouf, hearth or rug. If all ten are there for the final minute, one last visitor comes: **Toby**, a white French bulldog.

The session always ends when the teacher said it would. Noise never adds time; it decides how full the room is at the end.

- **Arrivals are front-loaded.** Cats come quickly at first and further apart later. In a 15-minute session the first gaps are under a minute and the last about two. Early on, mistakes are cheap; later, each visitor takes more focus to earn.
- **A cat only walks in while the room is calm.** If it's noisy when one is due, it waits for the room to settle.
- **Steady noise sends a cat home, gently.** After a moment of noise the cats look up ("The cats are listening…"). If it carries on, the cat that has been there longest wakes, stretches and wanders off. Its replacement is due one gap later: soon early in the session, a couple of minutes late on. A cough or a dropped pencil does nothing.
- **The room keeps time.** The night outside deepens over the session, the fire settles to embers near the end, and the fairy lights brighten for the last minute.
- **The ending is a reward.** A soft chime plays, every animal sits up and faces the room, hearts float up, and a card says who came. The animals then stay so the class can enjoy the room they filled.

## In class

- **Start**: pick a length (5, 10, 15, 20 or 30 minutes, or any length from 5 to 90), optionally name the activity, and press Start or Enter. Every session starts with an empty room.
- **Time left** shows in the bar, in whole minutes, next to a ring that fills over the session.
- **+1 / +5**: add time to a session that's going well, from the bar or from the end card.
- **⏸ Pause** (or the Space bar): for giving an instruction. The clock stops, nobody arrives or leaves, the music fades, and every animal sits up and turns to face the room until you press **▶ Resume**.
- **↩ Bring back**: when an animal wanders off, a button above the bar offers to bring it back for 30 seconds. Use it if a door slam sent a cat home unfairly.
- **New session**: from the end card or the bar once time is up. The room fades to empty and the picker returns.

## Run it

```bash
node server.js
```

Then open http://localhost:5173. The microphone needs `localhost` or https. You can also host the folder as static files on any https site. There's no build step and nothing to install.

## Settings

The ⚙ button (top right) opens the teacher controls:

- **Noise limit**: where the marker sits on the volume bar.
- **Mic sensitivity**: raise it if the bar barely moves, lower it if it's always high.
- **How strict**: Gentle, Normal or Strict sets how long the room can stay noisy before a cat wanders off (6, 4 or 2.6 seconds). Cats look up after 1.5 seconds.
- **Lo-fi music / Animal sounds / End chime**: toggles. The chime is on by default.
- **Battery saver (30 fps)**: on by default, so an older laptop can run a full lesson quietly.
- **End session now**, **Enable microphone** and **Fullscreen**.
- **Testing**: add a cat, send one home, or skip a minute.

Settings, the last length and the activity name are saved in the browser.

## How it's built

Everything is drawn with Canvas 2D and Web Audio, apart from the Blender-rendered room plates and animal clips.

- `js/session.js`: the session clock and the arrival schedule. Cat k of 10 is due at 30 s + (length − 90 s) × (k ÷ 10)^1.5; Toby is due in the final minute on a full house.
- `js/main.js`: the session picker, the noise state machine (with hysteresis), the HUD, the end card, the parallax camera and the render loop.
- `js/scene.js`: the room (rendered plates or the drawn fallback) plus the live sky, fire, candles, fairy lights and lighting, which also carry the session cues.
- `js/cats.js`: behaviour (routes, jumps, resting, play, greetings, leaving, pause and undo).
- `js/catArt.js`: the procedural rig (poses, ten cat looks, Toby, accessories).
- `js/clipCat.js`: plays pre-rendered alpha video clips, in place of the rig, for any animal that has them.
- `js/audio.js`: mic loudness, synthesised meows, purrs, Toby's snorts and snores, the end chime and the generative lo-fi loop.

All ten cats and Toby have felt clip sets in `assets/cats/<name>/`, rendered in Blender by `tools/blender/render.mjs` and posed from the rig. [ASSETS.md](ASSETS.md) describes the clip format. Safari can't show these clips with transparency yet, so it shows the drawn animals.
