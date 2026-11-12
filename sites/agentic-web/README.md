# LedgerGuard Open Agentic Web site

A public, browser-executed agentic website for [LedgerGuard](https://github.com/Val1-IT/Arvanta-Ledgerguard). It follows the [Open Agentic Web MVP specification](https://github.com/cognizant-ai-labs/agentic-web/blob/main/docs/worldwide_agentic_web_mvp_spec.md) and is intended as the project's entry for the [Cognizant Open Agentic Web Challenge](https://cognizant-agenticweb.devpost.com/).

LedgerGuard is framed here as **deterministic policy and verification infrastructure for AI agents doing financial and ERP actions**. Agents may inspect a synthetic ledger and propose a repair. They do not receive mutation authority because a model emitted a tool call. Policy is ordinary code, with three outcomes: `ALLOW`, `DENY`, and `REQUIRE_APPROVAL`. A human approves an exact plan version. Execution is verified, then a hashed audit receipt is issued.

The fixture is **Harborlight Supplies**, a fictional tenant. It reuses the synthetic Industrial Widget numbers from `examples/inventory-ledger`. There is no Arvanta, Cheermol, or customer data.

## Run the demo (one command)

From the repository root, with Node.js 24 (or 20.19+ / 22.12+):

```bash
pnpm demo:agentic-web
```

Open http://127.0.0.1:8765/. The policy console works without a key: evaluate the duplicate-repair plan (`REQUIRE_APPROVAL`), approve it as the human operator, execute and verify (quantity 20.000 → 10.000, value 1,700,000.00 → 850,000.00 IDR), then try the same execution key again (`DENY`, `DUPLICATE_EXECUTION`).

To chat, expand **BYOK / router settings**, enter your own API key, model, and an OpenAI-compatible router that allows browser CORS (OpenAI, OpenRouter, LiteLLM, or a local Ollama). Hosted Anthropic and hosted Otari do not allow browser calls. LedgerGuard never receives or stores the key; it stays in this origin's browser storage. Prefer a key with a low spending limit, and delete the saved setup when you are done.

`pnpm test:agentic-web` runs the site's Node tests (no LLM key). Rebuild the published network after editing the HOCON or manifest with `pnpm build:agentic-web`.

## Public files

These are the published agent artifacts, all statically hosted:

| File | Role |
| --- | --- |
| `agent-manifest.json` | Site index: network name, front agent `ledgerguard_concierge`, network location, BYOK router metadata, actions |
| `ledgerguard_policy_assistant.network.json` | Resolved, data-only agent network (built from the `.hocon` source; do not edit the JSON by hand) |
| `links.json` | Peer-network link map (empty: this skill does not link other agent sites yet) |
| `runtime/` | Browser runtime that executes the network in the visitor's tab (nsdeploy, Apache-2.0, with website_* tool edits; see `runtime/README.md` and `runtime/LICENSE.txt`) |
| `.well-known/nsdeploy.json` and `.well-known/nsdeploy-agent.json` | Optional discovery metadata |
| `_headers` | CORS headers for Cloudflare Pages |

The page remains usable if the assistant fails to boot.

## Agent network

- `ledgerguard_concierge` (front agent) reads state, policies and receipts, evaluates plans, and delegates the approval and execution workflow.
- `repair_officer` walks a plan through evaluate → approve or reject → execute and verify.

Site actions, all wrapping `script.js` (`App.page`), so the console buttons and the assistant share one set of rules:

| Action | Effect | What it does |
| --- | --- | --- |
| `website_get_site_state` | read | Ledger, incident, plans, receipt summaries, page version, limits |
| `website_get_policies` | read | The six policy rules and the financial threshold |
| `website_get_receipt` | read | One hashed audit receipt |
| `website_evaluate_plan` | write | Runs `evaluateExecutionPolicy` and records a policy receipt; does not change the ledger |
| `website_reset_demo` | write | Restores the opening synthetic fixture |
| `website_approve_plan` | irreversible | Records a human approval of the exact plan version |
| `website_reject_plan` | irreversible | Records a human rejection |
| `website_execute_plan` | irreversible | Executes only on `ALLOW`, verifies postconditions, commits or rolls back, writes a receipt |

The browser policy engine in `policy-engine.js` is a port of `@ledgerguard/policy`. `tests/policy-parity.test.mjs` compares outcomes, reasons and approval metadata against the TypeScript package.

## Significant update after 11 November 2026

LedgerGuard existed before the Open Agentic Web Challenge submission period. This work is a significant update after the period started (11 November 2026, 20:00 Pacific Time):

- A new public website, not only the existing terminal demo or Next.js app.
- A conforming Open Agentic Web publication (manifest, resolved `.network.json`, browser runtime, BYOK chat, site actions).
- The deterministic policy package is now exercised in the browser, with human confirmation in front of irreversible tools and hashed audit receipts the visitor can inspect.
- New tests for policy parity and the agentified actions.

Please include this explanation in the Devpost text description.

## Challenge requirement mapping

See the pull request description for a table mapping each Submission Requirement and judging criterion to this site. In short: Stage One conformance files and interfaces are in this folder; Technological Implementation uses the official runtime and the real policy rules; Design is a complete console plus assistant, not a bare chat stub; Potential Impact and Quality of the Idea are the case that agents acting on ledgers need deterministic policy, human approval, and receipts rather than model-granted authority.

## Hosting

This folder is a static site. Production hosting must use HTTPS and should send CORS headers for the public agent files (see `_headers`).

This repository's GitHub Actions token does not have the `workflow` scope, and no Cloudflare or GitHub Pages credentials were available when the site was added. Suggested free options, for the repository owner:

1. **Cloudflare Pages** (preferred): create a project from this GitHub repository, set the output directory to `sites/agentic-web`, no build command. `_headers` will enable CORS. Sign in to Cloudflare and connect the repo once.
2. **GitHub Pages**: in the repository settings, deploy the `sites/agentic-web` folder from the default branch, or from this branch until it is merged. GitHub Pages may not send `Access-Control-Allow-Origin` for every file; if peer sites cannot fetch the manifest, prefer Cloudflare Pages or add a Pages custom header configuration.

Do not add a GitHub Actions workflow unless a token with the `workflow` scope will push it.

## Limits

- Static hosting only; there is no public MCP facade.
- The runtime is a patched copy of nsdeploy's, as supplied by the official `agentify-website` skill. Do not edit `runtime/`.
- `write` actions (`evaluate_plan`, `reset_demo`) run without a confirmation dialog, which the MVP spec does not allow for writes in general. They do not mutate the ledger.
- Every agent can see every `website_*` tool.
- This page does not call other agentic websites; other sites can load the published network once this origin is hosted with CORS.
- The LLM provider must allow CORS. The network file, including instructions, is public. Do not put keys in it.
- The demo ledger is in-memory in the current tab.

## License

Site code follows the repository's Apache-2.0 license. The copied `runtime/` is Apache-2.0 nsdeploy code with the skill's website_* tool edits, at nsdeploy commit `23df164`.
