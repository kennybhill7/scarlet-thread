# Image commission — full picture list

Everything the app needs, in build order. Two style contracts: **A** for photoreal vistas (the Grok look), **B** for hand-drawn map sheets (the Narnia look). Every prompt in this file begins with one or the other.

---

## 1. The inventory

| # | What | Count | Style | Size | Phase |
|---|---|---|---|---|---|
| 1 | Master mountain panorama | 1 | A | 1536×1024 | 1 |
| 2 | Stage scenes | 11 | A | 1536×1024 | 1 |
| 3 | World map sheet | 1 | B | 1536×1024 | 1 |
| 4 | Region map sheets | 25 | B | 1536×1024 | 2 |
| 5 | Site vistas | 40 | A | 1536×1024 | 2–3 |
| 6 | The New Jerusalem | 1 | B+ | 1536×1024 | 3 |

**Phase 1 is 13 images and unblocks the whole app.** Do that first, check it, then commit to phase 2.

The five mountain plates are **cut here in code** from the master panorama. Do not commission them separately — five independent generations never share a sun direction, and continuous light across the stack is a hard requirement.

---

## 2. Style Contract A — photoreal vistas

This is the Grok look, written out. Paste it above every prompt in §4, §5 and §8.

```
STYLE CONTRACT A — follow exactly.

Medium: photorealistic cinematic matte painting. Epic establishing shot, the
scale and finish of a feature-film environment plate. Painterly realism —
real light physics, real atmosphere, but composed like a painting.

Vantage: elevated. The camera is on a ridge or bluff looking down and out
across a vast distance. Foreground rock or a dark tree in silhouette frames
the lower edge. Middle distance carries the subject. Far distance dissolves
into atmospheric haze, ridge behind ridge behind ridge.

Light: ONE dramatic source, low and warm — raking gold light. Visible shafts
of light breaking through cloud onto the land. Hard contrast between the
sunlit ground and deep cool shadow. Volumetric haze catching the light.
Where storm is present, cold blue-grey rain columns sit against the warm
light, and the collision of the two is the drama of the frame.

Colour: rich and real. Deep greens in vegetation, true blues in water,
warm ochre and gold in dry ground, cool slate in shadow and stone.
Saturated where nature is saturated. Not desaturated, not muted, not sepia.

Scale: human figures, tents, flocks, boats and buildings are TINY — specks
that tell you how vast the land is. Never a portrait, never a face large
enough to read.

Detail: high. Individual trees at middle distance, texture in rock, spray
in waterfalls, dust in the air, weather with real structure.

Aspect: wide landscape. Land occupies the lower two thirds.

ABSOLUTE PROHIBITIONS — an image breaking any of these is rejected:
- No text, letters, numerals, captions, signatures or watermarks.
- No sparkle glyphs, star glyphs, four-pointed shine marks or logo shapes
  anywhere in the frame, including on clouds and water.
- No red, scarlet, crimson or magenta anywhere. Fire and glowing lava read
  as AMBER, ORANGE and GOLD. This colour is reserved for a graphic overlay
  the app draws on top.
- No map pins, waypoint markers, numbered discs, badges, banners, ribbons
  or signage.
- No UI, frames, borders, vignettes, letterboxing or black bars.
- No modern objects: vehicles, powerlines, glass buildings, tarmac,
  contemporary clothing.
- No depiction of God. No depiction of the face of Jesus Christ.
- No lens flare, no bokeh, no sun-star artifacts.
```

**Why "no red" is absolute:** the scarlet rope is the app's identity and it only reads as *the* thread if it is the only red object on screen. Babylon burns amber. Judgement fire is gold. This is checkable in code and I will run it (§10.3).

---

## 3. Style Contract B — hand-drawn map sheets

Paste above every prompt in §6, §7 and §9.

