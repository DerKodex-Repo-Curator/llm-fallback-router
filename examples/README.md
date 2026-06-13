# Examples

All examples run offline against mock providers (no API keys needed). They
import from the built output, so run `npm run build` first — or use the
`npm run example:*` scripts which build automatically.

| File | What it shows | Run |
|---|---|---|
| `quickstart.mjs` | One router, automatic failover (real providers if keys are set) | `npm run example:quickstart` |
| `failover.mjs` | A provider outage and transparent recovery, with the decision log | `npm run example:failover` |
| `cost-aware.mjs` | Tier-based + cost-based routing under a budget | `npm run example:cost` |
| `traffic-split.mjs` | Weighted canary / A-B traffic split | `npm run example:split` |
| `dashboard.mjs` | Live web dashboard + JSON API at `http://127.0.0.1:7575` | `npm run example:dashboard` |

The shareable terminal scoreboard is `npm run demo` (source in `scripts/scoreboard.mjs`).

## Using real providers

Set any of these and the quickstart will use the real APIs:

```bash
export OPENAI_API_KEY=sk-...
export ANTHROPIC_API_KEY=sk-ant-...
export GEMINI_API_KEY=...
export MISTRAL_API_KEY=...
node examples/quickstart.mjs
```
