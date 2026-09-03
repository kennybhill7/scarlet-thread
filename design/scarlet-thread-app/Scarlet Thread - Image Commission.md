# Image commission — ChatGPT / GPT Image

Twelve images. One master mountain panorama and eleven stage scenes. Everything the app needs.

Read §1 and §2 before generating anything. §3 is the master. §4 is the eleven scenes. §5 is delivery and verification.

---

## 1. Why twelve and not sixteen

The app needs five **plates** (horizontal terrain slices that stack on phone and compose on desktop) and eleven **scenes** (full-bleed art behind each stage card).

**Do not commission the five plates separately.** Five independent generations will not share a sun direction, and continuous light across the five is a hard requirement — it is the thing that makes the stack read as one mountain. When five different paintings were tried as stand-ins the mean luminance spread was 5.5×, and every seam showed as a hard horizon line.

Commission **one master panorama** at the largest landscape size, then cut the five plates from it. Contiguous slices of one image are byte-identical at the seams, so continuity is structural rather than something to check. Same file also serves the desktop composed view.

**Total: 1 master + 11 scenes = 12 generations.**

---

## 2. The global style contract

Paste this block at the top of **every** prompt in §3 and §4, then the image-specific text. Do not paraphrase it between images — identical wording is what keeps twelve generations in one world.

```
STYLE CONTRACT — follow exactly.

Medium: painted cinematic matte painting, in the visual language of hand-painted
animated-feature backgrounds. Photoreal detail, painterly edges. Not a photograph,
not 3D render, not concept-art sketch, not illustration with visible linework.

Palette: desaturated stone. Rock, earth and water are near-neutral greys, cool
slate, and warm ochre-browns. Overall saturation low.

Light: one directional source, low on the horizon, warm. Deep shadow in the
opposite direction. Atmospheric haze in the distance. Light is the only drama.

Composition: wide establishing shot. Vast scale. Land occupies the lower two
thirds, sky the upper third.

Mood: reverent, weathered, ancient, quiet. Serious. No whimsy.

ABSOLUTE PROHIBITIONS — an image breaking any of these is rejected:
- No text, letters, numerals, captions, signatures or watermarks anywhere.
- No red, scarlet, crimson or magenta anywhere in the image. Not on cloth,
  not in the sky, not in foliage, not in light. This colour is reserved for a
  graphic overlay the app draws on top.
- No map markers, pins, waypoint discs, circles, badges, numbered markers,
  route ribbons, banners or signage.
- No UI, no frames, no borders, no vignette, no letterboxing, no black bars.
- No modern objects: no vehicles, roads, powerlines, fences, buildings with
  glass, or contemporary clothing.
- No depiction of God. No depiction of the face of Jesus Christ. Human figures
  only ever distant and small — silhouettes at scale, never portraits, never
  a face large enough to read.
- No lens flare, no bokeh, no sun-star artifacts, no sparkle or star glyphs.
```

That last line is deliberate. The current art has a four-pointed sparkle baked into `01-creation.jpg` at pixel (858–890, 430–475) — a generator watermark sitting on a cloud, invisible in corner checks. Ask for no sparkle glyphs explicitly, then check for them (§5.3).

---

## 3. The master panorama

**One image. Everything about the mountain comes from this file.**

Size: **1536 × 1024 (landscape)** — the largest landscape GPT Image produces. Do not accept a square crop.

### 3.1 The one thing that must be right

The mountain needs a **visible natural trail** — a pale dirt-and-scree switchback path — running from the lower-left, up the left flank, over the summit, and down the right flank to the lower-right.

This matters more than anything else in the image, for a non-obvious reason. The app draws a scarlet rope along that route, and the rope only reads as *lying on ground* if there is real ground under every point of it. Six attempts at inventing a trajectory in abstract coordinates all read as a graphic overlay. The route gets traced out of the painting, so the painting has to contain it.

