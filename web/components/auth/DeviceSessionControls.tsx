"use client";

import { useState } from "react";
import { signOut } from "next-auth/react";

import { syncNow } from "@/lib/sync/client";
import { clearLocalStudyData } from "@/lib/sync/clear";

import styles from "./device-session-controls.module.css";

type State = "idle" | "signing-out" | "clearing" | "error";

export function DeviceSessionControls() {
  const [state, setState] = useState<State>("idle");
  const [message, setMessage] = useState("");
  const busy = state === "signing-out" || state === "clearing";

  async function leaveDeviceData() {
    setState("signing-out");
    setMessage("");
    try {
      await signOut({ redirectTo: "/sign-in" });
    } catch {
      setState("error");
      setMessage("Sign-out did not complete. Please try again.");
    }
  }

  async function clearAndSignOut() {
    if (!navigator.onLine) {
      setState("error");
      setMessage(
        "Connect to the internet before clearing this device so queued writing can sync first.",
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
    let signedOut = false;
    try {
      await syncNow();
      const result = await signOut({
        redirect: false,
        redirectTo: "/sign-in",
      });
      signedOut = true;
      await clearLocalStudyData();
      window.location.assign(result.url || "/sign-in");
    } catch {
      setState("error");
      setMessage(
        signedOut
          ? "You were signed out, but this device could not be cleared completely. Clear this site's data in browser settings before sharing the device."
          : "Nothing was cleared because sync and sign-out could not be confirmed. Please try again.",
      );
    }
  }

  return (
    <section className={styles.section} aria-labelledby="device-session-title">
      <p className={styles.eyebrow}>PRIVACY</p>
      <h2 id="device-session-title">This device</h2>
      <p className={styles.copy}>
        A normal sign-out keeps offline writing on this device. Clear this
        device when it is shared or no longer trusted.
      </p>
      <div className={styles.actions}>
        <button disabled={busy} onClick={() => void leaveDeviceData()} type="button">
          Sign out
        </button>
        <button
          className={styles.danger}
          disabled={busy}
          onClick={() => void clearAndSignOut()}
          type="button"
        >
          {state === "clearing" ? "Clearing…" : "Clear device and sign out"}
        </button>
      </div>
      <p className={styles.status} role={state === "error" ? "alert" : "status"}>
        {message}
      </p>
    </section>
  );
}
