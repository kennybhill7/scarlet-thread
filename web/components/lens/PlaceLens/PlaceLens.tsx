"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Topology } from "topojson-specification";

import type { CanonicalRangeV1 } from "@/lib/contracts/range-v1";

import { loadLandTopology, loadPlaceLensDataset } from "./dataLoader";
import { BIBLICAL_WORLD_CENTER, easeInOutCubic, lerp, lerpRotation, type ProjectionConfig, type Rotation } from "./geometry";
import { PlaceDetails } from "./PlaceDetails";
import { PlaceList } from "./PlaceList";
import { PlaceLensSvg } from "./PlaceLensSvg";
import { useGlobeRotation } from "./useGlobeRotation";
import type { LensPlace, PlaceLensDataset } from "./types";
import styles from "./PlaceLens.module.css";

/**
 * PLACELENS-001 — the stateful orchestrator (the only component in this
 * directory with hooks): fetches `public/map/{places,land-110m}.json`
 * (`dataLoader.ts`), owns rotation (`useGlobeRotation`), zoom level,
 * selection and the globe/list view toggle, and renders the hookless
 * `PlaceLensSvg` / `PlaceList` / `PlaceDetails` with the result. This is the
 * file `components/lens/PlaceLens/index.ts` lazy-loads via `next/dynamic`
 * (plan §C.4's bundle budget).
 *
 * Attribution (CC BY 4.0 requires it be VISIBLE in the lens, plan §C.8) is
 * rendered from the fetched dataset's own `attribution` string — never
 * hardcoded twice, so a dataset regenerated with a different string could
 * never leave a stale credit on screen.
 */
const STAGE_WIDTH = 360;
const STAGE_HEIGHT = 360;
const WORLD_SCALE = 150;
const REGION_SCALE = 620;
const ZOOM_TRANSITION_MS = 500;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; dataset: PlaceLensDataset; land: Topology | null };

type ZoomLevel = "world" | "region";
type ViewMode = "globe" | "list";

export interface PlaceLensProps {
  /** Called when a learner chooses "Open in Connect" for a passage. See `passageList.ts`'s header for the contract. */
  onOpenInConnect?: (range: CanonicalRangeV1, connectQueryParam: string) => void;
  /** Seeds the initially-selected place (e.g. opened from a specific passage's "View on the Place lens" link). */
  initialSelectedId?: string;
}

