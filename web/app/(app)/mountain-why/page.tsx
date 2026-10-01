import { BackToJourney } from "@/components/climb/BackToJourney";
import { StageOrderToggle } from "@/components/climb/StageOrderToggle";
import { canonicalOrder, lensOrder, ordersDiffer } from "@/lib/climb/stageOrder";
import { loadLensDisclosure, loadLensStages } from "@/lib/content/lensStages";

import styles from "./mountain-why.module.css";

/**
 * MOUNTAINWHY-001 — "Why this shape?" (design/PRODUCT_EXPERIENCE_PLAN_2026-
 * 09-25.md §A.5's own key-screen row: "the 11-stage lens disclosed, author
 * named, other lenses offered"; §I decision 1: "Lens, disclosed with author
 * and sources, with a canonical-order toggle"; §H row 10, this task's own
 * acceptance criteria: "'Why this shape?' screen with author and sources;
 * stage titles re-phrased from the text; lint runs over stage titles; a
 * canonical-order toggle").
 *
 * *** DRAFT COPY — NOT KEN-APPROVED ***
 * Every word of disclosure prose this page renders comes from
 * content/lens/why-this-shape.json, whose own `status: "draft"` /
 * `statusNote` fields say so explicitly, rendered below as a visible banner.
 * Per the plan's own words: "Ken writes/approves the disclosure text." This
 * is a draft for Ken's review, the same way a lesson's `status: draft`
 * frontmatter marks it unpublished (content/README.md) — nothing on this
 * screen should be presented to a learner as final until Ken has reviewed
 * it. See this task's own final report for the exact copy and the honest
 * "no documented external source found" finding behind the Method section.
 *
 * No auth check of its own — `app/(app)/layout.tsx` already gates the whole
 * `(app)` route group (`PlacesPage`'s own documented precedent for a lens
 * page with no user-specific data).
 *
 * Reads content/lens/ directly rather than the `stages` DB table — see
 * lib/content/lensStages.ts's own header for why, and for the one real
 * tradeoff that choice carries (this screen reflects a content edit
 * immediately; `db:seed`-backed pages like the Mountain/Mirror need a reseed
 * first).
 */
function ContentUnavailable() {
  return (
    <div className={styles.wrap}>
      <BackToJourney />
      <div className={styles.main}>
        <p className={styles.eyebrow}>Why this shape?</p>
        <h1 className={styles.title}>Content unavailable</h1>
        <p data-testid="content-unavailable-notice">
          This screen could not read content/lens/eleven-stages.json or content/lens/why-this-shape.json. This is a
          deployment/configuration problem, not a missing stage — the lens data should always ship with the app.
        </p>
      </div>
    </div>
  );
}

export default function MountainWhyPage() {
  let stages;
  let disclosure;
  try {
    stages = loadLensStages();
    disclosure = loadLensDisclosure();
  } catch {
    return <ContentUnavailable />;
  }

  const lens = lensOrder(stages).map((stage) => ({ slug: stage.slug, title: stage.title }));
  const canonical = canonicalOrder(stages).map((stage) => ({ slug: stage.slug, title: stage.title }));
  const differ = ordersDiffer(stages);

  return (
    <div className={styles.wrap}>
      <BackToJourney />
      <main className={styles.main} data-testid="mountain-why-page">
        <p className={styles.eyebrow}>{disclosure.title}</p>

        {disclosure.status === "draft" ? (
          <p className={styles.draftBanner} data-testid="draft-banner">
            {disclosure.statusNote}
          </p>
        ) : null}

        <p className={styles.author} data-testid="lens-author">
          By {disclosure.author}
        </p>

        <section className={styles.section}>
          {disclosure.whatThisIs.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
          <p>{disclosure.author_statement}</p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.h2}>Method</h2>
          {disclosure.method.map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </section>

        {disclosure.cautions.length > 0 ? (
          <section className={styles.section}>
            <h2 className={styles.h2}>Worth knowing before you read the mountain this way</h2>
            <ul className={styles.list}>
              {disclosure.cautions.map((caution, index) => (
                <li key={index}>{caution}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {disclosure.otherLenses.length > 0 ? (
          <section className={styles.section}>
            <h2 className={styles.h2}>Other lenses</h2>
            <ul className={styles.list}>
              {disclosure.otherLenses.map((other) => (
                <li key={other.id}>
                  <strong>{other.label}</strong>
                  {other.available ? "" : " — not built yet"} — {other.description}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className={styles.section}>
          <h2 className={styles.h2}>See the eleven stages in each order</h2>
          <StageOrderToggle lensOrder={lens} canonicalOrder={canonical} ordersDiffer={differ} />
        </section>
      </main>
    </div>
  );
}
