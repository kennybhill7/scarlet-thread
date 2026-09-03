# The Story spine — 31 chapters inside 11 stages

Source: *The Story* (Zondervan, 2011), chapter list and Chart of References. Passage references and chapter numbering are structural facts and are used as such. **No NIV text is reproduced here or in the app** — the app ships BSB as default with KJV/ASV/YLT alongside, all public domain, already wired through `contracts.ts` since CORPUS-001.

One caveat to decide before ship: the chapter *titles* below are Zondervan's wording. Titles are short factual labels, but if you want zero dependency on their editorial voice, rename them — the mapping holds regardless. Candidate renames are in the last column of §4.

---

## 1. Two findings that change the plan

Mapping the 31 chapters onto the eleven stages surfaced two problems. Both need a decision from you before this becomes data.

### Finding A — The Story omits two of the eleven stages entirely

| Stage | Passages | In The Story? |
|---|---|---|
| 4 · Babel | Genesis 10–11 | **No.** Chapter 1 ends at Gen 9; chapter 2 opens at Gen 12. Babel is skipped. |
| 8 · Babylon | Revelation 17–18 | **No.** Chapter 31 covers Rev 1–5 and 19–22. |
| 9 · World Judged | Revelation 6–19 | **Mostly no.** Only Rev 19 is included; 6–18 are skipped. |

This is not a defect in The Story — it is a narrative reader, and it cuts the apocalyptic middle for pace. But **Babel↔Babylon is one of the five mirror pairs**, and the Flood↔World Judged pair loses its descent side. Adopting their spine unmodified would delete two stages and break two mirrors.

**Recommendation:** extend to **35 chapters** — the 31, plus four additions that restore the mirror logic:

| New | Title | Passages | Restores |
|---|---|---|---|
| 1b | The Tower | Genesis 10–11 | Stage 4 · Babel — ascent side of mirror 4 |
| 31a | The Scroll and the Trumpets | Revelation 6–11 | Stage 9 · World Judged |
| 31b | The Beast and the City | Revelation 12–18 | Stage 8 · Babylon — descent side of mirror 4 |
| 31c | The Rider and the Chain | Revelation 19–20 | Stage 10 · Satan Cast Out |

With those, every stage has at least one chapter and all five mirrors survive. Numbering keeps The Story's 1–31 intact so anyone reading alongside the book stays in sync.

### Finding B — the weight problem, now quantified

Of The Story's 31 chapters, **20 (chapters 2–21) fall inside stage 5 alone**. That is the "39 books on one pin" problem I flagged earlier, measured: stage 5 is 65% of the reading and 1/11th of the mountain. The sub-arc is not a nice-to-have; without it two thirds of the app's content has no navigation.

Proposed sub-arc for stage 5, grouping the 20 chapters into six phases that each have their own shape:

| Phase | Story chapters | Passages |
|---|---|---|
| Patriarchs | 2–3 | Genesis 12–50 |
| Exodus | 4–6 | Exodus, Numbers, Deuteronomy |
| Conquest | 7–9 | Joshua, Judges, Ruth |
| Kingdom | 10–13 | 1 Samuel – 1 Kings 11, Psalms, Proverbs |
| Divided & Warned | 14–16 | 1 Kings 12 – 2 Kings 19, Hosea, Amos, Isaiah |
| Exile & Return | 17–21 | 2 Kings 21–25, Jeremiah – Malachi |

Six phases at ~3 chapters each. Each phase gets a plate-relative position within stage 5 rather than its own plate, so the plate architecture from §15 is untouched.

---

## 2. The full mapping — stage → chapter → passages

Ascent stages 1–5, summit 6, descent 7–11. Chapter numbers are The Story's; **bold** entries are the four proposed additions.

### Stage 1 · Creation — Genesis 1–2
- **1** Creation: The Beginning of Life as We Know It — Genesis 1–2 *(chapter 1 continues into stages 2–3)*

### Stage 2 · Sin Enters — Genesis 3–5
- **1** (cont.) — Genesis 3–4

### Stage 3 · The Flood — Genesis 6–9
- **1** (cont.) — Genesis 6–9

### Stage 4 · Babel — Genesis 10–11
- **1b · The Tower** — Genesis 10–11 *(addition)*

### Stage 5 · Israel — Genesis 12 – Malachi