```
STYLE CONTRACT B — follow exactly.

Medium: a hand-drawn pictorial fantasy map on aged parchment, in the
tradition of the illustrated Chronicles of Narnia endpaper maps. Ink line
and watercolour wash on paper. Visibly drawn by a person.

Surface: warm aged parchment, cream to light tan, with subtle age mottling
and soft darkening toward the edges. Paper texture visible.

Ink: warm brown-black line work. Coastlines drawn with a fine confident
line and light hatching just offshore. Land tinted in soft washes — pale
green for fertile ground, tan and ochre for desert, grey for rock.

Hills and mountains: drawn in ELEVATION, not plan — little three-dimensional
peaks and ridges seen from the side, the way a story map does it. Forests as
small drawn trees. Cities as tiny drawn walls, towers and domes.

Water: pale blue-green wash with fine parallel hatch lines following the
coast. A few small sailing ships. Stylised waves.

Furniture: an ornate compass rose. A decorative border rule inside the sheet
edge. Empty sea used as breathing room.

Accuracy: pictorial, not cartographic. Recognisable coastlines, and nothing
else. NO graticule, NO latitude or longitude lines, NO scale bar, NO
projection, NO satellite or photographic imagery, NOT a globe.

ABSOLUTE PROHIBITIONS:
- NO PLACE LABELS AND NO TEXT OF ANY KIND. No region names, no city names,
  no title cartouche lettering, no compass letters, no numerals. The app
  draws every label itself in its own typeface. Text baked into the sheet
  cannot be translated, cannot be repositioned, and will collide with the
  app's own labels.
- No red, scarlet or crimson anywhere, including on the compass rose and
  any heraldry. Reserved for the app's rope overlay.
- No map pins, dots, waypoint markers or numbered markers.
- No modern cartography, no printed-atlas look, no vector-flat style.
- No watermarks, no signatures, no sparkle or star glyphs.
```

**The no-text rule is the one people break.** Every map generator wants to letter its map. A lettered sheet is unusable here: the app positions its own labels in Fraunces over the sheet, and baked lettering doubles up and fights them. Say it twice in the prompt if needed.

**Roads and sea lanes must be visible.** The scarlet rope is traced from them. A route authored in abstract coordinates over a map reads as a graphic overlay for exactly the reason it did over terrain — nothing underneath it is ground.

---

## 4. The master mountain panorama

One image. Everything about the mountain view comes from this file.

```
[STYLE CONTRACT A]

SUBJECT: One vast mountain seen from a great distance, filling a wide
panoramic frame. A single summit, centred, snow-dusted, catching the light.
Ridges descending symmetrically left and right into foothills, then to a
broad sunlit plain with a river at the lower left, and a coastline at the
lower right.

THE TRAIL — the most important element in the image:
A narrow natural footpath of pale dirt, gravel and worn scree switchbacks up
the mountain. It enters at the lower-left of the frame, climbs the left flank
in long traversing zigzags, crosses the summit ridge, and descends the right
flank in mirroring zigzags to the lower-right of the frame. Continuously
visible along its entire length. Each leg travels mostly sideways across the
slope with short rises at the turns — a walkable trail, not a vertical scar.
Believable walkable ground under every part of it: ledges, shelves, gentle
slopes. No sheer cliff face where the trail runs.
The trail is dirt and stone. NOT red, NOT a ribbon, NOT paved, NOT marked.

LIGHT: low warm sun at the far LEFT, near the horizon, raking gold light
across the plain with visible shafts through broken cloud. A dark storm mass
gathers at the far RIGHT over the coastline, with cold rain columns. The
transition from warm dawn on the left to cold storm on the right is gradual
and continuous across the whole width — no sudden change, no seam.

TERRAIN BANDS bottom to top: sunlit plain and river; foothills with scattered
trees; mid-slope forest and tall waterfalls; bare upper rock and scree; a
snow-and-cloud crown. Each band reads as continuous ground from the left edge
of the frame to the right edge.

The image must stay coherent when cut into five horizontal strips.
```

**Reject if:** the trail breaks or vanishes; the trail runs near-vertically; sun on the right; two light sources; any red; the storm and the dawn meet in a hard vertical line.

---

## 5. The eleven stage scenes

Two rules across all eleven.

**Depict, never interpret.** Paint what the text puts in front of you — objects, weather, terrain, scale. Never a symbol of a doctrine.

**Mirror pairs must look related.** The mountain's structure is five ascent/descent pairs. **Generate each pair back to back** and describe the second against the first.

| Pair | Ascent | Descent | Shared |
|---|---|---|---|
| 1 | 01 Creation | 11 Paradise Restored | Same valley, same viewpoint |
| 2 | 02 Sin Enters | 10 Satan Cast Out | Low camera, serpent form |
| 3 | 03 The Flood | 09 World Judged | Water and sky as the agent |
| 4 | 04 Babel | 08 Babylon | Same tower/city angle and scale |
| 5 | 05 Israel | 07 Church | A people crossing open land, from above |

