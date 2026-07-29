"""Bible-Brain vault -> visual map.

Scans the Obsidian vault and renders a self-contained dark-theme HTML page:
the mountain with its mirror pairs, thread strength by inbound links, the
1,189-chapter reading grid, and a Sunday-review integrity panel.

Nothing is hardcoded about the content -- every number comes from the vault,
so the map cannot drift from the notes. Re-run it whenever you want a fresh
picture (Sunday review is the natural cadence).

Usage:  py build_map.py
Author: Kenneth Hill
"""

from __future__ import annotations

import html
import json
import re
import urllib.parse
from dataclasses import dataclass, field
from datetime import date, timedelta
from pathlib import Path

VAULT_DIR = Path(__file__).parent / "Bible-Brain"
OUTPUT_FILE = Path(__file__).parent / "Bible-Brain-Map.html"
VAULT_NAME = "Bible-Brain"

TOTAL_CHAPTERS = 1189

WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]")
FRONTMATTER = re.compile(r"\A---\r?\n(.*?)\r?\n---\r?\n", re.DOTALL)
HTML_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
TRACKER_ROW = re.compile(
    r"^- \[( |x|X)\]\s*\*\*(?P<book>[^*]+)\*\*\s*·\s*(?P<ch>\d+) ch", re.MULTILINE
)


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------


@dataclass
class Note:
    """One markdown file in the vault."""

    path: Path
    folder: str
    name: str
    title: str
    frontmatter: dict[str, str] = field(default_factory=dict)
    sections: dict[str, str] = field(default_factory=dict)
    links: list[str] = field(default_factory=list)

    @property
    def rel_path(self) -> str:
        return self.path.relative_to(VAULT_DIR).as_posix()[: -len(".md")]

    @property
    def obsidian_uri(self) -> str:
        # quote(), not urlencode() -- Obsidian's URI handler reads "+" as a literal
        # plus sign, so spaces must come through as %20.
        vault = urllib.parse.quote(VAULT_NAME, safe="")
        target = urllib.parse.quote(self.rel_path, safe="")
        return f"obsidian://open?vault={vault}&file={target}"


def strip_link(raw: str) -> str:
    """`"[[Gen 01-02 — Creation]]"` -> `Gen 01-02 — Creation`."""
    value = raw.strip().strip('"').strip("'")
    match = WIKILINK.search(value)
    return match.group(1).strip() if match else value


def parse_frontmatter(text: str) -> tuple[dict[str, str], str]:
    match = FRONTMATTER.match(text)
    if not match:
        return {}, text
    data: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if ":" not in line or line.lstrip().startswith("#"):
            continue
        key, _, value = line.partition(":")
        data[key.strip()] = value.strip()
    return data, text[match.end() :]


def parse_sections(body: str) -> dict[str, str]:
    sections: dict[str, str] = {}
    current = ""
    buffer: list[str] = []
    for line in body.splitlines():
        if line.startswith("## "):
            if current:
                sections[current] = "\n".join(buffer).strip()
            current = line[3:].strip()
            buffer = []
        elif current:
            buffer.append(line)
    if current:
        sections[current] = "\n".join(buffer).strip()
    return sections


def has_content(section: str | None) -> bool:
    """True if a section holds real writing (not just bullets/comments/blanks)."""
    if not section:
        return False
    cleaned = HTML_COMMENT.sub("", section)
    cleaned = re.sub(r"^\s*[-*]\s*$", "", cleaned, flags=re.MULTILINE)
    return bool(cleaned.strip())


def count_bullets(section: str | None) -> int:
    if not section:
        return 0
    cleaned = HTML_COMMENT.sub("", section)
    return sum(
        1
        for line in cleaned.splitlines()
        if line.lstrip().startswith(("- ", "* "))
        and line.lstrip()[2:].strip()
        and not line.lstrip().startswith("- [[]]")
    )