The trail must be **dirt, stone and worn scree — never red, never a ribbon, never marked.** A natural footpath. The scarlet rope renders on top of it in the app.

### 3.2 Prompt

```
[PASTE THE STYLE CONTRACT FROM §2 FIRST]

SUBJECT: A single vast mountain, seen from a distance, filling a wide panoramic
frame. One summit, centred, with a snow-dusted peak. Ridges descending
symmetrically to left and right into foothills, then to a broad plain at the
lower left and a coastline at the lower right.

THE TRAIL — the most important element:
A narrow natural footpath of pale dirt, gravel and worn scree switchbacks up the
mountain. It enters at the lower-left of the frame, climbs the left flank in long
traversing zigzags, crosses the summit ridge, and descends the right flank in
mirroring zigzags to the lower-right of the frame. It is continuously visible
along its whole length. Each leg of the switchback travels mostly sideways across
the slope, with short rises at the turns — a walkable trail, not a vertical scar.
The ground beneath every part of the trail is believable, walkable terrain: ledges,
shelves and gentle slopes. No sheer cliff face where the trail runs.
The trail is dirt and stone only. It is NOT red, NOT a ribbon, NOT paved, NOT
marked with any signs, posts, flags or markers.

LIGHT: low warm sun at the far LEFT of the frame, near the horizon, casting long
light across the plain. A dark storm mass gathers at the far RIGHT of the frame,
over the coastline, with rain haze. The transition from warm dawn on the left to
cold storm on the right is gradual and continuous across the whole width — no
sudden change, no seam.

TERRAIN BANDS, bottom to top: a broad sunlit plain with a river at the lower left;
foothills with scattered trees; mid-slope forest and waterfalls; bare upper rock
and scree; a snow-and-cloud crown at the summit. Each band reads as continuous
ground from the left edge of the frame to the right edge.

The image must remain coherent when cut into five horizontal strips.
```

### 3.3 What to reject on delivery

- Trail breaks, disappears behind a ridge, or has no visible ground under a stretch.
- Trail runs near-vertically instead of traversing.
- Sun on the right, or two light sources, or flat overcast.
- Any red anywhere.
- Numerals or markers on the trail.
- The storm and the dawn meeting in a hard vertical line.

---

## 4. The eleven scenes

One per stage. These are the full-bleed art behind each stage card, so they are read at phone-screen size with type over the lower half.

Size: **1536 × 1024 (landscape)** each.

### 4.1 Two rules that apply to all eleven

**Rule 1 — depict, never interpret.** Paint what the text puts in front of you: objects, weather, terrain, scale. Never paint a meaning, a symbol of a doctrine, or an emotion. The app's copy follows the same rule, and the art has to match it.

**Rule 2 — mirror pairs must look related.** The mountain's whole structure is five ascent/descent pairs across the summit. Each pair shares a composition, a camera angle and a motif, so that seeing one recalls the other. **Generate each pair back to back, in one sitting, so the second can be described against the first.** The pairs:

| Pair | Ascent | Descent | Shared motif |
|---|---|---|---|
| 1 | 01 Creation | 11 Paradise Restored | Same valley, same viewpoint — garden and river |
| 2 | 02 Sin Enters | 10 Satan Cast Out | Low camera, the serpent form, the ground |
| 3 | 03 The Flood | 09 World Judged | Water and sky as the agent, an ark-like refuge |
| 4 | 04 Babel | 08 Babylon | A built tower/city seen at the same angle and scale |
| 5 | 05 Israel | 07 Church | A people moving across open land, seen from above |

Bottom of frame must stay **visually quiet** in all eleven — low contrast, no detail that competes — because 40% of the lower frame carries a scrim and type.

### 4.2 The prompts

Prepend the §2 style contract to each. Where a scene names its mirror, generate them consecutively and add: *"Match the composition, camera height and palette of the previous image."*