Keep the **bottom 40% visually quiet** in all eleven — low contrast, no competing detail. Type sits there.

**01 · Creation** — Genesis 1–2
```
A vast untouched valley at first light, seen from a high ridge. A wide river
winds from the far distance through green terraced ground toward the viewer.
Groves of great old trees. Bare mountains rising both sides, the tallest
catching the first gold on its snow. Mist lying in the low ground, shafts of
warm light breaking through it. Nothing built anywhere. The lower third is
quiet shadowed ground.
```

**02 · Sin Enters** — Genesis 3–4
```
Low camera close to the earth at the edge of a grove, looking out across a
wide golden plain toward distant mountains under a gathering dark sky. A
heavy fruit tree in the near-middle distance, dark and full, its trunk in
silhouette. A thick serpent form on the ground beneath it, small in frame,
seen as a dark shape. Long shadows reaching toward the viewer. Warm sinking
light on the plain, cold storm behind the mountains.
[Mirror of 10 — generate before 10 and match camera height.]
```

**03 · The Flood** — Genesis 6–9
```
An immense wooden vessel of dark pitched planks on high ground, seen from a
distance with mountains behind. The sky is a broken mass of dark cloud with
rain columns falling far off and gold light tearing through the gap above.
Standing water across all the low ground, mirroring the cloud. One bird
crossing the middle distance, very small. Dark brown timber and black pitch.
```

**04 · Babel** — Genesis 10–11
```
A vast unfinished ziggurat of mud brick rising from a flat river plain, seen
from a low distant vantage so it dominates the sky. Ramps spiralling its
flanks, timber scaffolds near the top, brick kilns smoking at its base.
Courses of tan brick with bitumen-dark mortar. Dry level plain to the horizon,
a river curving past. Hard gold light from the left, long shadow right.
Tiny figures on the ramps for scale.
[Mirror of 08 — generate before 08 and match camera angle and scale.]
```

**05 · Israel** — Genesis 12 – Malachi
```
A high vantage over a great land of ochre hills, green terraced valleys and
distant snow mountains under a dramatic broken sky. A long column of people,
tents, flocks and pack animals moving across the middle distance, seen from
far above so individuals are specks. Dust rising behind the column. Olive
groves and small stone altars on the hillsides, a walled hill town tiny on
the horizon. Late gold light from the left, cold rain over the far mountains.
[Mirror of 07 — generate before 07 and match viewpoint height.]
```

**06 · Gospels — the summit** — Matthew – John
```
The summit of a great mountain seen from just below the crest. Bare stone and
patches of snow. Heavy cloud breaking apart directly above, and a single
enormous shaft of warm light striking the rock at the top and spreading down
the ridge. Below and behind, range after range falling away into blue
distance on both sides. The brightest image in the whole set — the only one
where the light fully wins. No figures, no cross, no symbols.
```

**07 · Church** — Acts – Jude
```
A high vantage over a wide coastal land in the hour after dawn. Many small
separate groups of people on many separate roads, spreading outward in
different directions toward distant coastal towns and a busy harbour with
small sailing ships. Seen from far above so individuals are specks. Where 05
had one column on one road, this has many roads. Gold light from the left,
sea haze and open blue water on the right.
[Mirror of 05 — match the viewpoint height and palette of 05.]
```

**08 · Babylon** — Revelation 12–18
```
A vast walled city on a river plain, seen from the same low distant vantage
and the same scale as the tower in 04. Terraced palaces, a great ziggurat at
its centre, stone quays along the river, ships at the wharves. The city burns
from within — deep amber and orange fire glow through the streets, black smoke
columns rising and flattening under a dark sky. Rubble at the walls. A crescent
moon above the smoke. Fire is amber and gold, never red or crimson.
[Mirror of 04 — match the camera angle and scale of 04.]
```

**09 · World Judged** — Revelation 6–11
```
A dark ocean under a sky torn open, seen from a high distance. Enormous hail
and columns of fire falling far out to sea, amber against cold grey. Mountains
half-drowned, only their peaks above the water. The sun a dim ash disc.
Water covering everything that was low ground. Same water-and-sky composition
as 03 — but no vessel and no refuge anywhere, only the drowned peaks.
[Mirror of 03 — match the composition of 03.]
```