def load_notes() -> list[Note]:
    notes: list[Note] = []
    for path in sorted(VAULT_DIR.rglob("*.md")):
        text = path.read_text(encoding="utf-8")
        frontmatter, body = parse_frontmatter(text)
        title_match = re.search(r"^# (.+)$", body, re.MULTILINE)
        relative = path.relative_to(VAULT_DIR)
        notes.append(
            Note(
                path=path,
                folder=relative.parts[0] if len(relative.parts) > 1 else "",
                name=path.stem,
                title=title_match.group(1).strip() if title_match else path.stem,
                frontmatter=frontmatter,
                sections=parse_sections(body),
                links=[m.group(1).strip() for m in WIKILINK.finditer(body) if m.group(1).strip()],
            )
        )
    return notes


# --------------------------------------------------------------------------
# Derivation
# --------------------------------------------------------------------------


def split_label(name: str) -> tuple[str, str]:
    """`Gen 01-02 — Creation` -> (`Gen 01-02`, `Creation`)."""
    for dash in (" — ", " – ", " - "):
        if dash in name:
            head, _, tail = name.partition(dash)
            return head.strip(), tail.strip()
    return name, ""


def build_mountain(passages: list[Note], inbound: dict[str, int]) -> list[dict]:
    stages: list[dict] = []
    for note in passages:
        raw_stage = note.frontmatter.get("stage", "").strip()
        if not raw_stage.isdigit():
            continue
        stage = int(raw_stage)
        reference, short_title = split_label(note.name)
        threads = [link for link in note.links if link in THREAD_NAMES]
        stages.append(
            {
                "stage": stage,
                "side": note.frontmatter.get("side", "").strip(),
                "name": note.name,
                "title": note.title,
                "reference": reference,
                "short": short_title,
                "mirror": strip_link(note.frontmatter.get("mirror", "")),
                "threads": sorted(set(threads)),
                "inbound": inbound.get(note.name, 0),
                "observations": count_bullets(note.sections.get("Observation")),
                "questions": count_bullets(note.sections.get("Questions")),
                "studied": has_content(note.sections.get("My notes")),
                "ink": has_content(note.sections.get("Ink")),
                "uri": note.obsidian_uri,
            }
        )
    return sorted(stages, key=lambda item: item["stage"])


def build_threads(threads: list[Note], inbound: dict[str, int]) -> list[dict]:
    rows: list[dict] = []
    for note in threads:
        one_line = re.search(r"\*\*In one line:\*\*\s*(.+)", note.path.read_text(encoding="utf-8"))
        rows.append(
            {
                "name": note.name,
                "definition": one_line.group(1).strip() if one_line else "",
                "inbound": inbound.get(note.name, 0),
                "outbound": len(set(note.links)),
                "seeing": has_content(note.sections.get("What I'm seeing")),
                "uri": note.obsidian_uri,
            }
        )
    return sorted(rows, key=lambda row: (-row["inbound"], row["name"]))


def build_reading(tracker: Note | None) -> list[dict]:
    if tracker is None:
        return []
    text = tracker.path.read_text(encoding="utf-8")
    books: list[dict] = []
    for match in TRACKER_ROW.finditer(text):
        books.append(
            {
                "book": match.group("book").strip(),
                "chapters": int(match.group("ch")),
                "done": match.group(1).lower() == "x",
            }
        )
    return books


def build_log(notes: list[Note]) -> dict:
    entries: list[str] = []
    for note in notes:
        if note.folder != "05 Log" or note.name.startswith("_"):
            continue
        if re.fullmatch(r"\d{4}-\d{2}-\d{2}", note.name):
            entries.append(note.name)
    entries.sort()
    streak = 0
    if entries:
        seen = set(entries)
        cursor = date.fromisoformat(entries[-1])
        while cursor.isoformat() in seen:
            streak += 1
            cursor -= timedelta(days=1)
    return {"count": len(entries), "streak": streak, "last": entries[-1] if entries else None}