**01 · Creation** — Genesis 1–2
```
A wide untouched valley at first light. A river winds from the far distance
through green terraced ground toward the viewer. Dense old trees in small
groves. Bare mountains rising on both sides, the tallest catching the first
warm light on its snow. Mist lying in the low ground. Utterly empty of
anything built. Dawn — the warm light source low and to the left.
The lower third of the frame is quiet, shadowed ground.
```

**02 · Sin Enters** — Genesis 3–4
```
Low camera close to the earth at the edge of a grove, looking out. A heavy
fruit tree in the middle distance, its fruit dark and ripe. A thick serpent
form coiled along a low branch, seen in silhouette, small in frame. Long
shadows stretching toward the viewer. Beyond the grove, dry open ground and
a distant escarpment. The light is warm but sinking. Something has changed
in the weather, not yet in the land.
[Mirror of 10 — generate before 10 and match camera height.]
```

**03 · The Flood** — Genesis 6–9
```
An immense wooden vessel of pitched gopher planks, seen from a distance,
resting on high ground with mountains behind. The sky above is a broken
mass of dark cloud with rain columns falling far off. Standing water across
the low ground, reflecting the cloud. A single bird crossing the middle
distance, very small. No animals in view, no figures near the vessel.
The wood is dark brown and black pitch — no red.
```

**04 · Babel** — Genesis 10–11
```
A vast unfinished ziggurat of mud brick rising from a flat river plain,
seen from a low distant angle so it dominates the sky. Ramps spiralling its
flanks. Scaffolds of timber and rope near the top. Brick kilns smoking at
its base. Bitumen-dark mortar between courses of tan brick. The plain
around it is dry and level to the horizon. Hard clear light from the left,
long shadow to the right.
[Mirror of 08 — generate before 08 and match camera angle and scale.]
```

**05 · Israel** — Genesis 12 – Malachi
```
A high vantage over a dry rolling land of ochre hills and terraced valleys.
A long column of people, tents, flocks and pack animals moving across the
middle distance, seen from far above so individuals are specks. Dust rising
behind the column. Scattered stone altars and olive groves on the hillsides.
A walled hill town very small on the far horizon. Late warm afternoon light
from the left.
[Mirror of 07 — generate before 07 and match viewpoint height.]
```

**06 · Gospels — the summit** — Matthew – John
```
The summit of the mountain seen close, from just below the crest. Bare
stone, patches of snow, cloud breaking apart above. A shaft of clear warm
light striking the rock at the top and spreading down the ridge. Below and
behind, the ranges fall away into blue distance on both sides. This is the
highest and brightest image in the set — the only one where the light fully
wins. No figures. No cross. No symbols.
```

**07 · Church** — Acts – Jude
```
A high vantage over a wide coastal land at the hour after dawn. Many small
separate groups of people on many separate roads, spreading outward in
different directions toward distant coastal towns and a harbour with small
sailing vessels. Seen from far above so individuals are specks. Where 05 had
one column on one road, this has many roads. Warm light from the left, sea
haze on the right.
[Mirror of 05 — match the viewpoint height and palette of 05.]
```

**08 · Babylon** — Revelation 12–18
```
A vast walled city on a river plain, seen from the same low distant angle and
the same scale as the tower in 04, so the two read as a pair. Terraced
palaces, a great ziggurat at its centre, quays along the river. The whole city
is burning from within — deep amber and orange fire glow, black smoke columns
rising and flattening under a dark sky. Rubble at the walls. The fire is
amber and gold, never red or crimson.
[Mirror of 04 — match the camera angle and scale of 04.]
```

**09 · World Judged** — Revelation 6–11
```
A dark ocean under a sky torn open, seen from a distance. Enormous hail and
columns of fire falling far out to sea. Mountains half-drowned, only their
peaks above the water. The sun a dim ash-grey disc, the moon dark. Water
covering everything that was low ground. Composition and water-and-sky
agency echo 03, but no vessel and no refuge — only the drowned peaks.
Amber and ash tones in the fire, never red.
[Mirror of 03 — match the composition of 03.]
```

