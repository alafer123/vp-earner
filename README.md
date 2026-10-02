# VP Earner

Autonomous ACP provider agent on Base (EVM) earning USDC on the Virtuals Protocol marketplace.

## What It Does

VP Earner is an autonomous economic agent that:

1. **Scans** the Virtuals ACP marketplace every 5 minutes for new job auctions
2. **Scores** each job 0-100 based on margin, capability match, deadline feasibility, and requester credibility
3. **Accepts** qualifying jobs (score >= 70, minimum 3x payout-to-compute margin)
4. **Executes** the requested service using node.js compute (code review, market analysis, technical writing, audits)
5. **Delivers** results and **collects** USDC payment — all on-chain via Privy signers

### Live Cycle Data

```
Agent:       0xe8ee0f12cb5b9f1697c43161d3f62bd31c3dd15e
Chain:       Base (8453)
Wallet:      Privy-authenticated EVM
Schedule:    Every 5 minutes (cron)
Scan window:  30 seconds per cycle
Budget:      $199/week compute cap, $28/day soft cap
```

## Current Services

| Service | Price | Est. Compute | Margin | Category |
|---|---|---|---|---|
| Code Review — TypeScript/React/Node | $5 | $0.50 | 10x | code-review |
| Market Intelligence — Crypto/DeFi/AI | $10 | $1.00 | 10x | market-intel |
| Technical Writing — API Docs (OpenAPI) | $8 | $0.80 | 10x | tech-writing |
| Telegram Mini App Audit | $15 | $2.00 | 7.5x | audit |
| Smart Contract Audit — Solidity | $25 | $3.00 | 8.3x | audit-solidity |
| DeFi Yield Optimization Report | $12 | $1.00 | 12x | yield-opt |
| On-Chain Transaction Analysis | $10 | $0.75 | 13x | onchain-analysis |
| Token Vesting Schedule Analysis | $12 | $0.75 | 16x | vesting-analysis |

## Setup

### Prerequisites

- Node.js v18+
- npm or yarn
- A funded Base wallet (ETH for gas, USDC for escrow)
- Virtuals Protocol API key
- Alchemy API key for Base RPC

### Installation

```bash
npm install
npx tsc  # compile TypeScript to dist/
```

### Configuration

All credentials are managed through the Hermes profile `.env`:

```env
WALLET_ADDRESS=0xe8ee0f12...
PRIVY_WALLET_ID=...            # Privy wallet ID from Virtuals console
PRIVY_SIGNER_PRIVATE_KEY=base64-encoded-privy-key
VIRTUALS_API_KEY=acp-...
ALCHEMY_API_KEY=alch_...
BUILDER_CODE=bc-...      # optional
HERMES_HOME=/path/to/hermes/profiles/default
```

### Running

```bash
# Single cycle
node dist/run-cycle.js

# Via Hermes cron (automated every 5 minutes)
hermes cron run vp-cycle
```

## Architecture

```
┌─────────────────────────────────────────────┐
│           Hermes Cron Scheduler             │
│           (every 5 minutes)                 │
└─────────────────────┬─────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│         vp-cycle.py (wrapper)               │
│  Loads profile .env → spawns node process   │
└─────────────────────┬─────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────┐
│         run-cycle.js (compiled TS)          │
│                                             │
│  ┌─────────┐  ┌─────────┐  ┌────────────┐  │
│  │  SCAN   │→│ SCORE   │→│ ACCEPT     │  │
│  │ (30s)   │  │ (0-100) │  │ (escrow)  │  │
│  └─────────┘  └─────────┘  └────────────┘  │
│     ↓                                    │
│  ┌─────────────────────────────────────┐  │
│  │           EXECUTE                  │  │
│  │  code-review | market-intel | ...   │  │
│  └─────────────────────────────────────┘  │
│     ↓                                    │
│  ┌─────────────────────────────────────┐  │
│  │           DELIVER                   │  │
│  │  Submit result → evaluator          │  │
│  └─────────────────────────────────────┘  │
│     ↓                                    │
│  ┌─────────────────────────────────────┐  │
│  │           COLLECT                   │  │
│  │  USDC released on approval          │  │
│  └─────────────────────────────────────┘  │
└─────────────────────────────────────────────┘
```

## Guardrails

| Guardrail | Threshold |
|---|---|
| Weekly compute cap | $199 (hard limit) |
| Daily compute cap | $28 (soft limit) |
| Min payout margin (NORMAL) | 3x |
| Min payout margin (STRICT) | 5x |
| Kill switch | 3 consecutive evaluation failures |
| Mode escalation | 80% weekly cap → STRICT (5x margin) |

## Files

| File | Purpose |
|---|---|
| `run-cycle.ts` | Main cycle logic (TypeScript source) |
| `dist/run-cycle.js` | Compiled JavaScript |
| `hermes-project.yaml` | Hermes project config + cron schedule |
| `budget-state.md` | Running budget/bid tracking |
| `operational-log.md` | Full cycle history |
| `package.json` | Dependencies |
| `tsconfig.json` | TypeScript config |

## License

MIT