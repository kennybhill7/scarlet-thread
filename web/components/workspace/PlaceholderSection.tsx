import type { SectionRenderState } from "@/lib/workspace/renderState";

import { placeholderStyle } from "./styles";

/**
 * CLAIMPANES-001 — extracted verbatim from `WorkspaceShell.tsx`
 * (WORKSPACESHELL-001), no behavior change. Now covers only Connect, Apply,
 * and Teach (Context/Theology/Conviction graduate to their own real section
 * files in this task — see `ContextSection.tsx` / `TheologySection.tsx` /
 * `ConvictionSection.tsx`). Architecturally different work (a UserConnection
 * form, an Application bridge-fields form, a TeachingDraft builder) that this
 * task's own scope note says must not be improvised here.
 */
export function PlaceholderSection({ section }: { section: SectionRenderState }) {
  return (
    <p style={placeholderStyle} data-testid={`placeholder-${section.step}`}>
      Not built yet. {section.productName} is planned as its own follow-up task, once this
      workspace shell&rsquo;s contract is proven stable. Nothing on this screen represents{" "}
      {section.label.toLowerCase()} work you have not actually done.
    </p>
  );
}
