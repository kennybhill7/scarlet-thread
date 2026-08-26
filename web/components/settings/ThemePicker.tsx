"use client";

import { useEffect, useSyncExternalStore } from "react";
import {
  PREFERS_DARK_MEDIA_QUERY,
  THEME_PREFERENCES,
  applyThemePreference,
  commitThemePreference,
  readThemePreferenceServerSnapshot,
  readThemePreferenceSnapshot,
  subscribeThemePreferenceChange,
  type ThemePreference,
} from "@/lib/theme";

const LABEL: Record<ThemePreference, string> = {
  system: "System",
  midnight: "Midnight",
  parchment: "Parchment",
};

const DESCRIPTION: Record<ThemePreference, string> = {
  system: "Follows your device's light/dark setting — switches live if it changes while the app is open.",
  midnight: "A dark reading surface, for a dark room.",
  parchment: "The default — a warm, light reading surface.",
};

/**
 * Controls the PAGE reading theme only (data-reading on <html>) — never the
 * always-dark app shell ("The Climb"; see globals.css's top-of-file
 * comment). app/layout.tsx applies the resolved value before first paint
 * via a blocking inline script built from lib/theme.ts#getThemeBootstrapScript;
 * this is the live control that persists a change and re-applies it without
 * a reload, going through the same lib/theme.ts#resolveReading logic so the
 * two can never disagree about what a stored preference means.
 *
 * No companion CSS module: ThemePicker.tsx is the only owned file for this
 * component (THEMESYSTEM-001's ownedPaths does not include a stylesheet).
 * Styled inline against the shell tokens instead — the same choice
 * DeviceSessionControls.tsx documents for the parts of its own markup that
 * fall outside its owned stylesheet. The wrapping <section>/card chrome
 * lives in app/(app)/settings/page.tsx, reusing the existing
 * settings.module.css classes OfflineDownloads' wrapper already uses.
 */
export function ThemePicker() {
  // Renders "system" on the server pass and the FIRST client pass alike (no
  // `window` on the server), so hydration matches exactly, then corrects to
  // the real stored value via useSyncExternalStore — same technique
  // DeviceSessionControls.tsx's `residue` uses for the same class of
  // problem (localStorage state that must not mismatch hydration). This
  // also picks up changes written in OTHER tabs (the native `storage`
  // event) and, via commitThemePreference's synchronous notify, THIS tab's
  // own writes below.
  const preference = useSyncExternalStore(
    subscribeThemePreferenceChange,
    readThemePreferenceSnapshot,
    readThemePreferenceServerSnapshot,
  );

  // Applies data-reading on every preference change (including the
  // hydration-time correction above), and — only while "system" is
  // selected — on every live OS prefers-color-scheme change. A learner on
  // System should watch the app follow their OS switching light/dark, not
  // just see it at the next load.
  useEffect(() => {
    applyThemePreference(preference);
    if (preference !== "system") return;
    const media = window.matchMedia(PREFERS_DARK_MEDIA_QUERY);
    const onChange = () => applyThemePreference("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  function choose(next: ThemePreference) {
    commitThemePreference(window.localStorage, next);
  }

  return (
    <div role="radiogroup" aria-label="Reading theme" style={{ display: "grid", gap: "0.6rem" }}>
      {THEME_PREFERENCES.map((option) => {
        const selected = option === preference;
        return (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => choose(option)}
            style={{
              display: "grid",
              gap: "0.2rem",
              textAlign: "left",
              padding: "0.7rem 0.9rem",
              borderRadius: "var(--r-md)",
              border: `1px solid ${selected ? "var(--gold)" : "var(--shell-border)"}`,
              background: selected ? "var(--gold-dim-bg)" : "transparent",
              color: "var(--shell-text)",
            }}
          >
            <span style={{ fontFamily: "var(--font-label)", fontWeight: 600 }}>
              {LABEL[option]}
            </span>
            <span style={{ fontSize: "0.8rem", color: "var(--shell-muted-2)" }}>
              {DESCRIPTION[option]}
            </span>
          </button>
        );
      })}
    </div>
  );
}