**Patriarchs**
- 2 God Builds a Nation — Genesis 12–13; 15–17; 21–22; 32–33; 35; Romans 4; Hebrews 11
- 3 Joseph: From Slave to Deputy Pharaoh — Genesis 37; 39; 41–48; 50

**Exodus**
- 4 Deliverance — Exodus 1–7; 10–17
- 5 New Commands and a New Covenant — Exodus 19–20; 24–25; 32–34; 40
- 6 Wandering — Numbers 10–14; 20–21; 25; 27; Deuteronomy 1–2; 4; 6; 8–9; 29–32; 34 *(shown as "Numbers 10–27 · Deuteronomy 1–34" where space is tight)*

**Conquest**
- 7 The Battle Begins — Joshua 1–2; 6; 8; 10–11; 23–24
- 8 A Few Good Men … and Women — Judges 2–4; 6–8; 13–16
- 9 The Faith of a Foreign Woman — Ruth 1–4

**Kingdom**
- 10 Standing Tall, Falling Hard — 1 Samuel 1–4; 8–13; 15
- 11 From Shepherd to King — 1 Samuel 16–18; 24; 31; 2 Samuel 6; 22; 1 Chronicles 17; Psalm 59
- 12 The Trials of a King — 2 Samuel 11–12; 18–19; 1 Chronicles 22; 29; Psalms 23; 32; 51
- 13 The King Who Had It All — 1 Kings 1–8; 10–11; 2 Chronicles 5–7; Proverbs 1–3; 6; 20–21

**Divided & Warned**
- 14 A Kingdom Torn in Two — 1 Kings 12–16
- 15 God's Messengers — 1 Kings 17–19; 2 Kings 2; 4; 6; Hosea 4–5; 8–9; 14; Amos 1; 3–5; 9
- 16 The Beginning of the End — 2 Kings 17–19; Isaiah 3; 6; 13–14; 49; 53

**Exile & Return**
- 17 The Kingdoms' Fall — 2 Kings 21; 23–25; 2 Chronicles 33; 36; Jeremiah 1–2; 4–5; 13; 21; Lamentations 1–3; 5; Ezekiel 1–2; 6–7; 36–37
- 18 Daniel in Exile — Daniel 1–3; 6; Jeremiah 29–31
- 19 The Return Home — Ezra 1–6; Haggai 1–2; Zechariah 1; 8
- 20 The Queen of Beauty and Courage — Esther 1–9
- 21 Rebuilding the Walls — Ezra 7; Nehemiah 1–2; 4; 6–8; Malachi 1–4

### Stage 6 · Gospels — the summit
- 22 The Birth of the King — Matthew 1–2; Luke 1–2; John 1
- 23 Jesus' Ministry Begins — Matthew 3–4; 11; Mark 1–3; Luke 8; John 1–4
- 24 No Ordinary Man — Matthew 5–7; 9; 14; Mark 4–6; Luke 10; 15; John 6
- 25 Jesus, the Son of God — Matthew 17; 21; Mark 8–12; 14; Luke 9; 22; John 7–8; 11–12
- 26 The Hour of Darkness — Matthew 26–27; Mark 14–15; Luke 22–23; John 13–14; 16–19
- 27 The Resurrection — Matthew 27–28; Mark 16; Luke 24; John 19–21

### Stage 7 · Church — Acts – Jude
- 28 New Beginnings — Acts 1–10; 12
- 29 Paul's Mission — Acts 13–14; 16–20; Romans 1; 3–6; 8; 12; 15; 1 Corinthians 1; 3; 5–6; 10; 12–13; 15–16; Galatians 1; 3; 5–6; 1 Thessalonians 1–5
- 30 Paul's Final Days — Acts 20–23; 27–28; Ephesians 1–6; 2 Timothy 1–4

### Stage 8 · Babylon — Revelation 12–18
- **31b · The Beast and the City** — Revelation 12–18 *(addition)*

### Stage 9 · World Judged — Revelation 6–11
- **31a · The Scroll and the Trumpets** — Revelation 6–11 *(addition)*

### Stage 10 · Satan Cast Out — Revelation 19–20
- **31c · The Rider and the Chain** — Revelation 19–20 *(addition)*

### Stage 11 · Paradise Restored — Revelation 21–22
- 31 The End of Time — Revelation 1–5; 21–22

---

## 3. The mirror pairs, verified against the mapping

