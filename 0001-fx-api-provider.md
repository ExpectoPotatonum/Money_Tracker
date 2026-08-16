# ADR 0001: FX conversion provider for the web dashboard

**Status:** Accepted — 2026-08-16

## Context

`agents.md` §3 (non-negotiable constraint 3) requires the database to store the original amount + currency only; MYR conversion for the main dashboard total happens in the web UI at display time. §15 left the specific FX provider open, suggesting a free-tier provider (exchangerate.host or Frankfurter) fetched once and cached client-side per session, contingent on confirming coverage for MYR, USD, CNY, and whatever Wise/Alipay add.

`ARCHITECTURE.md` §5 already isolates this choice behind a single function, `web/src/utils/fx.js`, so nothing else in `/web` needs to know which provider is behind it.

## Decision

Use **Frankfurter** (`https://api.frankfurter.dev`).

Confirmed against the live API docs (frankfurter.dev, checked 2026-08-16 — this is a newer v2 of the API, broader than the ECB-only version some older references describe):
- No API key required, no request quota — only abuse-prevention rate limiting.
- v2 covers 201 currencies from 84 central bank sources, including MYR, USD, and CNY (the three named in `agents.md` §15), each with double-digit-plus provider coverage.
- A single `GET /v2/rate/{base}/{quote}` call returns the rate — no SDK, no response shape to wrangle beyond one JSON field.

## Consequences

- `fx.js` fetches a rate once and caches it in memory for the life of the page load. A static single-page dashboard doesn't need `sessionStorage` on top of that; revisit if the dashboard becomes multi-page and a rate needs to survive navigation.
- If a currency Wise/Alipay introduces later isn't in Frankfurter's list, that surfaces as a non-OK response from `/v2/rate/{base}/{quote}` — `fx.js` returns `null` rather than throwing, so the caller's contract is "show the original amount, skip MYR conversion for that row" instead of failing the whole dashboard load.
- No API key means no secret to add to Netlify's env vars for this integration specifically — one less credential in the surface described in `agents.md` §12.
- Revisit only if rate-limiting becomes a real problem at actual usage (unlikely for a single-user dashboard loaded a few times a day), or if self-hosting becomes worth it — Frankfurter supports Docker self-hosting if that's ever needed.
