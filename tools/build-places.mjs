// PLACES-001 -- builds content/places/places.jsonl and content/places/DATASET.json from
// OpenBible.info Bible Geocoding Data (CC BY 4.0), plus the hand-maintained
// content/places/curation.json.  Adapted from design/globe-exploration/build-places.mjs
// (GLOBE-001 prototype: 21 hand-picked places) to cover the whole dataset.
//
//   git clone https://github.com/openbibleinfo/Bible-Geocoding-Data <dir>
//   git -C <dir> checkout 7eb18a5ee62f27b9b93bd6689ea272d76dd23b8f      # the pinned commit
//   node tools/build-places.mjs <dir>
//
// HONESTY RULES (carried over from the prototype; every one is re-checked at
// build time by web/scripts/content/placeSchema.ts and web/tests/places.test.ts):
//   1. Coordinates are COPIED from the dataset by this script. Nothing is typed by hand.
//   2. Every place has a tier: identified | likely | uncertain | disputed | unlocated.
//      The tier is computed by the rules below from the dataset's own scores (never the
//      score alone: a lone-source entry scores 1000 by default), and a person can override
//      it ONLY in curation.json, where the override is visible and reviewable.
//   3. uncertain / disputed places carry a plain-language note and/or candidates.
//   4. unlocated places have NO coordinates and NO candidates (no pin anywhere).
//   5. Attribution "Place data (c) OpenBible.info, CC BY 4.0" is written into DATASET.json
//      and the dataset commit is pinned; the build refuses any other commit.
//   6. Passage lists are the dataset's own verse lists.  A reference the dataset does not
//      list for a place can be added only through curation.json `extraPassages`, and is
//      then stored separately (`extraPassages`, flagged inDatasetVerseList=false downstream).
//
// Entries left OUT (counted, with ids, in DATASET.json `excluded`):
//   - no verse list in the dataset  (nothing to anchor the place to in Scripture)
//   - top identification is "not a place" / "not a proper name" (a common noun, not a place)
//   - anything named in curation.json `exclude`
//
// TIER RULES (computed; constants exported into DATASET.json `tierRules`):
//   unlocated  top-scoring identification is a "special" (unknown location, multiple
//              locations, ...) or no identification resolves to coordinates
//   disputed   a rival identification (or a sibling site of the chosen identification)
//              scores >= 0.6 x the chosen one
//   uncertain  the chosen identification's own dataset score is < 700
//   likely     score < 900, or fewer than 3 votes (a single source), or a weaker rival
//              scoring >= 0.15 x the chosen one
//   identified none of the above
// A region / river / route is still one representative point on the map; that is said in
// the note (rule 3 of the validator: kind region|route|water requires a note).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PINNED_COMMIT = '7eb18a5ee62f27b9b93bd6689ea272d76dd23b8f';
export const SOURCE_ID = 'source-openbible-geocoding';
export const ATTRIBUTION = 'Place data © OpenBible.info, CC BY 4.0';
export const TIER_RULES = {
  disputedRivalRatio: 0.6,
  uncertainBelowScore: 700,
  likelyBelowScore: 900,
  likelyBelowVotes: 3,
  likelyRivalRatio: 0.15,
  maxCandidates: 5,
  candidateMinScore: 1, // candidates need a positive dataset score
};

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(here, '..');
const outDir = path.join(repoRoot, 'content', 'places');

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'");
export const strip = (s) => decode((s || '').replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();

const WATER_TYPES = new Set(['river', 'canal', 'body of water', 'wadi']);
export function kindOf(resolution) {
  if (WATER_TYPES.has(resolution.type)) return 'water';
  if (resolution.ancient_geometry === 'path') return 'route';
  if (resolution.ancient_geometry === 'polygon') return 'region';
  return 'point';
}

function parseLonLat(s) {
  if (typeof s !== 'string') return null;
  const parts = s.split(',').map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
  const [lon, lat] = parts;
  if (lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return { lon, lat };
}

// The identification's marker: the located resolution with the highest best_path_score
// (first wins a tie).  Other located resolutions are sibling sites (candidates).
function locatedResolutions(ident) {
  const out = [];
  (ident.resolutions || []).forEach((res, k) => {
    const ll = parseLonLat(res.lonlat);
    if (ll) out.push({ k, res, ...ll, score: typeof res.best_path_score === 'number' ? res.best_path_score : 0 });
  });
  return out;
}
function bestResolution(list) {
  return list.reduce((best, cur) => (cur.score > best.score ? cur : best), list[0]);
}

export function computeTier({ score, votes, rivalScores, siblingRatioMax }) {
  const R = TIER_RULES;
  const rivalMax = rivalScores.length ? Math.max(...rivalScores) : -Infinity;
  const rivalRatio = score > 0 && rivalMax > 0 ? rivalMax / score : 0;
  if (rivalRatio >= R.disputedRivalRatio || siblingRatioMax >= R.disputedRivalRatio) return 'disputed';
  if (score < R.uncertainBelowScore) return 'uncertain';
  if (score < R.likelyBelowScore || votes < R.likelyBelowVotes || rivalRatio >= R.likelyRivalRatio) return 'likely';
  return 'identified';
}

const KIND_PHRASE = { region: 'a region', water: 'a river, canal or body of water', route: 'a route' };

function autoNote({ tier, kind, chosenDesc, score, votes, nCompeting, selectedSpecial, topSpecial, noLocation }) {
  const parts = [];
  if (tier === 'unlocated') {
    if (topSpecial === 'unknown_place') parts.push('No confident location: the top-scoring identification in the dataset is "unknown location", so no marker is placed.');
    else if (topSpecial === 'multiple_locations') parts.push('No single location: the dataset places this name at several different sites, so no marker is placed.');
    else if (topSpecial) parts.push(`No confident location: the dataset marks this name as "${topSpecial.replace(/_/g, ' ')}", so no marker is placed.`);
    else if (noLocation) parts.push('No confident location: none of the dataset\'s identifications for this name resolves to coordinates, so no marker is placed.');
    return parts.join(' ');
  }
  if (tier === 'disputed') {
    parts.push(`Location disputed: the dataset holds ${nCompeting} competing identification${nCompeting === 1 ? '' : 's'} of comparable strength; the marker shows the top-scoring one (${chosenDesc}), which is a proposal, not a settled fact.`);
  } else if (tier === 'uncertain') {
    parts.push(`Location uncertain: the best-supported identification in the dataset (${chosenDesc}) scores ${score} of about 1000, which is weak.`);
  } else if (votes < TIER_RULES.likelyBelowVotes) {
    parts.push(`Based on ${votes === 1 ? 'a single source' : `${votes} sources`} in the dataset (${chosenDesc}); treat as a likely identification, not a verified one.`);
  }
  if (KIND_PHRASE[kind]) parts.push(`The marker is one representative point for ${KIND_PHRASE[kind]}, not its extent.`);
  return parts.join(' ');
}

export function buildPlaces({ ancientRows, curation, commit }) {
  const cur = curation.places || {};
  const curExclude = curation.exclude || {};
  const byFriendly = new Map(ancientRows.map((r) => [r.friendly_id, r]));
  const problems = [];
  for (const key of [...Object.keys(cur), ...Object.keys(curExclude)]) {
    if (!byFriendly.has(key)) problems.push(`curation.json names "${key}", which is not in the dataset`);
  }
  const baseCount = new Map();
  for (const r of ancientRows) {
    const b = r.friendly_id.replace(/ \d+$/, '');
    baseCount.set(b, (baseCount.get(b) || 0) + 1);
  }

  const excluded = { noVerses: [], notAPlace: [], curated: [] };
  const places = [];
  const seenIds = new Map();

  for (const r of ancientRows) {
    const c = cur[r.friendly_id] || null;
    if (curExclude[r.friendly_id]) { excluded.curated.push(r.friendly_id); continue; }
    const verses = (r.verses || []).slice().sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));
    if (verses.length === 0) { excluded.noVerses.push(r.friendly_id); continue; }
    const idents = r.identifications || [];
    const top = idents[0];
    if (!top) { excluded.noVerses.push(r.friendly_id); continue; }
    if (top.special === 'not_a_place' || top.special === 'not_a_proper_name') { excluded.notAPlace.push(r.friendly_id); continue; }

    const located = idents.map((ident, i) => ({ ident, i, locs: ident.special ? [] : locatedResolutions(ident) })).filter((x) => x.locs.length > 0);
    let selected = located[0] || null;
    if (c && c.identificationIndex !== undefined) {
      selected = located.find((x) => x.i === c.identificationIndex) || null;
      if (!selected && c.tier !== 'unlocated') problems.push(`${r.friendly_id}: curation identificationIndex ${c.identificationIndex} has no coordinates`);
    }
    const topSpecial = top.special || null;
    let tier;
    let kind;
    let lon = null;
    let lat = null;
    let coordinateBasis = null;
    let modernName = null;
    let datasetScore;
    let votes;
    let note = '';
    let candidates = [];
    const identsWithScore = (i) => idents[i].score || {};

    if ((topSpecial && !(c && c.identificationIndex !== undefined)) || !selected) {
      tier = 'unlocated';
      kind = 'unlocated';
      datasetScore = identsWithScore(0).time_total ?? 0;
      votes = identsWithScore(0).vote_count ?? 0;
      note = autoNote({ tier, kind, topSpecial, noLocation: !topSpecial });
    } else {
      const chosenRes = bestResolution(selected.locs);
      const sc = selected.ident.score || {};
      datasetScore = sc.time_total ?? 0;
      votes = sc.vote_count ?? 0;
      lon = chosenRes.lon;
      lat = chosenRes.lat;
      coordinateBasis = chosenRes.res.lonlat_type || null;
      modernName = strip(chosenRes.res.description) || null;
      kind = kindOf(chosenRes.res);
      const chosenDesc = strip(selected.ident.description) || modernName || r.friendly_id;

      // rivals: other located identifications (score = identification time_total)
      const rivals = located.filter((x) => x !== selected).map((x) => {
        const best = bestResolution(x.locs);
        return {
          description: strip(x.ident.description) || strip(best.res.description),
          lon: best.lon,
          lat: best.lat,
          score: (x.ident.score || {}).time_total ?? 0,
        };
      });
      // siblings: other located resolutions of the chosen identification (score = best_path_score)
      const siblings = selected.locs.filter((s) => s !== chosenRes).map((s) => ({
        description: strip(s.res.description) || chosenDesc,
        lon: s.lon,
        lat: s.lat,
        score: s.score,
      }));
      const siblingRatioMax = chosenRes.score > 0 && siblings.length ? Math.max(...siblings.map((s) => s.score)) / chosenRes.score : 0;
      tier = computeTier({ score: datasetScore, votes, rivalScores: rivals.map((x) => x.score), siblingRatioMax });
      const nCompeting =
        rivals.filter((x) => datasetScore > 0 && x.score / datasetScore >= TIER_RULES.disputedRivalRatio).length +
        siblings.filter((x) => chosenRes.score > 0 && x.score / chosenRes.score >= TIER_RULES.disputedRivalRatio).length;
      candidates = [...rivals, ...siblings]
        .filter((x) => x.score >= TIER_RULES.candidateMinScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, TIER_RULES.maxCandidates);
      note = autoNote({ tier, kind, chosenDesc, score: datasetScore, votes, nCompeting });
    }

    // ---- curation overrides (the only place a person changes a tier / note) ----
    let tierBasis = 'computed';
    let computedTier = null;
    if (c) {
      if (c.tier) { tierBasis = 'curated'; computedTier = tier; tier = c.tier; }
      if (c.note !== undefined) note = c.note || '';
      if (tier === 'unlocated') {
        kind = 'unlocated'; lon = null; lat = null; coordinateBasis = null; modernName = null; candidates = [];
      } else if (kind === 'unlocated') {
        problems.push(`${r.friendly_id}: curation tier "${tier}" but the dataset has no coordinates for it`);
      }
    }

    const base = r.friendly_id.replace(/ \d+$/, '');
    const name = (c && c.name) || (baseCount.get(base) === 1 ? base : r.friendly_id);
    const id = (c && c.id) || r.url_slug;
    if (seenIds.has(id)) problems.push(`duplicate place id "${id}" (${seenIds.get(id)} and ${r.friendly_id})`);
    seenIds.set(id, r.friendly_id);

    const extra = [];
    for (const e of (c && c.extraPassages) || []) {
      if (verses.some((v) => v.osis === e.osis)) problems.push(`${r.friendly_id}: extraPassage ${e.osis} is already in the dataset list`);
      extra.push({ osis: e.osis, note: e.note || null });
    }

    places.push({
      id,
      name,
      ancientId: r.id,
      kind,
      tier,
      tierBasis,
      computedTier,
      lon,
      lat,
      coordinateBasis,
      modernName,
      note: note || null,
      sourceId: SOURCE_ID,
      datasetScore,
      voteCount: votes,
      identificationsInDataset: idents.length,
      candidates: tier === 'unlocated' ? [] : candidates,
      passages: verses.map((v) => v.osis),
      extraPassages: extra,
      _sort: verses[0].sort,
    });
  }

  places.sort((a, b) => (a._sort < b._sort ? -1 : a._sort > b._sort ? 1 : a.id < b.id ? -1 : 1));
  const rows = places.map(({ _sort, ...row }) => row);
  const tierCounts = {};
  for (const p of rows) tierCounts[p.tier] = (tierCounts[p.tier] || 0) + 1;
  const dataset = {
    name: 'OpenBible.info Bible Geocoding Data',
    repo: 'https://github.com/openbibleinfo/Bible-Geocoding-Data',
    page: 'https://www.openbible.info/geo/',
    licence: 'CC BY 4.0',
    attribution: ATTRIBUTION,
    sourceId: SOURCE_ID,
    commit,
    generatedBy: 'tools/build-places.mjs',
    note:
      'Coordinates are copied from the dataset. `tier` is computed from the dataset scores by the rules in tierRules (a lone-source entry scores 1000 by default, so the score alone is never treated as proof) and may be overridden only through curation.json (rows with tierBasis "curated"). Scripture references only; no interpretation. Some dataset entries derive from OpenStreetMap (ODbL 1.0); no OSM geometry is used here.',
    tierRules: TIER_RULES,
    counts: { datasetEntries: ancientRows.length, places: rows.length, byTier: tierCounts, curated: rows.filter((p) => p.tierBasis === 'curated').length },
    excluded: {
      noVerses: { count: excluded.noVerses.length, ids: excluded.noVerses },
      notAPlace: { count: excluded.notAPlace.length, ids: excluded.notAPlace },
      curated: { count: excluded.curated.length, ids: excluded.curated },
    },
  };
  return { rows, dataset, problems };
}

