export * from './contract.js';
export * from './signals.js';
export * from './website-inspection.js';
export * from './location.js';
export * from './deduplication.js';
export * from './providers.js';
export * from './research.js';
export * from './ranking.js';
export * from './funnel.js';
export * from './memory.js';
export * from './sales-practice.js';
export * from './eligibility.js';
export * from './campaign.js';
export * from './founder-bridge.js';
export * from './persistence.js';
/* Phase L1 — the intelligence layer between qualification and the Prospect
   Workspace. Consumes ranking/eligibility results; owns none of them. */
export * from './prospect-intelligence-contract.js';
export * from './prospect-context.js';
export * from './prospect-intelligence.js';
export * from './workspace-view-model.js';
/* L2 — the database/model boundary and the runtime orchestrator. */
export * from './prospect-runtime.js';
/* "Worth my time?" — offer-relative, asked AFTER qualification's
   "valid lead?", and deliberately never merged into it. */
export * from './priority-intelligence.js';
/* L3 — the deterministic, model-free board projection. */
export * from './leads-board.js';
/* L5A — Firecrawl as a website-evidence TRANSPORT for website-inspection.js.
   It emits no findings of its own; see the module header. */
/* L5B — Contact Intelligence. Hunter is an ENRICHMENT provider whose raw
   payload never leaves hunter.js; contact-intelligence.js decides who to
   contact and can never change what a prospect is worth. */
export * from './hunter.js';
export * from './contact-intelligence.js';
/* Apollo is exported for the SAME reason hunter.js is — the Edge Function needs
   the transport and the pure normalizer — and, like hunter.js, it exposes no
   `discover()`, so re-exporting it here cannot make it reachable as a source of
   prospects. decision-maker-intelligence.js is the layer that decides whether
   asking Apollo is worth a credit; it calls nothing itself. */
/* Exa answers WHY NOW and nothing else. Like hunter.js and apollo.js it
   exposes no `discover()`, so re-exporting it cannot make it a source of
   prospects; and why-now-intelligence.js writes nothing that ranking.js or
   priority-intelligence.js reads, so a timing signal can explain a good
   prospect but never create one. */
export * from './exa.js';
export * from './why-now-intelligence.js';
/* L4 — the one operation the Founder Calendar execution bridge may run. */
