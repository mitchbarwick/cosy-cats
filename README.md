# Cosy Cats

A quiet-time timer for the classroom. The teacher picks an activity and a length ("Quiet reading, 15 minutes") and a cosy night-time library appears on the projector. Over that time, while the room stays calm, ten cats wander in one by one. Each one sniffs its chosen spot, turns a circle, kneads, then curls up on the bookshelf, window sill, armchair, mantel, pouf, hearth or rug. If all ten are there for the final minute, one last visitor comes: **Toby**, a white French bulldog.

The clock always runs out when the teacher said it would. Noise never adds time; it decides how full the room is at the end. When time is up the rules carry on until the teacher presses **End session**, so the room stays quiet until the teacher is ready.

There are two scenes, chosen in the teacher controls: the **cosy library** at night and a **sunny park** with a shady tree, a bench and a playground.

- **Arrivals are front-loaded.** Cats come quickly at first and further apart later. In a 15-minute session the first gaps are under a minute and the last about two. Early on, mistakes are cheap; later, each visitor takes more focus to earn.
- **A cat only walks in while the room is calm.** If it's noisy when one is due, it waits for the room to settle.
- **Steady noise sends a cat home, gently.** After a moment of noise the cats look up, and the cat that has been there longest shows a thought bubble with a loudness symbol, with a soft two-note cue. The symbol gains waves and turns from amber to red as the cat gets closer to going. If the noise carries on, that cat wakes, stretches and wanders off under a bubble with a paw print and an arrow. The bubbles are still pictures: they tell the class a consequence is close, and are nothing to set off for fun. Its replacement is due one gap later: soon early in the session, a couple of minutes late on. A cough or a dropped pencil does nothing.
- **The room keeps time.** In the library the night outside deepens, the fire settles to embers near the end, and the fairy lights brighten for the last minute. In the park the sun sinks and the light turns golden, and the lamp and the first fireflies come on for the last minute.
- **Time's up is not the end.** A soft chime plays and a note asks the class to stay quiet until the teacher says. Cats still leave a noisy room and still come back to a calm one.
- **The ending is the teacher's.** On **End session**, every animal that stayed sits up and faces the room, hearts float up, and a card says who stayed to the end.

## In class

- **Start**: pick a length (5, 10, 15, 20 or 30 minutes, or any length from 5 to 90), optionally name the activity, choose the library or the park, and press Start or Enter. The room behind the card changes as you pick, and your choice is remembered. Every session starts with an empty room.
- **Time left** shows in the bar, in whole minutes, next to a ring that fills over the session.
- **+1 / +5**: add time to a session that's going well, from the bar (also once time is up).
- **End session**: appears in the bar when time is up. It ends the quiet time and shows who stayed.
- **⏸ Pause** (or the Space bar): for giving an instruction. The clock stops, nobody arrives or leaves, the music fades, and every animal sits up and turns to face the room until you press **▶ Resume**.
- **↩ Bring back**: when an animal wanders off, a button above the bar offers to bring it back for 30 seconds. Use it if a door slam sent a cat home unfairly.
- **New session**: from the end card or the bar once the session has ended. The room fades to empty and the picker returns.

## Run it

```bash
node server.js
```

Then open http://localhost:5173. The microphone needs `localhost` or https. You can also host the folder as static files on any https site. There's no build step and nothing to install.

## Settings

The ⚙ button (top right) opens the teacher controls:

- **Scene**: the cosy library or the sunny park (also on the setup card). A change made during a session takes effect at the next one.
- **Noise limit**: where the marker sits on the volume bar.
- **Mic sensitivity**: raise it if the bar barely moves, lower it if it's always high.
- **How strict**: Gentle, Normal or Strict sets how long the room can stay noisy before a cat wanders off (6, 4 or 2.6 seconds). Cats look up after 1.5 seconds.
- **Lo-fi music / Animal sounds / Warning sound / End chime**: toggles. The warning sound is the cue that a cat is about to leave; the chime marks time's up.
- **Battery saver (30 fps)**: on by default, so an older laptop can run a full lesson quietly.
- **End session now** (ends it straight away, at any point), **Enable microphone** and **Fullscreen**.
- **Testing**: add a cat, send one home, or skip a minute.

Settings, the last length and the activity name are saved in the browser.

## How it's built

Everything is drawn with Canvas 2D and Web Audio, apart from the Blender-rendered room plates and animal clips.

- `js/session.js`: the session clock and the arrival schedule. Cat k of 10 is due at 30 s + (length − 90 s) × (k ÷ 10)^1.5; Toby is due in the final minute on a full house.
- `js/main.js`: the session picker, the noise state machine (with hysteresis), the HUD, the end card, the parallax camera and the render loop.
- `js/scene.js`: the library (rendered plates or the drawn fallback) plus the live sky, fire, candles, fairy lights and lighting, which also carry the session cues. It also switches between scenes.
- `js/park.js`: the park: its spots, the rendered plates and props (or the drawn fallback), and the live sun, evening light, lamp, string lights and fireflies. The plates in `assets/park/` are rendered in Blender by `node tools/blender/park.mjs` (`tools/blender/felt_park.py`), with the library's camera and felt materials.
- `js/cats.js`: behaviour (routes, jumps, resting, play, greetings, leaving, pause and undo).
- `js/catArt.js`: the procedural rig (poses, ten cat looks, Toby, accessories).
- `js/clipCat.js`: plays pre-rendered alpha video clips, in place of the rig, for any animal that has them.
- `js/audio.js`: mic loudness, synthesised meows, purrs, Toby's snorts and snores, the end chime and the background music (`assets/music/rainy-window-study.mp3`, crossfaded back to the top just before its fade-out so it loops for any session length).

All ten cats and Toby have felt clip sets in `assets/cats/<name>/`, rendered in Blender by `tools/blender/render.mjs` and posed from the rig. [ASSETS.md](ASSETS.md) describes the clip format. Safari can't show these clips with transparency yet, so it shows the drawn animals.