def build_review(notes: list[Note], stages: list[dict], inbound: dict[str, int]) -> dict:
    known = {note.name for note in notes}
    studied_folders = {"01 Passages", "02 Threads", "03 People", "04 Teaching"}

    broken: list[dict] = []
    orphans: list[dict] = []
    for note in notes:
        if note.folder not in studied_folders or note.name.startswith("_"):
            continue
        for link in sorted(set(note.links)):
            if link not in known:
                broken.append({"source": note.name, "target": link})
        if not set(note.links) and inbound.get(note.name, 0) == 0:
            orphans.append({"name": note.name, "folder": note.folder})

    by_name = {item["name"]: item for item in stages}
    mirror_breaks: list[dict] = []
    for item in stages:
        partner = item["mirror"]
        if not partner:
            continue
        if partner not in by_name:
            mirror_breaks.append({"stage": item["name"], "issue": f"mirror '{partner}' not found"})
        elif by_name[partner]["mirror"] != item["name"]:
            mirror_breaks.append({"stage": item["name"], "issue": f"'{partner}' does not point back"})

    return {"broken": broken, "orphans": orphans, "mirrors": mirror_breaks}


# --------------------------------------------------------------------------
# Render
# --------------------------------------------------------------------------

PAGE = """<!doctype html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Bible Brain — Map</title>
<style>
:root {
  color-scheme: dark;
  --surface-1: #0f1923;
  --surface-2: #16232f;
  --text-primary: #ffffff;
  --text-secondary: #a9bccd;
  --text-muted: #6f8497;
  --series-1: #3987e5;
  --accent: #2e75b6;
  --critical: #d03b3b;
  --grid: #223342;
  --baseline: #2c4152;
  --track: #1b2b39;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--surface-1);
  color: var(--text-primary);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 14px;
  line-height: 1.5;
}
.wrap { max-width: 1240px; margin: 0 auto; padding: 32px 24px 72px; }
header { border-bottom: 1px solid var(--grid); padding-bottom: 20px; margin-bottom: 28px; }
h1 { font-size: 20px; margin: 0 0 4px; letter-spacing: .02em; }
.sub { color: var(--text-muted); font-size: 13px; margin: 0; }
h2 {
  font-size: 12px; text-transform: uppercase; letter-spacing: .1em;
  color: var(--text-muted); font-weight: 600; margin: 0 0 4px;
}
.note { color: var(--text-muted); font-size: 12px; margin: 0 0 16px; }
section { margin-bottom: 44px; }

.hero { display: flex; align-items: baseline; gap: 14px; margin: 18px 0 6px; }
.hero .fig { font-size: 56px; font-weight: 650; line-height: 1; color: var(--text-primary); }
.hero .unit { font-size: 15px; color: var(--text-secondary); }
.meter { height: 10px; background: var(--track); border-radius: 5px; overflow: hidden; margin: 10px 0 6px; }
.meter > span { display: block; height: 100%; background: var(--series-1); border-radius: 5px; }

.kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1px;
        background: var(--grid); border: 1px solid var(--grid); border-radius: 8px; overflow: hidden; }
.kpi { background: var(--surface-2); padding: 14px 16px; }
.kpi .v { font-size: 26px; font-weight: 600; line-height: 1.15; }
.kpi .l { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: .08em; }

.scroll { overflow-x: auto; }
svg { display: block; }
.tie { stroke: var(--baseline); stroke-width: 1; stroke-dasharray: 3 4; }
.ridge { fill: none; stroke: var(--baseline); stroke-width: 2; }
.ridge-fill { fill: var(--series-1); fill-opacity: .06; stroke: none; }
.node { cursor: pointer; }
.node circle { stroke-width: 2; transition: r .12s ease; }
.node .lab { font-size: 11px; font-weight: 600; fill: var(--text-primary); }
.node .lab2 { font-size: 10px; fill: var(--text-muted); }
.node:hover circle { stroke: #ffffff; }
.axis-lab { font-size: 10px; fill: var(--text-muted); letter-spacing: .08em; text-transform: uppercase; }

.bar-row { display: grid; grid-template-columns: 168px 1fr 34px; gap: 12px; align-items: center;
           padding: 3px 0; cursor: pointer; }
.bar-row:hover .bar-name { color: #fff; }
.bar-name { font-size: 12px; color: var(--text-secondary); text-align: right; overflow: hidden;
            text-overflow: ellipsis; white-space: nowrap; }
.bar-track { height: 14px; background: var(--track); border-radius: 3px; }
.bar-fill { height: 100%; background: var(--series-1); border-radius: 0 4px 4px 0; min-width: 2px; }
.bar-val { font-size: 12px; color: var(--text-secondary); font-variant-numeric: tabular-nums; }

.grid-legend { display: flex; gap: 18px; align-items: center; margin: 0 0 12px; font-size: 12px;
               color: var(--text-secondary); }
.swatch { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px;
          vertical-align: -1px; }
.chapters { display: flex; flex-wrap: wrap; gap: 2px; }
.bk { display: flex; flex-wrap: wrap; gap: 2px; margin-right: 8px; margin-bottom: 6px; }
.ch { width: 7px; height: 7px; border-radius: 1px; background: var(--track); }
.ch.done { background: var(--series-1); }
.testament { font-size: 11px; color: var(--text-muted); text-transform: uppercase;
             letter-spacing: .1em; margin: 18px 0 10px; }

.panel { background: var(--surface-2); border: 1px solid var(--grid); border-radius: 8px; padding: 16px 18px; }
.panel h3 { font-size: 12px; margin: 0 0 8px; letter-spacing: .06em; text-transform: uppercase;
            color: var(--text-secondary); font-weight: 600; }
.panel ul { margin: 0 0 18px; padding-left: 18px; color: var(--text-secondary); font-size: 13px; }
.panel li { margin-bottom: 3px; }
.panel ul:last-child { margin-bottom: 0; }
.ok { color: var(--text-muted); font-size: 13px; }
.flag { color: var(--critical); font-weight: 600; }

#tip { position: fixed; pointer-events: none; opacity: 0; transition: opacity .1s;
       background: #050c13; border: 1px solid var(--baseline); border-radius: 6px;
       padding: 8px 11px; font-size: 12px; max-width: 280px; z-index: 40;
       box-shadow: 0 6px 20px rgba(0,0,0,.5); }
#tip b { display: block; margin-bottom: 3px; font-size: 12px; }
#tip span { color: var(--text-secondary); }
table.data { border-collapse: collapse; width: 100%; font-size: 12px; margin-top: 10px; }
table.data th, table.data td { text-align: left; padding: 5px 10px 5px 0; border-bottom: 1px solid var(--grid);
                               color: var(--text-secondary); }
table.data th { color: var(--text-muted); font-weight: 600; text-transform: uppercase;
                letter-spacing: .06em; font-size: 10px; }
table.data td.n { font-variant-numeric: tabular-nums; }
details summary { cursor: pointer; color: var(--text-muted); font-size: 12px; margin-top: 12px; }
footer { color: var(--text-muted); font-size: 12px; border-top: 1px solid var(--grid); padding-top: 16px; }
a { color: var(--accent); }
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>Bible Brain — Map</h1>
  <p class="sub">Generated from the vault __GENERATED__ · click anything to open it in Obsidian</p>
</header>
__BODY__
<footer>
  Every number on this page is read out of <code>Bible-Brain/</code>. Re-run <code>py build_map.py</code>
  after a study session to refresh it. Nothing here is a second place to write — Obsidian stays
  the place you write; this is the place you see.
</footer>
</div>
<div id="tip"></div>
<script>
const tip = document.getElementById('tip');
function showTip(e, title, body) {
  tip.innerHTML = '<b>' + title + '</b><span>' + body + '</span>';
  tip.style.opacity = '1';
  const pad = 14, w = tip.offsetWidth, h = tip.offsetHeight;
  let x = e.clientX + pad, y = e.clientY + pad;
  if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
  if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
  tip.style.left = x + 'px';
  tip.style.top = y + 'px';
}
document.querySelectorAll('[data-tip]').forEach(el => {
  el.addEventListener('mousemove', e => showTip(e, el.dataset.tipTitle, el.dataset.tip));
  el.addEventListener('mouseleave', () => tip.style.opacity = '0');
});
document.querySelectorAll('[data-uri]').forEach(el => {
  el.addEventListener('click', () => window.location.href = el.dataset.uri);
});
</script>
</body>
</html>
"""


