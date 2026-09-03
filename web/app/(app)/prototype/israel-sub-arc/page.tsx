import { IsraelSubArcPrototype } from "@/components/prototype/IsraelSubArcPrototype";

/**
 * ISRAELPROTO-001 → ISRAELFILTER-001 — a standalone, type-the-URL surface
 * for the Israel sub-arc view. No link anywhere in the real nav (Home/Climb,
 * `TabBar`) points at it — the real, discoverable entry point is now
 * `Mountain.tsx`'s stage-5 waypoint, which opens the SAME
 * `IsraelSubArcPrototype` component (see that component's own header) inside
 * its own `Sheet` instead of jumping straight to the chapter reader.
 *
 * KEPT DELIBERATELY, past what ISRAELPROTO-001 needed it for: that task's
 * job (letting Ken click through the ridge/sheet FEEL before any real data
 * existed) is done — `lib/prototype/israel-sub-arc.ts` now reads real
 * STORY_SPINE data (ISRAELFILTER-001) — but this route still has value as a
 * direct, low-friction QA surface: it opens straight to the sub-arc without
 * first scrolling/finding the stage-5 waypoint on the full Mountain scene.
 * Since it now renders the exact same component the Mountain embeds, there
 * is no second, drifting copy of this UI to maintain — only a second way
 * to reach it.
 *
 * This route still renders inside `app/(app)/layout.tsx`'s auth boundary
 * (a signed-out visitor is redirected to /sign-in before reaching here,
 * same as every other screen in this group) — this task does not add a
 * second, unauthenticated way to view app content.
 */
export default function IsraelSubArcPrototypePage() {
  return <IsraelSubArcPrototype />;
}
