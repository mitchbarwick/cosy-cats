# Cat clip spec (for pre-rendered cats)

By default the cats are drawn live by a procedural rig ([js/catArt.js](js/catArt.js)). For the felt-diorama look, each cat's behaviours can instead be rendered in Blender and played back as video clips with alpha, composited over the same baked room. [js/clipCat.js](js/clipCat.js) does the playback: a cat whose folder `assets/cats/<name>/` has a `manifest.json` plays its clips, and every other cat keeps the rig. Behaviour logic in [js/cats.js](js/cats.js) doesn't change. The renderer reads the cat's pose and current move (walking, a jump phase, circling) and picks the clip.

All ten cats in `assets/cats/` have a set rendered in Blender by [tools/blender](tools/blender/): a procedural felt cat in each cat's own colours, markings and accessory, posed frame by frame from the rig's own poses. The sets are a working stand-in for hand-made art, and an artist's renders can replace them file for file.

## Clips per cat

| Clip | Loop? | Length | What happens |
|---|---|---|---|
| `walk` | loop | 1 stride cycle (~0.9 s) | Unhurried walk, side-on. Tail up and relaxed. Playback speed follows the cat's ground speed (see `walkSpeed`). |
| `stand` | loop | ~3 s | Standing still between moves: breathing, tail sway, a blink. |
| `sniff` | loop | ~1.5 s | Stops, nose down, small head movements. |
| `turn` | once | ~0.6 s | 180° turn on the spot, passing through face-on. |
| `circle` | once | ~2.5 s | A full turn round on the spot before lying down. Starts and ends facing the same way. |
| `knead` | loop | ~1 s | Front paws alternately press the cushion. Eyes half-closed. |
| `settle` | once | ~1.5 s | Knead to loaf: folds paws in and lowers down. |
| `loaf` | loop | ~4 s | Breathing, occasional slow blink and tail-tip twitch. |
| `sleepLoop` | loop | ~6 s | Curled up, slow breathing. Seamless loop. |
| `wake` | once | ~2 s | Lifts head, eyes open slowly. |
| `yawn` | once | ~1.6 s | Big yawn with head tilted back. |
| `sit` | loop | ~4 s | Upright sit. Looks around a little. |
| `groom` | loop | ~2 s | Licks a paw and wipes the face. |
| `alert` | once, then hold | ~0.8 s | Ear flick, then head up with ears forward ("what was that?"). |
| `stretch` | once | ~2 s | Play-bow stretch, rump up and front paws forward. Used before leaving. |
| `crouch` | once | ~0.7 s | Wind-up before a jump, with a little bottom wiggle. Also held while stalking the yarn. |
| `jump` | once | ~0.6 s | Airborne. The arc is moved in code, so render in place. |
| `land` | once | ~0.35 s | Soft landing squash, ending in `stand`. |
| `bat` | once | ~0.5 s | Paw swipe at the yarn. |
| `nuzzle` | loop | ~2 s | Head pushed forward and eyes closed, for greeting another cat. |
| `attend` | once | ~0.8 s | Sits up tall and turns to face the camera, ears up. Played when the teacher pauses, and backwards on resume. |
| `attendLoop` | loop | ~3 s | Sitting face-on, paying attention: breathing, a blink, a small head tilt. |

Leaving is built from these clips, not one dedicated clip: `wake → yawn → alert → stretch → walk`. The tone is unbothered, never startled.

**Toby** (the French bulldog, `assets/cats/toby/`) uses the same clip list. `felt_cat.py` builds him when the def has `species: 'dog'`, with a broad skull, jowls, a flat muzzle, a black nose, bat ears and no whiskers. `shapeFor()` in `catArt.js` gives him a stocky body and a stub tail in both the rig and the exported poses. He has no `knead` or `groom` in practice, because the behaviour code never asks a dog for them.

### How the game uses them

