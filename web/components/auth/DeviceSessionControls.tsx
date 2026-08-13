"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { signOut } from "next-auth/react";

import {
  CLEAR_DEVICE_CONFIRM,
  CLEAR_DEVICE_STEPS,
  DeviceClearFailure,
  clearLocalStudyData,
  describeClearFailure,
  isOnline,
  runDeviceClear,
} from "@/lib/sync/clear";

import styles from "./device-session-controls.module.css";

/*
 * lib/sync/store.ts opens IndexedDB at module scope (store.ts:58), so
 * server-rendering SyncRegistration throws "ReferenceError: indexedDB is not
 * defined" and takes the whole route with it — verified: a static import in
 * the layout fails `next build` while prerendering /read. `ssr: false` keeps
 * that module out of the server graph entirely, and it is only legal inside a
 * Client Component.
 *
 * WHY IT LIVES IN THIS FILE: app/(app)/layout.tsx has to stay a Server
 * Component to hold the auth boundary, so the `ssr: false` mount needs some
 * client module to live in, and this rework may not create new files. This is
 * the only "use client" module in the owned set, so the mount lodges here next
 * to an unrelated component. That is a constraint, not a design: when a new
 * file is allowed, move ProtectedClientMounts to its own module — it drags
 * this component's next-auth and lib/sync/clear imports into the client bundle
 * of every protected route for no reason. Better still, make store.ts open its
 * database lazily and delete both this indirection and the `ssr: false`.
 */
const SyncRegistration = dynamic(
  () =>
    import("@/components/sync/SyncRegistration").then(
      (module) => module.SyncRegistration,
    ),
  { ssr: false },
);

/** Client-only mounts for the protected tree. Renders no DOM of its own. */
export function ProtectedClientMounts() {
  return <SyncRegistration />;
}

/**
 * `not-cleared` is not an error state. It is the one outcome where the server
 * session is already gone while study data may still sit on a shared device,
 * so it replaces the action row with a standing warning instead of a status
 * line the user can dismiss by looking away. `rechecking`/`verified-clear`
 * are its exits: the user is signed out and cannot re-run the whole flow, but
 * they can always re-attempt and re-verify the local destruction, so this
 * branch is never a dead end.
 */
type State =
  | "idle"
  | "clearing"
  | "error"
  | "not-cleared"
  | "rechecking"
  | "verified-clear";

export function DeviceSessionControls() {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");
  const busy = state === "clearing" || state === "rechecking";
  const signedOut =
    state === "not-cleared" ||
    state === "rechecking" ||
    state === "verified-clear";

  async function clearAndSignOut() {
    if (!isOnline()) {
      setState("error");
      setMessage(
        "Connect to the internet before clearing this device — your queued writing has to sync first. Nothing was cleared.",
      );
      return;
    }
    // The confirm text is generated from CLEAR_DEVICE_STEPS, which is the same
    // order runDeviceClear performs, so this dialog cannot promise a sequence
    // the code does not run.
    if (!window.confirm(CLEAR_DEVICE_CONFIRM)) {
      return;
    }

    setState("clearing");
    // One message for the whole run rather than a step counter: runDeviceClear
    // reports no progress, so a "step 2 of 4" here would be a guess.
    setMessage(
      "Syncing your writing, then signing out and clearing this device…",
    );
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
      const view = describeClearFailure(failure);
      setState(view.state);
      setMessage(view.message);
    }
  }

  /**
   * The exit from the signed-out branch. clearLocalStudyData() destroys and
   * then re-reads every surface, so this reports what the device actually
   * holds now rather than assuming the earlier attempt finished or failed.
   */
  async function checkAgain() {
    setState("rechecking");
    setMessage("Checking this device again…");
    try {
      await clearLocalStudyData();
      setState("verified-clear");
      setMessage("");
    } catch (error) {
      const view = describeClearFailure(new DeviceClearFailure(true, error));
      setState("not-cleared");
      setMessage(view.message);
    }
  }

  return (
    <section className={styles.section} aria-labelledby="device-session-title">
      <p className={styles.eyebrow}>PRIVACY</p>
      <h2 id="device-session-title">This device</h2>
      {/* Ordinary sign-out returns once account/workspace namespacing lands for
          local storage; until then the on-device vault is unscoped, so a
          retain-data sign-out would be a shared-device leak (A-014 remains
          open separately). */}
      <p className={styles.copy}>
        Signing out on its own would leave every note and downloaded chapter in
        this browser, so it is not offered yet. Clearing is the only way to end
        a session here.
      </p>
      {signedOut ? (
        <div role="alert" style={{ display: "grid", gap: "0.5rem" }}>
          {/* Inline grid and unclassed paragraphs on purpose:
              device-session-controls.module.css is not an owned file in this
              task, `.section p` zeroes every margin, and the muted .copy voice
              is wrong for the one message that matters. */}
          {state === "verified-clear" ? (
            <p>
              <strong>Signed out, and this device is clear.</strong> Checked
              just now: no notes and no offline Bible data are left in this
              browser.
            </p>
          ) : (
            <>
              <p>
                <strong>Signed out — this device was NOT cleared.</strong>
              </p>
              <p className={styles.copy}>{message}</p>
              <div className={styles.actions}>
                <button
                  className={styles.danger}
                  disabled={busy}
                  onClick={() => void checkAgain()}
                  type="button"
                >
                  {state === "rechecking"
                    ? "Checking…"
                    : "Try again and check this device"}
                </button>
              </div>
            </>
          )}
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
          {/* The same four steps the confirm dialog lists, in the order
              runDeviceClear performs them, shown before the user commits. */}
          {/* Inline spacing for the same reason as the alert above: the
              stylesheet is not an owned file here and zeroes margins only for
              p/h2, so an unstyled ol would inherit browser defaults. */}
          <ol
            className={styles.copy}
            style={{ margin: 0, paddingInlineStart: "1.25rem" }}
          >
            {CLEAR_DEVICE_STEPS.map((step) => (
              <li key={step}>{step}.</li>
            ))}
          </ol>
          <div className={styles.actions}>
            <button
              className={styles.danger}
              disabled={busy}
              onClick={() => void clearAndSignOut()}
              type="button"
            >
              {busy ? "Clearing…" : "Sync, sign out, and clear this device"}
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
