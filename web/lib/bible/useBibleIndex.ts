"use client";

import { useEffect, useState } from "react";
import type { BibleIndex } from "@/lib/contracts";
import { loadIndex } from "@/lib/bible/loader";

interface IndexState {
  index: BibleIndex | null;
  error: Error | null;
  loading: boolean;
}

/**
 * The book/version manifest, loaded once and cached forever (see loader.ts —
 * it's immutable). Every screen that needs to know "what books exist" or
 * "what versions are bundled" goes through this rather than re-fetching.
 */
export function useBibleIndex(): IndexState {
  const [state, setState] = useState<IndexState>({ index: null, error: null, loading: true });

  useEffect(() => {
    let cancelled = false;
    loadIndex()
      .then((index) => {
        if (!cancelled) setState({ index, error: null, loading: false });
      })
      .catch((error: Error) => {
        if (!cancelled) setState({ index: null, error, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return state;
}