- **Required:** `walk`, `stand`, `sit`, `loaf` and `sleepLoop`. Without any of these the cat stays on the rig. Other missing clips fall back to a near neighbour, for example `groom` → `sit` and `crouch` → `stand`. A missing `turn`, `circle` or `settle` is skipped.
- **Seams:** consecutive clips cross-dissolve over 0.22 s, so small pose differences at a seam don't pop. They still look best when each one-shot clip ends on the first frame of the loop that usually follows it: `settle` → `loaf`, `land` → `stand`, `turn` → `stand`, `stretch` → `stand`, `yawn` → `sit`.
- **Bridges:** `settle` plays automatically between `knead` and `loaf`.
- **Resting:** `wake` does three jobs, so it should start on `sleepLoop`'s first frame and end on `loaf`'s.
  - Played forwards, it's waking up.
  - Stepped backwards from 80 % in, it's dozing off (`loaf` or `settle` → `sleepLoop`): the head lowers and the eyes close.
  - Its last 28 % (eyelids half down, ear flick) is a loafing cat's occasional ear flick.

  `loaf` and `sleepLoop` play at a slightly different pace each time round (0.84–1× and 0.72–0.9×), so the breathing never ticks like a metronome. Changes between resting poses dissolve over 0.45 s rather than 0.22 s.
- **Timing:** `crouch`, `jump` and `land` are sped up or slowed down to fill each jump's wind-up, air time and landing exactly. Holds longer than a one-shot clip freeze on its last frame.
- **Turning:** when a standing or walking cat changes direction, `turn` plays, mirrored as needed, and the next clip faces the new way. During a jump the facing just flips under the cross-dissolve.

## Render settings

- **Camera:** orthographic, side-on with a slight 3/4 view. Use the same camera for every clip.
- **Frame:** 512 × 448, which covers the jump stretch and an upright tail. Frame rate 24 fps, or 12 fps on twos for a stop-motion feel.
- **Anchor:** the cat's feet (ground contact point) at pixel **(256, 416)**, bottom-centre with 32 px spare below for paws and tail. Clips are positioned in code by that point, and the soft contact shadow is drawn in code, so don't render one.
- **Scale:** 1.5 px per rig unit for a size-1.0 cat. A sitting cat is about 230 px from feet to ear tips, and the walk stride is about 84 px per cycle. Render every cat at this one scale: the game applies each cat's `size` from `CAT_DEFS`.
- **Facing:** right. Code mirrors the clip for left-facing, so keep markings symmetrical or render both directions.
- **Lighting:** neutral, soft key from the upper left. Room colour is applied in code from the baked light map.
- **Formats:**
  - WebM VP9 with alpha (Chrome, Edge, Firefox): `ffmpeg -framerate 24 -i frames/%04d.png -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 32 -auto-alt-ref 0 clip.webm`
  - HEVC with alpha in .mov (Safari): export from Blender or Compressor with "Preserve alpha".
- **Loops:** render one whole cycle with no repeated frame. The frame after the last should be the first, so in Blender set the end frame to cycle length − 1. Repeating the first frame at the end makes the loop hitch.
- **Naming:** `assets/cats/<name>/<clip>.webm` and `.mov`, where `<name>` is the cat's name in lower case with spaces as hyphens (`biscuit`, `earl-grey`). Example: `assets/cats/biscuit/sleepLoop.webm`.

### manifest.json

Each cat folder needs a `manifest.json`. This file is what makes the game use clips for that cat:

```json
{
  "version": 1,
  "frame": [512, 448],
  "anchor": [256, 416],
  "pxPerUnit": 1.5,
  "fps": 24,
  "walkSpeed": 55.92,
  "formats": ["webm", "mov"],
  "clips": {
    "walk": { "frames": 24, "loop": true },
    "turn": { "frames": 15 }
  }
}
```

- `walkSpeed` is how far the cat travels per second at 1× playback, in rig units: stride length ÷ cycle length ÷ `pxPerUnit`. The game scales `walk` playback to match the cat's real ground speed, so the paws don't skate.
- `formats` lists the containers present. Safari uses `.mov` (HEVC with alpha, because Safari drops VP9 alpha). Everything else uses `.webm`. If the browser's format isn't listed, that cat uses the rig.
- `clips` lists each clip with its frame count and `"loop": true` for loops. Clips can have their own `fps`.