def esc(value: str) -> str:
    return html.escape(str(value), quote=True)


def render_mountain(stages: list[dict]) -> str:
    if not stages:
        return '<p class="ok">No staged passage notes found.</p>'

    width, height = 1200, 500
    left, top, col, row = 92, 54, 102, 68
    peak = max(item["stage"] for item in stages) // 2 + 1

    points: list[tuple[float, float, dict]] = []
    for item in stages:
        level = (peak - 1) - abs(item["stage"] - peak)
        x = left + (item["stage"] - 1) * col
        y = top + ((peak - 1) - level) * row
        points.append((x, y, item))

    ridge = " ".join(f"{x:.0f},{y:.0f}" for x, y, _ in points)
    base_y = top + (peak - 1) * row
    fill = f"{points[0][0]:.0f},{base_y:.0f} {ridge} {points[-1][0]:.0f},{base_y:.0f}"

    by_name = {item["name"]: (x, y) for x, y, item in points}
    ties: list[str] = []
    drawn: set[tuple[str, str]] = set()
    for x, y, item in points:
        partner = item["mirror"]
        if partner in by_name and tuple(sorted((item["name"], partner))) not in drawn:
            drawn.add(tuple(sorted((item["name"], partner))))
            px, _ = by_name[partner]
            ties.append(f'<line class="tie" x1="{x:.0f}" y1="{y:.0f}" x2="{px:.0f}" y2="{y:.0f}"/>')

    max_inbound = max((item["inbound"] for _, _, item in points), default=0)
    nodes: list[str] = []
    for x, y, item in points:
        weight = item["inbound"] / max_inbound if max_inbound else 0
        radius = 7 + weight * 7
        studied = item["studied"]
        color = "var(--series-1)" if studied else "var(--surface-1)"
        stroke = "var(--series-1)" if studied else "var(--baseline)"
        threads = ", ".join(item["threads"]) or "none yet"
        body = (
            f"{esc(item['title'])}<br>{item['observations']} observations · "
            f"{item['questions']} open questions<br>Threads: {esc(threads)}<br>"
            f"{'Your notes written' if studied else 'Not studied yet'}"
            f"{' · ink linked' if item['ink'] else ''}"
        )
        nodes.append(
            f'<g class="node" data-uri="{esc(item["uri"])}" data-tip-title="{esc(item["name"])}" '
            f'data-tip="{body}">'
            f'<circle cx="{x:.0f}" cy="{y:.0f}" r="{radius:.1f}" fill="{color}" stroke="{stroke}"/>'
            f'<text class="lab" x="{x:.0f}" y="{y + radius + 15:.0f}" text-anchor="middle">'
            f"{esc(item['reference'])}</text>"
            f'<text class="lab2" x="{x:.0f}" y="{y + radius + 28:.0f}" text-anchor="middle">'
            f"{esc(item['short'])}</text></g>"
        )

    studied_count = sum(1 for _, _, item in points if item["studied"])
    rows = "".join(
        f"<tr><td>{esc(i['name'])}</td><td>{esc(i['side'])}</td>"
        f'<td class="n">{i["inbound"]}</td><td class="n">{i["observations"]}</td>'
        f'<td class="n">{i["questions"]}</td><td>{"yes" if i["studied"] else "—"}</td></tr>'
        for _, _, i in points
    )

    return f"""<section>
  <h2>The Mountain</h2>
  <p class="note">Eleven stages. Position is the structure — Genesis climbs the left, the Gospels
     sit at the peak, Revelation descends the right, and each mirror pair sits at the same
     elevation, joined by a dashed tie. Colour is your work: filled means you've written under
     <em>My notes</em>, hollow means you haven't. Node size grows with links running in.
     {studied_count} of {len(points)} stages studied.</p>
  <div class="scroll"><svg viewBox="0 0 {width} {height}" width="100%" height="{height}"
       role="img" aria-label="The eleven stages of the mountain with mirror pairs">
    <text class="axis-lab" x="{left}" y="26">Ascent · Genesis</text>
    <text class="axis-lab" x="{width / 2:.0f}" y="26" text-anchor="middle">Peak · The Gospels</text>
    <text class="axis-lab" x="{width - left}" y="26" text-anchor="end">Descent · Revelation</text>
    <polygon class="ridge-fill" points="{fill}"/>
    {"".join(ties)}
    <polyline class="ridge" points="{ridge}"/>
    {"".join(nodes)}
  </svg></div>
  <details><summary>Table view</summary>
    <table class="data"><thead><tr><th>Stage</th><th>Side</th><th>Links in</th>
      <th>Obs</th><th>Questions</th><th>Studied</th></tr></thead><tbody>{rows}</tbody></table>
  </details>
</section>"""


