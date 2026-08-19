# Integration Requirements — FitSolver & FitVisualizer

Status: needs input from both sibling teams. This lists what FitPortal
currently has, and what's still missing, blank, or unconfirmed.

## What we currently have

From `.env.example`:

```
FITSOLVER_URL=https://fitsolver.example.com/optimize
FITVISUALIZER_URL=https://fitvisualizer.example.com/render
```

Both are placeholder values, not real endpoints. FitPortal's Edge Function
(`supabase/functions/optimize/index.js`) already reads `FITSOLVER_URL` from
env and does a `POST` with a JSON body, but the URL itself hasn't been
provided by FitSolver yet.

`docs/api-contract.md` defines a draft request/response shape for
`POST /optimize`, but it's explicitly marked as needing sign-off from both
teams, with several unresolved questions listed in it.

## Information needed from FitSolver

- [ ] **Real base URL** for the `/optimize` endpoint (dev, staging, and prod
      if they differ)
- [ ] **Port**, if not running behind a standard 443/80 — e.g. if it's a bare
      dev server during Sprint 1
- [ ] **Auth between services** — does the Edge Function need to send an API
      key, bearer token, or shared secret when calling FitSolver? Right now
      the code sends no auth headers at all.
- [ ] **Timeout / SLA confirmation** — the architecture diagram says "well
      under 60s," but what should FitPortal treat as a hard timeout before
      giving up and showing an error?
- [ ] **Error response shape** — `docs/api-contract.md` lists this as an open
      question. If FitSolver can't solve an order (vs. a malformed request),
      what does that response look like?
- [ ] Answers to the three other open questions already logged in
      `docs/api-contract.md`:
  - Rotation representation (degrees per axis vs. discrete orientation index)
  - Does FitSolver choose which containers to use, or does FitPortal
    pre-assign them?
  - Coordinate origin convention (which corner is `0,0,0`)

## Information needed from FitVisualizer

- [ ] **Real base URL** for wherever it accepts a result to render (dev,
      staging, prod)
- [ ] **Port**, if applicable
- [ ] **How FitPortal should send the result** — this is still a TODO in
      `src/main.js` ("forward result to FitVisualizer for rendering"), so the
      handoff mechanism isn't built yet. Need to know:
      - Does FitPortal POST the result JSON directly to FitVisualizer?
      - Or does FitVisualizer read straight from `order_results` in Supabase
        (in which case it needs read access, e.g. anon key + RLS policy)?
- [ ] **Auth**, if it's a direct POST — same question as FitSolver, is there
      an API key or token expected?
- [ ] **Expected payload shape** — presumably the same `packedContainers` /
      `unpackedItems` structure FitSolver returns, but worth confirming
      FitVisualizer wants it as-is or reshaped

## Suggested next step

Get one point of contact from each sibling team to fill in the checkboxes
above directly, since guessing at URLs or auth schemes isn't something I can
do responsibly, these need to come from the teams that own those services.
