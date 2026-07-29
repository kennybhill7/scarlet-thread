# Versification report — Spanish vs English

**SBL** (Santa Biblia libre Latinoamericano) compared against **BSB**.

- Spanish verses: **31,103**
- English verses: **31,102**
- Difference: **+1**
- Chapters where counts differ: **2**

## Chapters needing a verse map

The parallel reader must not assume 1:1 alignment in these chapters.

| Book | Chapter | Spanish | English | Δ |
|---|---:|---:|---:|---:|
| Romans | 14 | 26 | 23 | +3 |
| Romans | 16 | 25 | 27 | -2 |

## Resolution

Declared in `VERSE_MAP` in `tools/build_spanish.py` and emitted to
`web/public/bible/versemap.json`. The parallel reader consumes it directly;
a `null` target means the opposite pane renders a gap rather than sliding out
of alignment.

| Spanish | English |
|---|---|
| `45.14.24` | `45.16.25` |
| `45.14.25` | `45.16.26` |
| `45.14.26` | `45.16.27` |
| `45.16.25` | — (no counterpart) |
