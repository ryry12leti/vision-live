// VISION Live Proof Core V1 — browser-facing adapter aggregator.
// The pure plan/compiler/session-controller core lives in
// supabase/functions/_shared/live-proof-core/ (headless, no DOM dependency).
// This file only aggregates the two adapters that wrap real browser proof
// runtimes. Nothing in this directory is wired into any HTML page in V1 —
// no production frontend change is made by this task.
'use strict';

export { createCameraObserverAdapter } from './adapters/camera-observer-adapter.mjs';
export { createFocusObserverAdapter } from './adapters/focus-observer-adapter.mjs';