The game loads each set into memory once at startup, about 1–2 MB per cat as VP9. For testing, `?clips=off` forces the rig for every cat and `?clipset=biscuit` gives every cat Biscuit's clips.

### Blender felt cats (tools/blender)

```bash
node tools/blender/render.mjs biscuit
```

This renders all 20 clips for one cat and installs them, with the manifest, in `assets/cats/<name>/`. On an RTX 2060 Super it takes 10–16 minutes per cat: longhairs and patched coats are the slowest. A set comes to 1.2–2.0 MB, with the longhairs the largest. Add a comma-separated list after the name to re-render only some clips, for example `node tools/blender/render.mjs biscuit walk,turn`. It needs Blender 5.2 (`winget install BlenderFoundation.Blender`) and ffmpeg; set `BLENDER` or `FFMPEG` if they aren't found.

- `export-poses.mjs` samples every clip in [tools/clip-maker/clips.js](tools/clip-maker/clips.js) to JSON: the rig pose, blink, look, ear flick, alert and a 3D yaw for `turn`/`circle`. Timing, anchor and scale are shared with the game, so the clips line up with no hand alignment.
- `felt_cat.py` builds the cat in Blender:
  - The body, haunch, chest and neck are metaballs, so they merge like needle-felted wool. The legs are a second metaball family.
  - A dithered, see-through fuzz shell gives the soft fibre halo, and wool mottling and a fibre bump give the surface.
  - The head turns toward the camera, with glossy eyes, thread whiskers, ears that flick and perk, and a bezier tail.
  - Each frame is posed from the JSON and rendered with Eevee through the spec's orthographic camera, which is set so the feet land on (256, 416).
- Colours, markings and accessories come from `CAT_DEFS`, so all ten cats render with their own look. Markings are soft colour patches: each one is an empty that the wool shaders read as a region. Body patches are the rig's own 2D ellipses from [js/catArt.js](js/catArt.js), recomputed from the pose each frame and pushed through the body's depth, so they stay on their body part instead of swimming through the wool. The supported patterns are:

  | Pattern | Cats | What's modelled |
  |---|---|---|
  | `tabby`, `tabbyLong` | Biscuit, Toffee, Earl Grey | Wavy stripes on the body and tail, appliqué brow and cheek stripes, and a pale muzzle. `tabbyLong` has fainter stripes. |
  | `tux` | Pepper | A white bib and belly, a white muzzle and chin rising to a point between the eyes, white socks and a white tail tip. |
  | `calico` | Clover | Orange and dark patches on the haunch, back and head, one ear of each colour, and an orange tail with a dark tip. |
  | `tortie` | Pumpkin | The rig's seeded mottle blobs (`mottle()` in catArt.js, exported with the poses), a split orange face with a blaze, and a fleck on the tail. |
  | `siamese` | Juniper | A dark face mask, dark ears and tail, legs that shade down to dark feet, and a dusky rump. |
  | `longhair`, `tabbyLong` | Mochi, Earl Grey | A thicker fuzz shell plus a second, sparser halo, a pale chest ruff, cheek tufts, and a tail that's 1.6× thicker with its own halo. |
  | `solid` | Inky, Bluebell | Plain wool with a pale belly. |

- Odd eyes: `eye2` colours the cat's left eye (image left), as on Mochi.
- Dark coats (fur luminance under 0.3: Inky, Pepper and Pumpkin) get a deeper wool, almost no sheen (the white sheen alone turns black wool mid grey), a slight iris glow and a lighter eye rim, and pale closed-eye lines. Every cat's closed eyes are a thread arc laid on the skull, like the rig's. Biscuit's installed set predates the arcs and still closes its eyes by squashing them; re-render it to match the others.
- Accessories: the knit scarf with bands and a hanging end, a collar ring, a gold bell or a felt flower at the front of the collar, a bandana triangle with dots, and a bow on the head by the left ear.
- To get an editable scene, add `--save cat.blend` to the `felt_cat.py` command line.

### 2D placeholder clips

Run `node tools/clip-maker/server.js`, then open http://localhost:5174/tools/clip-maker/. Pick a cat and press **Render clip set**. The page renders the rig to PNG frames to this spec, and the server encodes them with ffmpeg (`winget install Gyan.FFmpeg`) into `assets/cats/<name>/`, along with a manifest. Delete a cat's folder to put it back on the rig.