def render_threads(threads: list[dict]) -> str:
    if not threads:
        return ""
    top_value = max(row["inbound"] for row in threads) or 1
    bars: list[str] = []
    for row in threads:
        pct = row["inbound"] / top_value * 100
        body = (
            f"{esc(row['definition'])}<br>{row['inbound']} notes link in · "
            f"{row['outbound']} links out"
            f"{'<br>You have written under What I am seeing' if row['seeing'] else ''}"
        )
        bars.append(
            f'<div class="bar-row" data-uri="{esc(row["uri"])}" '
            f'data-tip-title="{esc(row["name"])}" data-tip="{body}">'
            f'<div class="bar-name">{esc(row["name"])}</div>'
            f'<div class="bar-track"><div class="bar-fill" style="width:{pct:.1f}%"></div></div>'
            f'<div class="bar-val">{row["inbound"]}</div></div>'
        )
    leader = threads[0]
    rows = "".join(
        f'<tr><td>{esc(r["name"])}</td><td class="n">{r["inbound"]}</td>'
        f'<td class="n">{r["outbound"]}</td><td>{esc(r["definition"])}</td></tr>'
        for r in threads
    )
    return f"""<section>
  <h2>Thread strength</h2>
  <p class="note">Notes linking in, per thread. The longest bar is where God has been working on
     you — it is usually not the one you expected. <strong>{esc(leader["name"])}</strong> leads with
     {leader["inbound"]}.</p>
  {"".join(bars)}
  <details><summary>Table view</summary>
    <table class="data"><thead><tr><th>Thread</th><th>In</th><th>Out</th><th>In one line</th></tr>
      </thead><tbody>{rows}</tbody></table>
  </details>
</section>"""