function readCommit(dir) {
  if (process.env.OB_COMMIT) return process.env.OB_COMMIT;
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function main() {
  const dir = process.argv[2];
  if (!dir) throw new Error('usage: node tools/build-places.mjs <Bible-Geocoding-Data dir>');
  const commit = readCommit(dir);
  if (commit !== PINNED_COMMIT) {
    console.error(`dataset commit is ${commit}, expected the pinned ${PINNED_COMMIT}; refusing (checkout the pinned commit, or change PINNED_COMMIT deliberately and review the diff)`);
    process.exit(1);
  }
  const ancientRows = fs.readFileSync(path.join(dir, 'data', 'ancient.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const curation = JSON.parse(fs.readFileSync(path.join(outDir, 'curation.json'), 'utf8'));
  const { rows, dataset, problems } = buildPlaces({ ancientRows, curation, commit });
  if (problems.length) {
    for (const p of problems) console.error('PROBLEM:', p);
    console.error(`${problems.length} problem(s); nothing written`);
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'places.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(path.join(outDir, 'DATASET.json'), JSON.stringify(dataset, null, 2) + '\n');
  console.log(`wrote content/places/places.jsonl: ${rows.length} places from ${ancientRows.length} dataset entries`);
  console.log('by tier:', JSON.stringify(dataset.counts.byTier), '| curated overrides:', dataset.counts.curated);
  console.log('excluded: noVerses', dataset.excluded.noVerses.count, '| notAPlace', dataset.excluded.notAPlace.count, '| curated', dataset.excluded.curated.count);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main();