| Pair | Ascent | Descent | Both sides covered? |
|---|---|---|---|
| 1 | Stage 1 Creation (Gen 1–2) | Stage 11 Paradise Restored (Rev 21–22) | Yes — ch 1 / ch 31 |
| 2 | Stage 2 Sin Enters (Gen 3–4) | Stage 10 Satan Cast Out (Rev 19–20) | Only with addition **31c** |
| 3 | Stage 3 The Flood (Gen 6–9) | Stage 9 World Judged (Rev 6–11) | Only with addition **31a** |
| 4 | Stage 4 Babel (Gen 10–11) | Stage 8 Babylon (Rev 12–18) | Only with additions **1b** and **31b** |
| 5 | Stage 5 Israel (Gen 12 – Mal) | Stage 7 Church (Acts – Jude) | Yes — ch 2–21 / ch 28–30 |

Three of five mirrors depend on the four additions. That is the argument for 35 over 31, in one table.

---

## 4. Data shape

One row per chapter. Chapter is the reading unit; stage is the map unit; phase only exists inside stage 5.

```json
{
  "id": "story-13",
  "n": 13,
  "label": "13",
  "title": "The King Who Had It All",
  "altTitle": "Solomon",
  "stage": 5,
  "phase": "kingdom",
  "passages": [
    { "book": "1KI", "from": 1, "to": 8 },
    { "book": "1KI", "from": 10, "to": 11 },
    { "book": "2CH", "from": 5, "to": 7 },
    { "book": "PRO", "from": 1, "to": 3 },
    { "book": "PRO", "from": 6, "to": 6 },
    { "book": "PRO", "from": 20, "to": 21 }
  ],
  "source": "the-story",
  "chapterCount": 19
}
```

Notes for implementation:
- `altTitle` is the rename escape hatch from the header — ship whichever field the settings flag points at.
- `source` is `"the-story"` or `"scarlet-thread"` (the four additions), so the UI can offer "read the 31 as published" vs "read all 35."
- `chapterCount` is summed from `passages` and is what drives proportional spacing on the mountain — it is the same input the plate-reflow tests in MOUNTAINPLATES already cover.
- Book codes should match whatever `web/public/bible/BSB/` already uses; do not invent a second scheme.

---

## 5. Daily loop cadence — from Maxwell

Maxwell's devotional contributes shape, not content. Nothing of his text ships. The pattern worth taking, from 365 entries in a fixed form:

**One verse. One idea. One question.** Every entry is a single anchor verse, roughly 250 words of one thought, and exactly one question at the end. Never two questions, never a list of applications, never a passage plus a sidebar plus a prompt.

What that changes in the current loop:

1. **The chapter is not the daily unit — the anchor verse is.** A Story chapter averages 19 Bible chapters, far past a sitting. Each reading day gets one anchor verse from that day's portion, shown first, before the wider reading. It gives the day a spine even when the reading is long.
2. **One question, at the end, and it closes the day.** The current loop asks for three observations, a thread, a question, and a prayer — five prompts. Keep all five as *available*, but the day's required question is one, and it is the last thing on screen. Everything above it is optional.
3. **A fixed daily shape beats a varied one.** Maxwell's format never changes across 365 days, which is why it survives being done half-awake. The loop should look identical every day — same order, same positions, no dynamic re-arranging based on what the user did yesterday.
4. **~250 words is the ceiling for anything the app says.** Any app-authored copy on a reading day — stage context, phase note, mirror reminder — shares one 250-word budget. Past that the user is reading the app instead of the Bible.

What not to take: the leadership lens (wrong frame — the app is not a leadership product), and the 365-day fixed calendar. **35 chapters is not 365 days.** At 3–5 reading days per chapter the whole mountain is 15–20 weeks, not a year. Do not stretch it to a year for the sake of a round number; a completed 18-week climb is worth more than an abandoned annual plan.

---

## 6. Open decisions

1. **31 or 35 chapters?** My recommendation is 35 — three of five mirrors fail without the additions.
2. **Zondervan titles or renamed?** Ship-safe either way; renaming removes an editorial dependency.
3. **Reading days per chapter** — 3, 4, or 5? Affects total length (15, 20, or 25 weeks) and whether the anchor-verse-per-day model needs 105, 140, or 175 anchor verses authored.
4. **Does the sub-arc get its own route** (`/stage/5/phase/kingdom`) or is it a filter on the existing stage view? Cheaper as a filter; clearer as a route.
