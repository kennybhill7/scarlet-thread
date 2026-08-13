"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";

import {
  DeviceClearFailure,
  DeviceOfflineError,
  UnsyncedWritesError,
  isOnline,
  isSyncRejectedError,
  runDeviceClear,
} from "@/lib/sync/clear";

import styles from "./device-session-controls.module.css";

/**
 * `not-cleared` is not an error state. It is the one outcome where the server
 * session is already gone while study data may still sit on a shared device,
 * so it replaces the action row with a standing warning instead of a status
 * line the user can dismiss by looking away.
 */
type State = "idle" | "clearing" | "error" | "not-cleared";

function messageForPreSignOut(cause: unknown): string {
  if (cause instanceof DeviceOfflineError) {
    return "Nothing was cleared. You went offline before your writing could sync.";
  }
  if (cause instanceof UnsyncedWritesError) {
    return `Nothing was cleared. ${cause.pending} change(s) are still waiting to sync — try again in a moment.`;
  }
  if (isSyncRejectedError(cause)) {
    return "Nothing was cleared. The server rejected some of your writing, so it only exists on this device.";
  }
  return "Nothing was cleared because sync and sign-out could not be confirmed. Please try again.";
}

export function DeviceSessionControls() {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");
  const busy = state === "clearing";

  async function clearAndSignOut() {
    if (!isOnline()) {
      setState("error");
      setMessage(
        "Connect to the internet before clearing this device — your queued writing has to sync first. Nothing was cleared.",
      );
      return;
    }
    if (
      !window.confirm(
        "Sync your writing, remove this app's notes and offline Bible data from this device, then sign out?",
      )
    ) {
      return;
    }

    setState("clearing");
    setMessage("Syncing before this device is cleared…");
    try {
      const { redirectTo } = await runDeviceClear({
        signOut: () => signOut({ redirect: false, redirectTo: "/sign-in" }),
      });
      // Success is a navigation, never a "done" toast: the page the user is
      // standing on belongs to a session that no longer exists.
      window.location.assign(redirectTo);
    } catch (error) {
      const failure =
        error instanceof DeviceClearFailure
          ? error
          : new DeviceClearFailure(false, error);
      if (failure.signedOut) {
        setState("not-cleared");
        setMessage("");
      } else {
        setState("error");
        setMessage(messageForPreSignOut(failure.cause));
      }
    }
  }

  return (
    <section className={styles.section} aria-labelledby="device-session-title">
      <p className={styles.eyebrow}>PRIVACY</p>
      <h2 id="device-session-title">This device</h2>
      {/* Ordinary sign-out returns once account/workspace namespacing lands for
          local storage; until then the on-device vault is unscoped, so a
          retain-data sign-out would be a shared-device leak (A-015 remains
          open separately). */}
      <p className={styles.copy}>
        Signing out on its own would leave every note and downloaded chapter in
        this browser, so it is not offered yet. Clearing is the only way to end
        a session here.
      </p>
      {state === "not-cleared" ? (
        <div role="alert" style={{ display: "grid", gap: "0.5rem" }}>
          {/* Inline grid and unclassed paragraphs on purpose:
              device-session-controls.module.css is not an owned file in this
              task, `.section p` zeroes every margin, and the muted .copy voice
              is wrong for the one message that matters. */}
          <p>
            <strong>Signed out — this device was NOT cleared.</strong>
          </p>
          <p className={styles.copy}>
            Your notes and offline Bible data are still stored in this browser.
            If anyone else uses this device, clear this site&apos;s data in your
            browser settings now.
          </p>
          {/* No auto-navigation: the session is already dead server-side, and a
              redirect would replace this warning before it can be read. */}
          <p>
            <a href="/sign-in">
              <strong>Continue to sign-in</strong>
            </a>
          </p>
        </div>
      ) : (
        <>
          <div className={styles.actions}>
            <button
              className={styles.danger}
              disabled={busy}
              onClick={() => void clearAndSignOut()}
              type="button"
            >
              {busy ? "Clearing…" : "Clear device and sign out"}
            </button>
          </div>
          <p
            className={styles.status}
            role={state === "error" ? "alert" : "status"}
          >
            {message}
          </p>
        </>
      )}
    </section>
  );
}