**10 · Satan Cast Out** — Revelation 19–20
```
Low camera close to the earth, the same height as 02, looking out over cracked
dry ground. A vast serpent-dragon form lying bound and still in the middle
distance, seen in dark silhouette, wrapped in heavy chain, being drawn down
into a chasm in the earth. Where 02 had the serpent coiled on a living branch,
here it lies chained on bare rock. Fire glow deep in the chasm, amber and
gold. Cold clear light from above. The dragon is dark — no red.
[Mirror of 02 — match the camera height of 02.]
```

**11 · Paradise Restored** — Revelation 21–22
```
The same valley as 01, from the same viewpoint, at full clear morning. The
river now wide and bright, running straight down the centre of the frame from
the far distance. Trees along both banks in fruit. Where 01 was empty, here a
great city of pale stone and gold stands in the far distance at the head of
the valley, luminous, its walls catching the light. No mist, no shadow in the
low ground, no storm anywhere in the sky. The brightest and calmest image in
the set.
[Mirror of 01 — match the viewpoint and valley shape of 01 exactly.]
```

---

## 5. Delivery, naming, verification

### 5.1 Files

Deliver **PNG at full generated resolution**, unedited, no crop, no upscale, no filter.

```
master-panorama.png          1536×1024
scene-01-creation.png        1536×1024
scene-02-sin-enters.png      1536×1024
scene-03-flood.png           1536×1024
scene-04-babel.png           1536×1024
scene-05-israel.png          1536×1024
scene-06-gospels.png         1536×1024
scene-07-church.png          1536×1024
scene-08-babylon.png         1536×1024
scene-09-world-judged.png    1536×1024
scene-10-satan-cast-out.png  1536×1024
scene-11-paradise-restored.png 1536×1024
```

Plate cutting is done here, in code, from `master-panorama.png` — five contiguous slices of ~205px whose heights sum to exactly 1024. Do not cut them by hand; hand-cut slices overlap and every seam shows the same rows twice.

### 5.2 Rights

OpenAI's terms assign output ownership to you, which is the improvement over the current situation. Two things to still expect:

- GPT Image output carries **C2PA provenance metadata**. Invisible, in the file's metadata, and strippable on export if you need it gone.
- No visible logo is applied — unlike the sparkle now baked into `01-creation.jpg`.

Regenerate all twelve. Do not mix new images with the current set; the current ones have a different generator's look and one has a watermark.

### 5.3 Check every file on arrival

1. **Sparkle and glyph sweep** — view each image at 300% and scan the *whole* frame, not the corners. The existing watermark sits mid-frame on a cloud at (858–890, 430–475) and is invisible in a corner check.
2. **Red sweep** — no red pixels anywhere. This is checkable in code and I will run it: any pixel where `r > 110 && r > g×1.55 && r > b×1.55` is a fail. The scarlet rope must be the only red object on screen.
3. **Text sweep** — no letters or numerals, including tiny incidental marks on brickwork, sails or banners.
4. **Master only — the trail** — trace the path end to end with a finger. If it breaks, vanishes, or crosses ground you could not walk, it fails, because the rope is drawn along it.
5. **Master only — light continuity** — cover the middle of the image and check the left and right halves still belong to one time of day.
6. **Mirror check** — put 01 next to 11, 02 next to 10, 03 next to 09, 04 next to 08, 05 next to 07. Each pair should look like the same place or the same shot twice. If a pair does not, regenerate the descent side against the ascent side, not both.
7. **Bottom-third check** — squint at the lower 40% of each scene. If anything there is busy or high-contrast, type will not survive over it.

### 5.4 If a generation misses

Regenerate that single image with the same prompt plus one added corrective line. Do not rewrite the prompt — the twelve have to stay in one voice, and rewriting drifts the style. Add, for example: *"The trail must be continuously visible from the lower-left corner to the lower-right corner without breaks."*
