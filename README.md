# FreshCheck: stale-answer detector and freshness gateway

**Problem.** LLM apps state facts that have changed (prices, API versions, laws, who runs a company) with full confidence.
**Solution.** FreshCheck takes any LLM answer, finds the claims likely to have gone stale, re-verifies each against live
web sources (Tavily), scores freshness per claim, and rewrites the answer with sourced corrections. It also runs as an
OpenAI-compatible layer in front of the Bifrost AI gateway, so every model behind Bifrost can be freshness-checked.

<!-- Add the exact Tavily and Bifrost problem-statement titles you chose here, copied from the hackathon post. -->

## How AI is used
1. **Gemini (structured JSON)** extracts time-sensitive claims, rates how fast each decays (volatility) and writes a
   search query aimed at the *current* truth.
2. **Tavily** fetches live evidence (recent-biased for fast-changing facts; Extract reads whole pages).
3. **Gemini** judges every claim against only that evidence (supported / outdated / contradicted / unverifiable, with
   confidence and cited sources) and produces a corrected answer. Two Gemini calls per answer, however many claims.
4. **Agentic second round:** if evidence cannot settle a claim, Gemini plans a *different* query and Tavily runs it at
   advanced depth (bounded to one extra round).

## Quick start
**Local (XAMPP or any MySQL):** start MySQL, then
```
cd backend && pip install -r requirements.txt
copy .env.example .env        (Linux/macOS: cp)   -> add TAVILY_API_KEY and GEMINI_API_KEY
python app.py                 -> http://localhost:5000
```
**Docker (FreshCheck + MySQL + Bifrost):**
```
cp backend/.env.example backend/.env     # add your keys
docker compose up --build
```
Open http://localhost:8080 once to add your provider key in Bifrost's web UI. FreshCheck is on http://localhost:5000.
No Gemini key? It falls back to rule-based mode. MySQL down? It still works; history and the cache are disabled.

## Gateway: FreshCheck in front of Bifrost
Point `LLM_BASE_URL` at Bifrost's OpenAI-compatible endpoint (`http://localhost:8080/v1`, models named `provider/model`),
then call FreshCheck exactly like OpenAI: `POST /v1/chat/completions`. The reply gains a `freshness` field.

| Request field | Effect |
|---|---|
| `freshcheck: "inline"` (default) | wait for the report and attach it |
| `freshcheck: "async"` | reply immediately with a `job_id`; poll `GET /api/jobs/<id>`; low scores send a webhook alert |
| `freshcheck: "off"` or header `X-FreshCheck: off` | pure pass-through |
| `freshcheck_autofix: true` | the corrected answer replaces the reply content (never applied to truncated replies) |
| `freshcheck_min_score: 70` | adds `freshness.below_threshold` so a caller can gate, retry or escalate |

Streaming requests are passed through untouched. Responses carry `X-FreshCheck-Score` and `X-FreshCheck-Stale` headers.
```
curl -s localhost:5000/v1/chat/completions -H "Content-Type: application/json" -H "X-API-Key: $FRESHCHECK_API_KEY" \
  -d '{"model":"openai/gpt-4o-mini","messages":[{"role":"user","content":"What is the latest stable Python version?"}],"freshcheck_autofix":true}'
```

## Security
Treated as a first-class feature, with offline tests (`python test_security.py`, 33 checks, no keys needed):
- **Prompt-injection defence.** Search results are scanned (including zero-width character tricks) and any page that
  tries to instruct the model is dropped and counted. The judge prompt marks the answer and evidence as untrusted data.
- **Output validation.** The model-written corrected answer is rejected if it is much longer than the original, contains
  instruction-like text, or adds a link that is in neither the original nor the evidence.
- **Safe defaults.** Debug mode off, server on 127.0.0.1, CORS limited to local origins, 6,000-character input cap,
  per-IP rate limit (bounded memory, `TRUST_PROXY` for reverse proxies).
- **Key-protected admin surface.** With `FRESHCHECK_API_KEY` set, the gateway, `/metrics`, `/api/jobs` and watchlist
  writes require `X-API-Key` (constant-time comparison).
- **Hosted demo mode.** `PUBLIC_MODE=1` hides history, rejects numeric ids and keeps admin routes closed unless a key is set.
- **Unguessable share links.** Reports are shared by random token (`#r<token>`), not by counting ids.
- The UI shows a shield badge when an injection attempt was blocked.

## Evaluation
`python eval.py` runs 42 labelled claims in three groups: **stale** (24), **fresh-hard** (15: historical claims that *look*
time-sensitive but are correct, such as "Python 3.12 was released in October 2023") and **fresh-easy** (3). The hard group
stops a system from scoring well by flagging everything that mentions a version or a date.
`python eval.py --rules` is the no-AI baseline; `--out report.md` writes the numbers. Run both and report the improvement.
Labels are as of late 2026; re-verify before editing.

## Monitoring and observability
- **Watchlist:** "Watch this answer" saves it. A background thread re-checks watched answers every 6 hours, 24 hours or
  7 days depending on how fast their claims decay, bypassing the cache, and logs every claim whose status changed.
- **Alerts:** set `WEBHOOK_URL` (Discord or Slack).
- **`/healthz`** shows which dependencies are configured; **`/metrics`** exposes Prometheus counters (analyses, claims,
  stale found, cache hits and misses, Tavily and Gemini calls, gateway requests, injection attempts blocked).

## More features
- **Chrome extension** (`extension/`): select text on any page, right-click, "Check freshness of selected text". The badge
  shows the trust score. Open the popup's *Server* section to point it at a hosted FreshCheck (Chrome asks permission for that one server).
  Install: `chrome://extensions` -> Developer mode -> Load unpacked -> choose `extension`.
- **Page audit:** paste a URL; Tavily Extract reads the page and FreshCheck checks its claims.
- **Ask mode:** Gemini answers *without* web access, then FreshCheck audits and corrects it. Progress streams live (SSE).
- **Source authority:** official sources (.gov, .edu, europa.eu, docs./developer. hosts) count more.
  Score = 65% verdict x confidence + 25% recency + 10% source authority; fast-decaying claims weigh more in the trust score.
- **Time awareness:** claims show when the fact changed ("changed 20 months ago").
- **Reports:** download Markdown from the UI, or `GET /api/analysis/<token>/report.md`.
- **Evidence cache:** MySQL, TTL by volatility (6h / 48h / 7d); the key includes search depth and recency window.
- **SDK** (`sdk/freshcheck_sdk.py`): `fc.check()`, `fc.fix()`, `@fc.guard`, plus `fc.chat(...)` and `fc.wait(job_id)` for the gateway.

## Configuration
Everything is in `backend/.env.example`, with comments. Never commit `.env` or paste keys into chats.

## Deploying
`docker compose up --build`, or run `gunicorn -w 1 --threads 8 --timeout 180 -b 0.0.0.0:5000 wsgi:app` from `backend/`.
Keep one worker (the watchlist thread must run once). Before exposing it: set `FRESHCHECK_API_KEY`, `PUBLIC_MODE=1`,
`TRUST_PROXY=1` (behind your proxy) and your own `CORS_ORIGINS`.