## Background plates

The room is split into depth plates: sky, back wall, midground, props and a blurred foreground. Each layer drifts at its own rate for the slow parallax. The library in `assets/room/` is a needle-felt diorama rendered in Blender in the same style as the cats, by [tools/blender/felt_room.py](tools/blender/felt_room.py). When `assets/room/manifest.json` is present, [js/scene.js](js/scene.js) uses those images. Without it, or with `?room=procedural` in the URL, the game draws the original canvas room. Any piece missing from the manifest is drawn on canvas too.

### The view

The game shows `VIEW` ([js/scene.js](js/scene.js)): a chair-led crop of the 1920 × 1080 room, x 280–1880 and y 160–1060, about 1.2× closer. The armchair is the hero, the bookcase and fireplace run off the edges, and the floor spots stay clear of the HUD. `main.js` fits that rectangle to the screen. Everything else (SPOTS, props, live glows, the light map) stays in room coordinates, so the crop is only a camera change. To reframe:

1. Edit `VIEW`.
2. Check that every spot, with its cat, is inside the new view and above the HUD.
3. Re-render the room.

Cats still enter and leave at x −190 and 2110 (`EXIT_LEFT` and `EXIT_RIGHT` in cats.js), so with this crop they spend a few seconds walking in unseen.

### Re-rendering the room

```bash
node tools/blender/room.mjs
```

This renders every plate and installs it, with the manifest, in `assets/room/`. By default it renders at 1.2×, which is 1920 ÷ the view's width, so the view comes out at 1920 × 1080. On an RTX 2060 Super it takes about 2 minutes. It needs Blender 5.2; set `BLENDER` if Blender isn't found. Options:

| Option | What it does |
|---|---|
| `--beauty` | One quick all-in-one render with every sit spot marked in pink and the floor and jump waypoints in cyan. The render goes to the work folder (`%TEMP%/cosy-cats-blender/room/beauty_spots.png`) and `assets/room` is left alone. This is the check to run after changing the layout or the model. |
| `--passes back,mid,…` | Re-render only some passes. The passes are `sky`, `back`, `mid`, `fore`, `armchair`, `table`, `pouf`, `basket`, `shade`, `logs` and `light`. |
| `--samples 64` | Eevee samples per render. |
| `--scale 2.4` | Render the view at 3840 × 2160 for crisper output on high-DPI screens. The manifest boxes stay in room units. |
| `--save room.blend` | Also save the built scene, to open and edit in Blender. |

A full render also writes to the work folder, for checking:

- `composite.png` and `composite_spots.png`: all plates and light layers stacked, with and without the spot marks.
- `view.png` and `view_spots.png`: the same composite cropped to exactly what the game shows.

### How the room lines up with the cats

- **One plan:** `room.mjs` imports `LAYOUT` from [js/scene.js](js/scene.js) and passes it to Blender, so the 3D room is built from the same `SHELF`, `WIN`, `FIRE`, `TABLE`, `CHAIR`, `POUF`, `CANDLES`, `FAIRY`, `SPOTS` and prop list as the game. If you move a spot or a piece of furniture in scene.js, re-render the room.
- **Camera:** orthographic and pitched 7° down, like the cats' camera. Unlike the cats' camera, it looks square on (yaw 0), so the shelves and floor lines stay level and the cats read as turned slightly toward the viewer. One Blender unit is 100 px, so a world point (x, y, z), with y going into the room, lands on pixel `(100 x, 1120 − 100 (y sin 7° + z cos 7°))`.
- **Sit spots:** each surface a cat can sit on is placed so that its top lands exactly on the spot's pixel row at the depth where the cat sits. That depth is halfway into the shelf, sill, mantel or chair-back crest, and on the pouf, the seat cushion and the rug. The shelf gaps are cleared round the `shelfHigh` and `shelfLow` spots, which are 148 px wide.
- **Materials:** the cats' felt (sheen, mottled wool and fibre bump, with a speckled fuzz shell on the upholstery, rug, pillow, throw and yarn), textured in world space in pixel units. The wool grain is therefore the same size on screen everywhere. The hero pieces get more:
  - **Armchair:** brushed upholstery with fibres running down it and a sheen that varies across the fabric. It has pillowy cushions (superellipsoids), piping welts, and channel seams on the back. The seat has a soft hollow where cats sleep; the bottom of the hollow sits on the seat spot. The pillow is stuffed and slumped against the back.
  - **Throw:** a chunky plaid knit with stitch ribs modelled in the mesh, uneven folds that open toward an uneven hem, and a fringe.
  - **Books:** runs of a series (same height and binding) between singles of mixed thickness. Some lean, are twisted slightly, or are pulled half out, and the covers have worn edges and a book-cloth weave.
  - **Rug:** a tufted pile.