def render_reading(books: list[dict], ot_count: int) -> str:
    if not books:
        return ""
    done_chapters = sum(b["chapters"] for b in books if b["done"])
    groups: list[str] = []
    for index, book in enumerate(books):
        if index == ot_count:
            groups.append('</div><p class="testament">New Testament — 260 chapters</p>'
                          '<div class="chapters">')
        cells = "".join(
            f'<i class="ch{" done" if book["done"] else ""}"></i>' for _ in range(book["chapters"])
        )
        state = "read" if book["done"] else "not yet"
        groups.append(
            f'<div class="bk" data-tip-title="{esc(book["book"])}" '
            f'data-tip="{book["chapters"]} chapters · {state}">{cells}</div>'
        )
    return f"""<section>
  <h2>Wide gear — the whole Bible</h2>
  <p class="note">One cell per chapter, grouped by book, in canonical order. This is the shape of
     the territory; it fills in as you tick books off in the tracker note.
     {done_chapters:,} of {TOTAL_CHAPTERS:,} chapters read.</p>
  <div class="grid-legend">
    <span><i class="swatch" style="background:var(--series-1)"></i>Read</span>
    <span><i class="swatch" style="background:var(--track)"></i>Not yet</span>
  </div>
  <p class="testament">Old Testament — 929 chapters</p>
  <div class="chapters">{"".join(groups)}</div>
</section>"""