**10 · Satan Cast Out** — Revelation 19–20
```
Low camera close to the earth, the same height as 02, looking out over cracked
dry ground toward a chasm in the middle distance. A vast serpent-dragon form
lies bound and still, dark in silhouette, wrapped in heavy chain, being drawn
down into the chasm. Where 02 had the serpent under a living tree, here it
lies chained on bare rock. Deep amber fire glow inside the chasm. Cold clear
light from above breaking through cloud. The dragon is dark — no red.
[Mirror of 02 — match the camera height of 02.]
```

**11 · Paradise Restored** — Revelation 21–22
```
The same valley as 01, from the same viewpoint, at full clear morning. The
river now wide and brilliant, running straight down the centre from the far
distance. Great trees in fruit along both banks. Where 01 was empty, a vast
city of pale stone and gold stands in the far distance at the head of the
valley, luminous, its walls catching the light. No mist, no shadow in the low
ground, no storm anywhere. The calmest and brightest image in the set.
[Mirror of 01 — match the viewpoint and valley shape of 01 exactly.]
```

---

## 6. The world map sheet

```
[STYLE CONTRACT B]

SUBJECT: A hand-drawn pictorial map of the ancient biblical world on aged
parchment, in the illustrated Narnia endpaper tradition.

EXTENT: the Mediterranean at the left and centre, Italy reaching down into it,
Greece and the Aegean with its scatter of islands, Asia Minor across the top
centre, the Black Sea above it, the Caspian at the upper right, the Levant
coast running north to south at the centre, Egypt and the Nile with its delta
at the lower left, the Sinai peninsula between the two northern arms of the
Red Sea, the Arabian desert at the lower centre, Mesopotamia at the right with
the Tigris and Euphrates running down to the Persian Gulf at the lower right.

DRAWN DETAIL: mountain ranges in side elevation along Ararat, the Taurus, the
Lebanon, Sinai and the Zagros. Forests as small drawn trees in the north.
Desert as fine stippling. Little walled cities with towers where the great
cities stand. Three or four small sailing ships on the Great Sea. An ornate
compass rose in an empty stretch of sea. A fine decorative border rule inset
from the sheet edge.

ROADS AND SEA LANES — required: faint dotted caravan roads linking the cities
and running along the coast and the river valleys; faint dotted sea lanes
across the Great Sea. These are what the app traces its route along, so they
must be visible and continuous.

NO LABELS AND NO TEXT ANYWHERE ON THE SHEET. No region names, no city names,
no title, no compass letters, no numbers. The app adds all lettering itself.
```

---

## 7. The twenty-five region sheets

Same Contract B, same hand, same parchment, zoomed in. Use this template and swap the two bracketed lines.

```
[STYLE CONTRACT B]

SUBJECT: A hand-drawn pictorial map of [REGION] on aged parchment, in the
same illustrated Narnia endpaper style and the same drawing hand as the world
sheet. Zoomed in close, so individual towns, valleys, wadis and roads are
drawn at a larger scale.

TERRAIN: [TERRAIN LINE]

DRAWN DETAIL: mountains in side elevation, forests as small drawn trees,
towns as little drawn walls and towers, water in pale blue-green wash with
coastal hatching. A small compass rose. A fine border rule inset from the edge.

ROADS — required: dotted roads and tracks linking every settlement, plus the
river fords and mountain passes. The app traces its route along them.

NO LABELS AND NO TEXT ANYWHERE. The app adds all lettering itself.
```

