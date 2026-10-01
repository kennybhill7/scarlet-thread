import { notFound } from "next/navigation";

import { isDevEnvironment } from "@/next.config";
import { IsraelSubArcPrototype } from "@/components/prototype/IsraelSubArcPrototype";

/**
 * ISRAELPROTO-001 → ISRAELFILTER-001 → NAV-001 — a standalone, type-the-URL
 * QA surface for the Israel sub-arc view. No link anywhere in the real nav
 * (Journey, `TabBar`) points at it — the real, discoverable entry point is
 * `Mountain.tsx`'s stage-5 waypoint, which opens the SAME
 * `IsraelSubArcPrototype` component (see that component's own header) inside
 * its own `Sheet` instead of jumping straight to the chapter reader.
 *
 * NAV-001 — plan §A.2's "Removed from production nav" line names
 * `/prototype/*` explicitly, "(behind an env flag)". No link ever pointed
 * here (confirmed above, and by `design/PRODUCT_EXPERIENCE_PLAN_2026-09-25.md`
 * §1.x's own finding: "ships in the production build but is unreachable by
 * navigation") — so the gap this task closes is that the ROUTE ITSELF still
 * rendered for anyone who typed the URL directly in a production build. It
 * now 404s unless `isDevEnvironment()` (`@/next.config`, the SAME fail-closed
 * `NODE_ENV === "development"` flag this repo already gates its dev-only CSP
 * relaxations with — `next.config.ts`'s own header: "Fail closed: anything
 * other than 'development' ... gets the strict policy") says this is a local
 * dev server. In any deployed build this route is gone, not merely
 * unlinked — a stronger reading of "removed from production nav" than
 * leaving it reachable by a guessed URL.
 *
 * KEPT DELIBERATELY past what ISRAELPROTO-001 needed it for: that task's job
 * (letting Ken click through the ridge/sheet FEEL before any real data
 * existed) is done — `lib/prototype/israel-sub-arc.ts` now reads real
 * STORY_SPINE data (ISRAELFILTER-001) — but this route still has value as a
 * direct, low-friction LOCAL QA surface: it opens straight to the sub-arc
 * without first scrolling/finding the stage-5 waypoint on the full Mountain
 * scene. Since it renders the exact same component the Mountain embeds,
 * there is no second, drifting copy of this UI to maintain — only a second
 * way to reach it, now dev-only.
 *
 * This route still renders inside `app/(app)/layout.tsx`'s auth boundary
 * (a signed-out visitor is redirected to /sign-in before reaching here, same
 * as every other screen in this group) — this task does not add a second,
 * unauthenticated way to view app content.
 */
export default function IsraelSubArcPrototypePage() {
  if (!isDevEnvironment()) notFound();
  return <IsraelSubArcPrototype />;
}