def render_review(review: dict, threads: list[dict], log: dict) -> str:
    def listing(items: list[str], empty: str) -> str:
        if not items:
            return f'<p class="ok">{empty}</p>'
        return "<ul>" + "".join(f"<li>{item}</li>" for item in items) + "</ul>"

    broken = [
        f'<span class="flag">{esc(b["source"])}</span> → <code>[[{esc(b["target"])}]]</code>'
        for b in review["broken"]
    ]
    mirrors = [
        f'<span class="flag">{esc(m["stage"])}</span> — {esc(m["issue"])}' for m in review["mirrors"]
    ]
    orphans = [f'{esc(o["name"])} <em>({esc(o["folder"])})</em>' for o in review["orphans"]]
    cold = [esc(t["name"]) for t in threads if t["inbound"] == 0]

    streak = f"{log['streak']} day streak" if log["streak"] else "no current streak"
    return f"""<section>
  <h2>Sunday review</h2>
  <p class="note">The four things worth checking weekly. {log['count']} daily log entries ·
     {esc(streak)}{f" · last entry {esc(log['last'])}" if log['last'] else ""}.</p>
  <div class="panel">
    <h3>Broken links</h3>
    {listing(broken, "None — every wikilink resolves to a real note.")}
    <h3>Mirror integrity</h3>
    {listing(mirrors, "All mirror pairs point both ways.")}
    <h3>Orphans — connect them or delete them</h3>
    {listing(orphans, "No orphans. Everything is connected to something.")}
    <h3>Threads with nothing linking in yet</h3>
    {listing(cold, "Every thread has at least one passage running into it.")}
  </div>
</section>"""


def render_summary(stages: list[dict], threads: list[dict], books: list[dict], log: dict,
                   total_links: int) -> str:
    done_chapters = sum(b["chapters"] for b in books if b["done"])
    pct = done_chapters / TOTAL_CHAPTERS * 100
    open_questions = sum(item["questions"] for item in stages)
    studied = sum(1 for item in stages if item["studied"])
    return f"""<section>
  <h2>Where you are</h2>
  <div class="hero">
    <span class="fig">{pct:.0f}%</span>
    <span class="unit">of the Bible read · {done_chapters:,} of {TOTAL_CHAPTERS:,} chapters</span>
  </div>
  <div class="meter"><span style="width:{pct:.2f}%"></span></div>
  <div class="kpis">
    <div class="kpi"><div class="v">{studied}/{len(stages)}</div><div class="l">Stages studied</div></div>
    <div class="kpi"><div class="v">{len(threads)}</div><div class="l">Threads</div></div>
    <div class="kpi"><div class="v">{total_links}</div><div class="l">Links in the vault</div></div>
    <div class="kpi"><div class="v">{open_questions}</div><div class="l">Open questions</div></div>
    <div class="kpi"><div class="v">{log['streak']}</div><div class="l">Day streak</div></div>
  </div>
</section>"""


# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

THREAD_NAMES: set[str] = set()


def main() -> None:
    global THREAD_NAMES

    if not VAULT_DIR.exists():
        raise SystemExit(f"Vault not found: {VAULT_DIR}")

    notes = load_notes()
    THREAD_NAMES = {n.name for n in notes if n.folder == "02 Threads"}

    inbound: dict[str, int] = {}
    total_links = 0
    for note in notes:
        if note.name.startswith("_") or note.folder == "99 Templates":
            continue
        for link in set(note.links):
            inbound[link] = inbound.get(link, 0) + 1
            total_links += 1

    passages = [n for n in notes if n.folder == "01 Passages"]
    thread_notes = [n for n in notes if n.folder == "02 Threads"]
    tracker = next((n for n in notes if n.name.startswith("Wide Gear")), None)

    stages = build_mountain(passages, inbound)
    threads = build_threads(thread_notes, inbound)
    books = build_reading(tracker)
    log = build_log(notes)
    review = build_review(notes, stages, inbound)

    ot_count = 39 if len(books) >= 39 else len(books)

    body = "".join(
        [
            render_summary(stages, threads, books, log, total_links),
            render_mountain(stages),
            render_threads(threads),
            render_reading(books, ot_count),
            render_review(review, threads, log),
        ]
    )

    page = PAGE.replace("__BODY__", body).replace("__GENERATED__", date.today().isoformat())
    OUTPUT_FILE.write_text(page, encoding="utf-8")

    print(f"Wrote {OUTPUT_FILE.name}")
    print(f"  {len(notes)} notes · {len(stages)} stages · {len(threads)} threads · {total_links} links")
    print(f"  {sum(b['chapters'] for b in books if b['done']):,}/{TOTAL_CHAPTERS:,} chapters read")
    if review["broken"] or review["mirrors"]:
        print(f"  {len(review['broken'])} broken links · {len(review['mirrors'])} mirror problems")


if __name__ == "__main__":
    main()
