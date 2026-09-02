import { IsraelSubArcPrototype } from "@/components/prototype/IsraelSubArcPrototype";

/**
 * ISRAELPROTO-001 — an isolated prototype for Ken to click through and judge
 * navigation FEEL only. Reachable solely by navigating directly to this URL:
 * no link anywhere in the real nav (Home/Climb, `TabBar`) points at it, and
 * nothing here reads or writes real study data. See
 * `lib/prototype/israel-sub-arc.ts`'s header for the full context and why
 * this must not touch `db/schema.ts`, `data/seed/stages.json`, any
 * migration, or the real `Mountain`.
 *
 * This route still renders inside `app/(app)/layout.tsx`'s auth boundary
 * (a signed-out visitor is redirected to /sign-in before reaching here,
 * same as every other screen in this group) — this task does not add a
 * second, unauthenticated way to view app content.
 */
export default function IsraelSubArcPrototypePage() {
  return <IsraelSubArcPrototype />;
}