| # | Region | Terrain line |
|---|---|---|
| 1 | Eden & the four rivers | A green well-watered highland with four rivers running out of one source into open country |
| 2 | Ararat | High snow mountains above a broad plain, water still standing in the low ground |
| 3 | Shinar & Babel | Flat river plain between two great rivers, marsh and canals, one huge stepped tower |
| 4 | Ur & Haran | The lower Euphrates with a walled city near the gulf marshes, and a long caravan road north to a second city on open steppe |
| 5 | Canaan of the patriarchs | North–south hill country, coastal plain to the west, the Jordan rift and Dead Sea to the east, oak groves and wells |
| 6 | Egypt & Goshen | The Nile valley as a narrow green ribbon in desert, a wide delta at the top, pyramids on the west bank |
| 7 | Sinai & the wilderness | Rocky desert peninsula between two gulfs, a high granite massif at the south, wadis and scattered springs |
| 8 | Moab & the Jordan | Plateau east of the Jordan, deep river gorge, the Dead Sea, Jericho on the far plain |
| 9 | Jericho & the conquest | The Jordan plain, walled towns in hill country, mountain passes and valley approaches |
| 10 | Shiloh & the judges | Central hill country with scattered walled villages, the coastal plain with five cities to the west |
| 11 | Bethlehem & the hill country | Terraced ridges south of Jerusalem, shepherd country, small walled towns |
| 12 | Jerusalem & the temple | One walled city on two ridges with a deep valley between, a temple platform, springs and a pool, olive slopes east |
| 13 | Samaria & the northern kingdom | Northern hill country and the fertile Jezreel valley, Carmel at the coast, the Sea of Galilee northeast |
| 14 | Assyria & Nineveh | The upper Tigris, a great walled city on the river, mountains rising to the north and east |
| 15 | Babylon & the exile | The Euphrates plain, an immense double-walled city astride the river, canals and date groves |
| 16 | Susa & Persia | Highland plateau east of the Tigris, a royal citadel, the Zagros passes to the west |
| 17 | Jerusalem rebuilt | The same city as 12 with its walls broken and partly rebuilt, scaffolds on the gates |
| 18 | Nazareth & Galilee | A freshwater lake ringed by hills, fishing villages on the shore, hill towns above, the Jordan running south |
| 19 | Judea & the Jordan | Wilderness ridges falling east to the Jordan and the Dead Sea, the river with fords, desert caves |
| 20 | Jerusalem of the passion | The city as 12, close in — the temple, the garden slope east, a bare hill outside the wall |
| 21 | Antioch & Asia Minor | The north-east Mediterranean coast, a great river city, mountain roads inland across Anatolia |
| 22 | Greece & the Aegean | A deeply indented coastline with hundreds of islands, harbour cities, sea lanes across |
| 23 | Ephesus & the seven churches | The west coast of Asia Minor, a great harbour city, six more cities inland along river valleys |
| 24 | Rome & Malta | The Italian peninsula, a great city inland on a river, a small island south, sea lanes east |
| 25 | Patmos | One small rocky Aegean island, close in, a harbour, a high ridge, open sea around |

---

## 8. Site vistas

Contract A. These are the payoff — the photoreal view when you zoom all the way in. **Forty in total; the twelve below are tier 1** and cover the moments people actually study.

Each prompt: `[STYLE CONTRACT A]` + one line of setting + the concrete detail from the text. Depict, never interpret.

| # | Site | Prompt body |
|---|---|---|
| 1 | Eden | A green highland garden seen from above at first light, four rivers running out of one spring into open country, great fruit trees, mist and light shafts |
| 2 | Ararat | A vessel of dark timber aground high on a snow-streaked mountain shoulder, flood water still standing on the plain far below, cloud breaking |
| 3 | The tower at Shinar | An unfinished brick ziggurat from the plain below, ramps and scaffolds, kilns smoking, tiny figures on the ramps |
| 4 | Ur of the Chaldees | A walled river city of mud brick with a stepped tower, marsh and date palms, a caravan road leaving west across dry ground |
| 5 | The pyramids of Egypt | The Nile valley from a high bluff at dawn — green ribbon, palms, a wide river with boats, three great stone pyramids on the west desert edge, workers as specks |
| 6 | The sea crossing | A vast shallow sea bed between walls of standing water under a black sky torn by light, a great crowd of tiny figures crossing, spray in the air |
| 7 | Horeb · Sinai | A high granite mountain in the wilderness wrapped in dense cloud and smoke as from a furnace, gold fire glow at the summit, a great camp of tents on the plain below |
| 8 | Jericho | A walled town on the Jordan plain seen from the hills, palms and springs, dust rising from a column circling the walls |
| 9 | Jerusalem & the temple | A city on two ridges seen from the Mount of Olives at gold hour, a great stone temple platform, walls and towers, valleys in shadow |
| 10 | Babylon | An immense double-walled city astride the Euphrates from a high vantage, canals, date groves, a stepped tower at the centre, storm light behind |
| 11 | The Sea of Galilee | A freshwater lake ringed by green and ochre hills at dawn, small fishing boats, villages on the shore, light shafts on the water |
| 12 | Patmos | A small rocky Aegean island from a high ridge, open sea in every direction, a harbour far below, dramatic broken sky |

