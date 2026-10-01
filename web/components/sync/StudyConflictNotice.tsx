"use client";

import { useEffect, useState } from "react";
import type { StudyConflictV2 } from "@/lib/sync/store";

const systemFields = new Set(["id", "workspaceId", "revision", "createdAt", "updatedAt"]);
const proseFields = new Set(["body", "note", "rationale", "title", "bigIdea", "audience", "gospelConnection", "label",
  "originalAudienceMeaning", "enduringPrinciple", "canonicalBridge", "situation", "faithfulResponse", "cautions"]);
const label = (key: string) => key.replace(/([A-Z])/g, " $1").replace(/^./, char => char.toUpperCase());
const display = (value: unknown) => typeof value === "string" ? value : JSON.stringify(value ?? null, null, 2);

export function ConflictReview({ conflict, onSaved }: { conflict: StudyConflictV2; onSaved: () => void }) {
  const [fields, setFields] = useState(conflict.local);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const keys = [...new Set([...Object.keys(conflict.local), ...Object.keys(conflict.remote)])].filter(key => !systemFields.has(key));
  async function save() {
    setSaving(true); setError("");
    try { const { resolveStudyConflictV2 } = await import("@/lib/sync/store"); await resolveStudyConflictV2(conflict, fields); onSaved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save. Both versions are still safe on this device."); }
    finally { setSaving(false); }
  }
  return <section aria-label="Compare study versions">
    <p>Compare your version with the version saved by another device. Edit the combined text or choose a value for each difference. Both originals will be kept on this device.</p>
    {keys.map(key => {
      const local = conflict.local[key]; const remote = conflict.remote[key];
      const differs = JSON.stringify(local) !== JSON.stringify(remote);
      if (!differs && !proseFields.has(key)) return null;
      return <fieldset key={key} disabled={saving}>
        <legend>{label(key)}</legend>
        <p>Your device</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{display(local)}</pre>
        <p>Saved by another device</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{display(remote)}</pre>
        {proseFields.has(key) && typeof local === "string" ? <label>
          Reconciled {label(key).toLowerCase()}
          <textarea value={String(fields[key] ?? "")} onChange={event => setFields({ ...fields, [key]: event.target.value })} />
        </label> : <label>Use value from <select value={JSON.stringify(fields[key]) === JSON.stringify(remote) ? "remote" : "local"}
          onChange={event => setFields({ ...fields, [key]: event.target.value === "remote" ? remote : local })}>
          <option value="local">Your device</option><option value="remote">Another device</option>
        </select></label>}
      </fieldset>;
    })}
    {error && <p role="alert">{error}</p>}
    <button disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save reconciled version"}</button>
    <p>Saved locally first; sync will retry when online. If another device edits again, you will be asked to compare again.</p>
  </section>;
}

export function StudyConflictNotice() {
  const [conflicts, setConflicts] = useState<StudyConflictV2[]>([]);
  const [review, setReview] = useState<StudyConflictV2 | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try { const { listStudyConflictsV2 } = await import("@/lib/sync/store"); const next = await listStudyConflictsV2(); if (!cancelled) setConflicts(next); }
      catch { /* a status read never blocks offline editing */ }
    }
    void poll(); const timer = setInterval(() => void poll(), 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  if (!conflicts.length && !review) return null;
  return <aside aria-label="Study edit conflicts">
    <p role="status">Another device edited the same study notes. Your writing is safe here. Compare both versions to finish syncing.</p>
    {conflicts.map((conflict, index) => <button key={conflict.key} onClick={() => setReview(conflict)} disabled={review !== null}>
      Compare {label(conflict.entity)} {index + 1}
    </button>)}
    {review && <><ConflictReview key={JSON.stringify(review)} conflict={review} onSaved={() => {
      setConflicts(current => current.filter(item => item.key !== review.key)); setReview(null);
    }} /><button onClick={() => setReview(null)}>Review later</button></>}
  </aside>;
}
