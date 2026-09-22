/**
 * Analyst chat collector — Founder Venture State V2, task spec section 4/B.
 *
 * Deterministic, rule-based (never an LLM call, never a guess): extracts a
 * small, explicit set of clear factual patterns from one chat message.
 * Every extracted fact is `analyst_chat` / `provisional` — chat facts never
 * arrive at any higher trust tier (see fact-ledger.js's
 * SOURCE_TYPE_TO_DEFAULT_STATUS); only an explicit user confirmation
 * (collectors/manual.js) or verified proof (collectors/proof.js) can raise
 * one afterwards.
 *
 * Hypothetical/speculative phrasing ("maybe", "imagine if", "might",
 * "what if", "could") is detected FIRST and blocks extraction entirely for
 * that sentence — a hypothetical is never stored as a candidate fact, not
 * even a provisional one. This is deliberately conservative: missing a real
 * fact is safe (the founder can restate it or confirm it manually); storing
 * a fabricated one is not.
 */

import { buildFact } from '../fact-ledger.js';

// Exported so other chat-extraction collectors (collectors/entities.js) reuse
// the exact same hypothetical-language gate rather than a second, possibly
// drifting copy.
export const HYPOTHETICAL_RE = /\b(maybe|imagine|might|what if|could|hypothetically|in theory|i guess|possibly|perhaps)\b/i;

// Each pattern: a regex plus which factKey/value it produces from the
// match. Intentionally small and literal — this is not a general-purpose
// NLP extractor, only the specific, unambiguous statement shapes the task
// spec names as real examples.
const PATTERNS = Object.freeze([
  {
    factKey: 'completedWork',
    re: /\bi(?:'ve| have)?\s*(?:already\s+)?built\s+(.+?)[.!]?$/i,
    toValue: (match) => [match[1].trim()],
  },
  {
    factKey: 'customerEvidence',
    re: /\bi\s+have\s+no\s+customers\b/i,
    toValue: () => ({ customerCount: 0, hasPayingCustomers: false, evidenceType: 'none' }),
  },
  // "nobody/no one has paid (yet)" is a customer/payment-evidence
  // statement, not a revenue AMOUNT statement -- it never fabricates a
  // specific $0 revenue figure, only that no one has paid.
  {
    factKey: 'customerEvidence',
    re: /\b(?:nobody|no ?one)\s+(?:has\s+)?paid\b/i,
    toValue: () => ({ hasPayingCustomers: false, evidenceType: 'none' }),
  },
  // BUG FIX: "I'm charging $399" is a stated OFFER PRICE, never proof of
  // zero revenue/customers. The prior version fabricated
  // hasRevenue:false/monthlyRevenueUsd:0 here, inventing "evidence" the
  // user never stated. Fixed to create only an offerPricing fact.
  {
    factKey: 'offerPricing',
    re: /\bi(?:'m| am)\s+charging\s+\$?(\d+(?:\.\d+)?)\b/i,
    toValue: (match) => ({ price: Number(match[1]), currency: 'USD' }),
  },
  // "my price is $500" -- same offer-pricing concept, different phrasing.
  {
    factKey: 'offerPricing',
    re: /\bmy\s+price\s+is\s+\$?(\d+(?:\.\d+)?)\b/i,
    toValue: (match) => ({ price: Number(match[1]), currency: 'USD' }),
  },
  // A genuinely earned amount ("I made $1,200 this month" / "I earned
  // $500") is a candidate REVENUE fact -- provisional until confirmed or
  // proof-verified, never merged with pricing.
  {
    factKey: 'revenue',
    re: /\bi\s+(?:made|earned)\s+\$?([\d,]+(?:\.\d+)?)\s*(.*?)[.!]?$/i,
    toValue: (match) => {
      const amount = Number(match[1].replace(/,/g, ''));
      const trailing = match[2].trim();
      return trailing ? { amount, currency: 'USD', period: trailing } : { amount, currency: 'USD', period: 'unspecified' };
    },
  },
  {
    factKey: 'requestedHelp',
    re: /\bi\s+need\s+help\s+(.+?)[.!]?$/i,
    toValue: (match) => `help ${match[1].trim()}`,
  },
]);

/**
 * @param {object} params
 * @param {string} params.ventureId
 * @param {string} params.userId
 * @param {string} params.message Raw chat message text (never stored verbatim beyond the short evidence reference — see metadata below).
 * @param {string} params.messageReference A stable, non-secret reference to this exact message (e.g. `chat_message:<id>`), never the full transcript.
 * @param {string} params.occurredAt ISO timestamp of when the message was sent.
 * @returns {{facts: object[], skippedHypothetical: boolean}}
 */
export function extractCandidateFactsFromChatMessage({
  ventureId, userId, message, messageReference, occurredAt,
}) {
  if (typeof message !== 'string' || message.trim().length === 0) {
    return { facts: [], skippedHypothetical: false };
  }
  if (HYPOTHETICAL_RE.test(message)) {
    return { facts: [], skippedHypothetical: true };
  }

  const facts = [];
  let seq = 0;
  for (const pattern of PATTERNS) {
    const match = message.match(pattern.re);
    if (!match) continue;
    facts.push(buildFact({
      factId: `${messageReference}:${seq++}`,
      ventureId,
      userId,
      factKey: pattern.factKey,
      value: pattern.toValue(match),
      sourceType: 'analyst_chat',
      sourceReference: messageReference,
      occurredAt,
      recordedAt: occurredAt,
      metadata: { extractedFromPattern: pattern.factKey },
    }));
  }

  return { facts, skippedHypothetical: false };
}