export function PlaceLens({ onOpenInConnect, initialSelectedId }: PlaceLensProps) {
  const idPrefix = `place-lens-${useId()}`;
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId ?? null);
  const [view, setView] = useState<ViewMode>("globe");
  const [zoom, setZoom] = useState<ZoomLevel>("world");
  const [animatedScale, setAnimatedScale] = useState(WORLD_SCALE);
  const { rotation, setRotation, bind } = useGlobeRotation({ lambda: 20, phi: -10 });
  const zoomFrameRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([loadPlaceLensDataset(), loadLandTopology().catch(() => null)])
      .then(([dataset, land]) => {
        if (cancelled) return;
        setState({ status: "ready", dataset, land: (land as Topology | null) ?? null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error && error.message ? error.message : "Could not load the place data.";
        setState({ status: "error", message });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const places: LensPlace[] = useMemo(() => (state.status === "ready" ? state.dataset.places : []), [state]);
  const selectedPlace = useMemo(() => places.find((place) => place.id === selectedId) ?? null, [places, selectedId]);

  function reducedMotionActive(): boolean {
    return (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  function animateZoom(next: ZoomLevel) {
    if (zoomFrameRef.current) window.cancelAnimationFrame(zoomFrameRef.current);
    const fromRotation = rotation;
    const fromScale = animatedScale;
    const toRotation: Rotation = next === "region" ? BIBLICAL_WORLD_CENTER : fromRotation;
    const toScale = next === "region" ? REGION_SCALE : WORLD_SCALE;
    setZoom(next);

    if (reducedMotionActive() || typeof window === "undefined") {
      setRotation(toRotation);
      setAnimatedScale(toScale);
      return;
    }

    const start = performance.now();
    const step = (now: number) => {
      const t = easeInOutCubic(Math.min(1, (now - start) / ZOOM_TRANSITION_MS));
      setRotation(lerpRotation(fromRotation, toRotation, t));
      setAnimatedScale(lerp(fromScale, toScale, t));
      if (t < 1) {
        zoomFrameRef.current = window.requestAnimationFrame(step);
      }
    };
    zoomFrameRef.current = window.requestAnimationFrame(step);
  }

  useEffect(() => () => {
    if (zoomFrameRef.current) window.cancelAnimationFrame(zoomFrameRef.current);
  }, []);

  const config: ProjectionConfig = {
    rotation,
    scale: animatedScale,
    translate: [STAGE_WIDTH / 2, STAGE_HEIGHT / 2],
  };

  function selectPlace(id: string) {
    setSelectedId(id);
  }

  if (state.status === "loading") {
    return (
      <div className={styles.wrap} role="status" aria-live="polite">
        Loading the place lens…
      </div>
    );
  }
  if (state.status === "error") {
    return (
      <div className={styles.wrap} role="alert">
        {state.message}
      </div>
    );
  }

  return (
    <div className={styles.wrap} data-testid="place-lens">
      <div className={styles.toolbar}>
        <div className={styles.viewToggle} role="group" aria-label="View">
          <button
            type="button"
            className={styles.viewToggleButton}
            aria-pressed={view === "globe"}
            onClick={() => setView("globe")}
          >
            Globe
          </button>
          <button
            type="button"
            className={styles.viewToggleButton}
            aria-pressed={view === "list"}
            onClick={() => setView("list")}
          >
            List
          </button>
        </div>
        {view === "globe" ? (
          <div className={styles.zoomControls}>
            <button
              type="button"
              className={styles.zoomButton}
              onClick={() => animateZoom(zoom === "world" ? "region" : "world")}
              aria-pressed={zoom === "region"}
            >
              {zoom === "world" ? "Zoom to the biblical world" : "Zoom out to the world"}
            </button>
          </div>
        ) : null}
      </div>

      {view === "globe" ? (
        <>
          <div
            onPointerDown={bind.onPointerDown}
            onPointerMove={bind.onPointerMove}
            onPointerUp={bind.onPointerUp}
            onPointerCancel={bind.onPointerCancel}
            onKeyDown={bind.onKeyDown}
            tabIndex={0}
            role="group"
            aria-label="Place lens globe. Arrow keys rotate; use the List view above for a non-visual way to browse every place."
          >
            <PlaceLensSvg
              idPrefix={idPrefix}
              width={STAGE_WIDTH}
              height={STAGE_HEIGHT}
              config={config}
              land={state.land}
              places={places}
              selectedPlace={selectedPlace}
              onSelectMarker={selectPlace}
            />
          </div>
          <p className={styles.hint}>
            Drag or use arrow keys to turn the globe; click a marker to select a place. Dashed markers are
            uncertain or disputed identifications — see the note below once selected.
          </p>
        </>
      ) : (
        <PlaceList idPrefix={idPrefix} places={places} selectedId={selectedId} onSelectPlace={selectPlace} />
      )}

      {selectedPlace ? (
        <PlaceDetails idPrefix={idPrefix} place={selectedPlace} onOpenInConnect={onOpenInConnect} />
      ) : (
        <p className={styles.hint}>Select a place to see its Scripture references.</p>
      )}

      <p className={styles.attribution}>
        {state.dataset.attribution} ({state.dataset.sourceUrl}). Coastlines: Natural Earth (public domain), via{" "}
        <code>world-atlas</code> (Mike Bostock, ISC licence).
      </p>
    </div>
  );
}