The remaining 28 (phase 3): Bethel · Hebron · Beersheba · Goshen · Marah & Elim · Rephidim · Kadesh · Mount Nebo · Gilgal · Shiloh · Gibeon · Hazor · Bethlehem · Valley of Elah · En Gedi · Mount Carmel · Samaria · Nineveh · Susa · Nazareth · The Jordan at Bethabara · Capernaum · Caesarea Philippi · Gethsemane · Golgotha · Antioch · Athens & Mars Hill · Ephesus.

---

## 9. The New Jerusalem — the one special image

It has no coordinates. In the text it *descends*. So it is not a pin and not a region — it is the sheet changing.

```
[STYLE CONTRACT B]

SUBJECT: The same aged parchment sheet and the same drawing hand, showing the
hill country around one walled city — and above it, a vast square city
descending out of a broken sky. The descending city is drawn in GOLD LEAF and
luminous pale ink, in a finer and brighter hand than everything else on the
sheet, as though a second illuminator added it. It has twelve gates, a wall of
clear stone, and a single wide river running out of it down onto the map below.
Light radiates from it across the parchment.

Everything else on the sheet stays in the ordinary warm brown ink of the other
maps. The descending city is the ONLY gold on the sheet and the only luminous
element.

NO LABELS AND NO TEXT ANYWHERE. No red anywhere.
```

This is the last thing a reader unlocks and the only time the paper itself changes. Worth spending real effort on.

---

## 10. Delivery and verification

### 10.1 Files

PNG, full generated resolution, unedited — no crop, no upscale, no filter.

```
master-panorama.png
scene-01-creation.png … scene-11-paradise-restored.png
map-world.png
map-region-01-eden.png … map-region-25-patmos.png
site-01-eden.png … site-40-ephesus.png
map-new-jerusalem.png
```

Plates are cut here in code from `master-panorama.png` — five contiguous slices summing to exactly 1024px. Never cut by hand; hand-cut slices overlap and every seam then shows the same rows twice.

### 10.2 Rights

OpenAI's terms assign output ownership to you — that is the reason to move. Expect C2PA provenance metadata in the file (invisible, strippable). No visible logo is applied, unlike the four-pointed sparkle currently baked into `01-creation.jpg` at pixel (858–890, 430–475).

Regenerate everything. Do not mix new images with the current set.

### 10.3 Check every file on arrival

1. **Red sweep.** No red pixels. Checkable in code and I will run it: any pixel where `r > 110 && r > g×1.55 && r > b×1.55` fails. The rope must be the only red on screen.
2. **Glyph sweep.** View at 300% and scan the *whole* frame, not the corners. The existing watermark sits mid-frame on a cloud and is invisible in a corner check.
3. **Text sweep.** No letters or numerals — including incidental marks on brickwork, sails and banners. **On map sheets this is the most likely failure.** A lettered sheet is a reject, not a fix.
4. **Master only — the trail.** Trace it end to end with a finger. If it breaks, vanishes, or crosses ground you could not walk, it fails; the rope is drawn along it.
5. **Master only — light continuity.** Cover the middle. Left and right halves must still belong to one time of day.
6. **Map sheets — roads visible?** If the dotted roads and sea lanes are missing, the route has nothing to lie along. Reject.
7. **Mirror check.** 01 beside 11, 02 beside 10, 03 beside 09, 04 beside 08, 05 beside 07. Each pair should read as the same place or the same shot twice. If a pair fails, regenerate the descent side against the ascent side — not both.
8. **Bottom-third check.** Squint at the lower 40% of every vista. If it is busy or high-contrast, type will not survive over it.

### 10.4 If a generation misses

Regenerate that one image with the same prompt plus one added corrective line. Do not rewrite the prompt — twelve or forty images have to stay in one voice, and rewriting drifts the style. E.g. *"The trail must be continuously visible from the lower-left corner to the lower-right corner without breaks."*