- **Depth of field:** a depth pass goes with every plate and prop. Using it, the back wall and the far side of the bookcase go softly out of focus (up to 1.7 px), and so does the floor right in front of the lens. The band the cats sit in stays sharp. Tune it with `FOCUS` in felt_room.py.

### What each file is

| File | Layer in the game | Notes |
|---|---|---|
| `sky.png` | Sky, seen through the window | Night sky, moon, snowy hills, pines and a cottage, lightly blurred. Stars, clouds and snow are still drawn live on top. |
| `back.png` | Back layer | Wall, wainscot, window frame and sill, curtains, fairy-light wire with bulb caps, and the hanging plant. The window is see-through. Cropped to the view plus a 48 px margin for the drift, like `mid` and `fore`. |
| `mid.png` | Midground | Floor, rug, bookcase with books, and the chimney breast with fireplace, mantel, candles, clock and painting. |
| `armchair.png`, `table.png`, `pouf.png`, `basket.png` | Props, z-sorted with the cats | Each is a cut-out at its manifest `box`, with its own cast shadow baked in. The shadow is measured as the darkening the prop causes on the room behind it. |
| `lampShade.png` | Drawn in `drawGlow` | The lit lamp shade, drawn after the cats as the canvas shade was. |
| `fireLogs.png` | Drawn in `drawFire` | The felt logs in front of the live flames. |
| `fore.png` | Foreground | Placed in the view's corners and kept clear of every sit spot: pothos at the top and bottom left, and a stack of books with a mug at the bottom right. Blurred and darkened. |
| `lightmap.png` | `lightAt()` | 96 × 54 light map rendered with every surface white, so the cats are tinted by the room's real lighting. The window is filled with cool moonlight, and the map is normalised so lit areas are near 1 and shadows stay above 0.5. |

Light is baked into the plates and lit for a focal point rather than evenly:
- **Key:** a broad warm panel from the upper left (the cats' key direction), aimed at the chair so it falls off into darker corners. A weak cool fill keeps those corners off black.
- **Chair:** an amber spot pool.
- **Fire:** its glow spills from the opening and wraps the chair's right side and the rug.
- **Window:** cool moonlight with a patch on the floor.
- **Other warm sources:** the lamp's up and down cones, the candles, and fairy lights bright enough to warm the curtain tops. The live touches in `drawGlow` and `drawFire` (flames, flicker, candle flames, fairy bulbs, moonbeam, dust motes and teacup steam) are drawn on top, as before. Emissive pieces are never baked into a plate. They are either drawn live or rendered as the separate light layers above.

**Projector values:** even with the darker corners, the rendered room is lighter than the canvas room. With cats and glows, a full frame has a median luminance of 84 against 56, and 3% of pixels below 40 against 30%. Light cats stay brighter than every surface they sit on, so the sill top is kept at a mid cream. Dark cats (Inky, Pepper, Pumpkin) read as silhouettes, as before.

**Performance:** the plates are resampled once to the screen's resolution when they load. Each frame then draws the same number of full-screen images as the canvas room. With 10 clip cats on a 1920 × 1080 canvas a frame costs 1.6 ms CPU, or 9.3 ms with a forced GPU readback (the canvas room: 2.9 ms and 19.9 ms). The PNGs come to about 5 MB and load in about 0.2 s from localhost. If they take more than 5 s, the canvas room is shown until they arrive.
