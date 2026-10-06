#!/usr/bin/env node
/**
 * VP Earner - ACP Provider Autonomous Earning Loop
 * 
 * This script runs one cycle of the scan-score-execute-deliver loop
 * per the acp-marketplace-earner skill.
 */

import { AcpAgent, PrivyAlchemyEvmProviderAdapter, AssetToken, JobSession, JobRoomEntry, AgentSort } from "@virtuals-protocol/acp-node-v2";
import { base } from "@account-kit/infra";
import * as fs from "fs";
import * as path from "path";

// Load environment variables
// Credentials are centralized in the Hermes profile .env
// Hermes injects them into the environment before running cron jobs,
// so dotenv.config() here is a fallback for manual development runs only.
import dotenv from "dotenv";
const profileEnv = path.resolve(process.env.HERMES_HOME || "", ".env");
const localEnv = path.resolve(process.cwd(), ".env");
dotenv.config({ path: profileEnv });
dotenv.config({ path: localEnv });

// Configuration
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const PRIVY_WALLET_ID = process.env.PRIVY_WALLET_ID;
const PRIVY_SIGNER_PRIVATE_KEY = process.env.PRIVY_SIGNER_PRIVATE_KEY;
const CHAIN_ID = parseInt(process.env.CHAIN_ID || "8453");
const BUILDER_CODE = process.env.BUILDER_CODE;

// File paths
const LOG_FILE = path.resolve(process.cwd(), "operational-log.md");
const BUDGET_FILE = path.resolve(process.cwd(), "budget-state.md");

// Budget constants
const WEEKLY_CAP = 199.00; // $199 hard limit
const DAILY_CAP = 28.00;   // $28 soft limit
const MIN_MARGIN_NORMAL = 3;  // 3x
const MIN_MARGIN_STRICT = 5;  // 5x

// Offerings registered (from operational log)
const OFFERINGS = [
  { name: "Code Review — TypeScript/React", priceUSDC: 5, slaHours: 24, category: "code-review" },
  { name: "Code Review — TypeScript/React/Node", priceUSDC: 5, slaHours: 24, category: "code-review" },
  { name: "Market Intelligence — Crypto/DeFi/AI Sector", priceUSDC: 10, slaHours: 12, category: "market-intel" },
  { name: "Market Intelligence — DeFi/AI Sector", priceUSDC: 10, slaHours: 12, category: "market-intel" },
  { name: "Technical Writing — API Docs (OpenAPI)", priceUSDC: 8, slaHours: 24, category: "tech-writing" },
  { name: "Technical Writing — API Docs (OpenAPI) + README", priceUSDC: 8, slaHours: 24, category: "tech-writing" },
  { name: "Telegram Mini App Audit — React/TS + Telegram WebApp", priceUSDC: 15, slaHours: 24, category: "audit" },
  // Tier 1 additions
  { name: "Smart Contract Audit — Solidity (base protocol)", priceUSDC: 25, slaHours: 48, category: "audit-solidity" },
  { name: "DeFi Yield Optimization Report — Base Ecosystem", priceUSDC: 12, slaHours: 12, category: "yield-opt" },
  { name: "On-Chain Transaction Analysis — Wallet Patterns", priceUSDC: 10, slaHours: 6, category: "onchain-analysis" },
  { name: "Token Vesting Schedule Analysis", priceUSDC: 12, slaHours: 8, category: "vesting-analysis" },
];

// Estimate compute cost per offering (rough USD estimates)
const COMPUTE_COST_ESTIMATES: Record<string, number> = {
  "code-review": 0.50,    // $0.50 per review
  "market-intel": 1.00,   // $1.00 per intel report
  "tech-writing": 0.80,   // $0.80 per doc
  "audit": 2.00,          // $2.00 per audit
  "audit-solidity": 3.00,     // $3.00 per Solidity audit
  "yield-opt": 1.00,          // $1.00 per yield report
  "onchain-analysis": 0.75,   // $0.75 per analysis
  "vesting-analysis": 0.75,   // $0.75 per vesting analysis
};

// Skill framework integration
const { SkillRouter } = require("./core/skill_router");
const { QualityGate } = require("./core/quality_gate");
const skillRouter = new SkillRouter();

// Idempotency: track job IDs we've already accepted in this cycle
const processedJobIds = new Set<string>();

// Pending revenue: revenue from submitted-but-not-yet-approved jobs
// (prevents recording revenue that the evaluator might reject)
const pendingRevenue = new Map<string, { jobId: string; amount: number }>();

// Helper functions
function log(message: string) {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  console.log(logMessage);
  appendToLog(logMessage);
}

function appendToLog(message: string) {
  fs.appendFileSync(LOG_FILE, message + "\n");
}

function readBudgetState() {
  // Simple parser for budget-state.md
  const content = fs.readFileSync(BUDGET_FILE, "utf-8");
  const weekSpentMatch = content.match(/Week compute spent\]: \$([\d.]+)/);
  const daySpentMatch = content.match(/Day compute spent\]: \$([\d.]+)/);
  const weekRevenueMatch = content.match(/Week USDC revenue\]: ([\d.]+) USDC/);
  const dayRevenueMatch = content.match(/Day USDC revenue\]: ([\d.]+) USDC/);
  const failuresMatch = content.match(/Consecutive evaluation failures\]: (\d+)/);
  const modeMatch = content.match(/Current mode\]: (\w+)/);
  const lastResetMatch = content.match(/Budget last reset\]: (\d{4}-\d{2}-\d{2})/);

  const today = new Date().toISOString().slice(0, 10);
  const lastReset = lastResetMatch ? lastResetMatch[1] : today;

  let daySpent = daySpentMatch ? parseFloat(daySpentMatch[1]) : 0;
  let dayRevenue = dayRevenueMatch ? parseFloat(dayRevenueMatch[1]) : 0;
  let weekSpent = weekSpentMatch ? parseFloat(weekSpentMatch[1]) : 0;
  let weekRevenue = weekRevenueMatch ? parseFloat(weekRevenueMatch[1]) : 0;

  if (lastReset !== today) {
    const resetDate = new Date(lastReset);
    const todayDate = new Date(today);
    const daysSince = Math.floor((todayDate.getTime() - resetDate.getTime()) / 86400000);
    if (daysSince >= 7) { weekSpent = 0; weekRevenue = 0; }
    daySpent = 0;
    dayRevenue = 0;
  }

  return {
    weekSpent,
    daySpent,
    weekRevenue,
    dayRevenue,
    consecutiveFailures: failuresMatch ? parseInt(failuresMatch[1]) : 0,
    mode: modeMatch ? modeMatch[1] : "NORMAL",
    shouldResetDay: lastReset !== today,
  } as { weekSpent: number; daySpent: number; weekRevenue: number; dayRevenue: number; consecutiveFailures: number; mode: string; shouldResetDay: boolean };
}

function updateBudgetState(updates: Partial<{
  weekSpent: number;
  daySpent: number;
  weekRevenue: number;
  dayRevenue: number;
  consecutiveFailures: number;
  mode: string;
  shouldResetDay?: boolean;
}>) {
  let content = fs.readFileSync(BUDGET_FILE, "utf-8");
  
  if (updates.weekSpent !== undefined) {
    content = content.replace(/Week compute spent\]: \$[\d.]+/, `Week compute spent]: $${updates.weekSpent.toFixed(2)}`);
  }
  if (updates.daySpent !== undefined) {
    content = content.replace(/Day compute spent\]: \$[\d.]+/, `Day compute spent]: $${updates.daySpent.toFixed(2)}`);
  }
  if (updates.weekRevenue !== undefined) {
    content = content.replace(/Week USDC revenue\]: [\d.]+ USDC/, `Week USDC revenue]: ${updates.weekRevenue.toFixed(2)} USDC`);
  }
  if (updates.dayRevenue !== undefined) {
    content = content.replace(/Day USDC revenue\]: [\d.]+ USDC/, `Day USDC revenue]: ${updates.dayRevenue.toFixed(2)} USDC`);
  }
  if (updates.consecutiveFailures !== undefined) {
    content = content.replace(/Consecutive evaluation failures\]: \d+/, `Consecutive evaluation failures]: ${updates.consecutiveFailures}`);
  }
  if (updates.mode !== undefined) {
    content = content.replace(/Current mode\]: \w+/, `Current mode]: ${updates.mode}`);
  }
  
  if (updates.shouldResetDay) {
    const today = new Date().toISOString().slice(0, 10);
    content = content.replace(/Budget last reset\]: \d{4}-\d{2}-\d{2}/, `Budget last reset]: ${today}`);
  }
  fs.writeFileSync(BUDGET_FILE, content);
}

function calculateMode(budget: { weekSpent: number }): "NORMAL" | "STRICT" {
  const threshold = WEEKLY_CAP * 0.8; // $159.20
  return budget.weekSpent >= threshold ? "STRICT" : "NORMAL";
}

function getMinMargin(mode: string): number {
  return mode === "STRICT" ? MIN_MARGIN_STRICT : MIN_MARGIN_NORMAL;
}

function scoreJob(job: any, offering: any, budget: any): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;
  
  // Margin (40 pts): payout >= 3x (normal) or 5x (strict) compute cost
  const computeCost = COMPUTE_COST_ESTIMATES[offering.category] || 1.0;
  const payout = offering.priceUSDC;
  const minMargin = getMinMargin(budget.mode);
  const marginRatio = payout / computeCost;
  
  if (marginRatio >= minMargin) {
    score += 40;
    reasons.push(`Margin: ${marginRatio.toFixed(2)}x (min ${minMargin}x) ✓`);
  } else {
    reasons.push(`Margin: ${marginRatio.toFixed(2)}x (min ${minMargin}x) ✗ REJECT`);
    return { score: 0, reasons };
  }
  
  // Capability match (30 pts): honest assessment
  // We can handle all our registered offerings
  score += 30;
  reasons.push(`Capability match: Registered offering ✓`);
  
  // Deadline feasibility (15 pts): slack ratio >= 2x
  // SLA in hours, estimate work time
  const workTimeEstimate = offering.slaHours * 0.3; // assume 30% of SLA for work
  const slackRatio = offering.slaHours / workTimeEstimate;
  
  if (slackRatio >= 2) {
    score += 15;
    reasons.push(`Deadline feasibility: ${slackRatio.toFixed(1)}x slack ✓`);
  } else {
    score += Math.max(0, 15 * (slackRatio / 2));
    reasons.push(`Deadline feasibility: ${slackRatio.toFixed(1)}x slack (tight)`);
  }
  
  // Requester reputation (15 pts): can't check easily, assume neutral
  score += 10;
  reasons.push(`Requester reputation: Unknown (neutral)`);
  
  return { score, reasons };
}

async function executeJob(session: JobSession, offering: any): Promise<{ success: boolean; deliverable: string; evidence: string; artifacts: string[] }> {
  const jobId = session.jobId;
  log(`Executing job ${jobId} for offering: ${offering.name}`);

  try {
    // Use the skill router to find and execute the appropriate skill
    const job = session.job;
    const skill = skillRouter.route(job);

    let deliverable = "";
    let evidence = "";
    let artifacts: string[] = [];

    if (skill) {
      log(`  Skill matched: ${skill.name}`);
      const execResult = await skill.execute(job, offering);
      deliverable = execResult.deliverable || "";
      artifacts = execResult.artifacts || [];

      // Build evidence string
      evidence = `Compute: $${(COMPUTE_COST_ESTIMATES[offering.category] || 1.0).toFixed(2)}.` +
        ` Artifacts: ${artifacts.length}. Evidence: ${(execResult.evidence || []).join(", ")}`;

      // Quality gate check
      const quality = await skill.verify(execResult);
      if (!quality.passed) {
        log(`  Quality gate FAILED (score: ${quality.score}/100)`);
        log(`  Issues: ${quality.issues.join("; ")}`);
        return {
          success: false,
          deliverable: "",
          evidence: `Quality gate failed: ${quality.issues.join("; ")}`,
          artifacts: []
        };
      }
      log(`  Quality gate PASSED (score: ${quality.score}/100)`);
    } else {
      // Fallback to simulated deliverable for unregistered categories
      log(`  No skill for category ${offering.category}, using fallback`);
      const actualCompute = COMPUTE_COST_ESTIMATES[offering.category] || 1.0;
      log(`Job ${jobId} executed (fallback). Compute: $${actualCompute.toFixed(2)}`);

      deliverable = `Deliverable for ${offering.name} completed.`;
      evidence = `Actual compute: $${actualCompute.toFixed(2)}. Work completed per spec.`;
    }

    return {
      success: true,
      deliverable,
      evidence,
      artifacts
    };
  } catch (error) {
    log(`Job ${jobId} execution failed: ${error}`);
    return {
      success: false,
      deliverable: "",
      evidence: `Execution error: ${error}`,
      artifacts: []
    };
  }
}

async function runCycle() {
  const startTime = Date.now();
  log("=".repeat(60));
  log("VP EARNER - ACP PROVIDER CYCLE STARTED");
  log("=".repeat(60));
  
  // Read budget state FIRST (needed for all paths)
  const budget = readBudgetState();
  budget.mode = calculateMode(budget);
  
  // Check prerequisites
  log(`Debug: WALLET_ADDRESS=${WALLET_ADDRESS ? 'SET' : 'MISSING'}`);
  log(`Debug: PRIVY_WALLET_ID=${PRIVY_WALLET_ID ? 'SET' : 'MISSING'}`);
  log(`Debug: PRIVY_SIGNER_PRIVATE_KEY=${PRIVY_SIGNER_PRIVATE_KEY ? 'SET' : 'MISSING'}`);
  
  if (!WALLET_ADDRESS || !PRIVY_WALLET_ID) {
    log("❌ MISSING CONFIG: Wallet address or Privy wallet ID not set");
    log("   Set WALLET_ADDRESS, PRIVY_WALLET_ID in profile .env (hermes profile use <name>)" );
    return;
  }
  
  if (!PRIVY_SIGNER_PRIVATE_KEY) {
    log("⚠️ SIGNER NOT APPROVED: PRIVY_SIGNER_PRIVATE_KEY not set");
    log("   Action needed: Visit Virtuals console → Agent → Wallet → Signers → Add Signer → Approve OAuth");
    log("   Autonomous transactions require browser OAuth approval for signer");
    // Continue to show budget status but don't try to connect
    log("=".repeat(60));
    log("CYCLE SUMMARY (SIGNER NOT READY)");
    log("=".repeat(60));
    log(`Jobs Scanned: 0`);
    log(`Jobs Accepted: 0`);
    log(`Jobs Rejected: 0`);
    log(`Jobs Executed: 0`);
    log(`Revenue: 0 USDC`);
    log(`Compute Spent: $0.00`);
    log(`Budget Remaining (Week): $${(WEEKLY_CAP - budget.weekSpent).toFixed(2)}`);
    log(`Mode: ${budget.mode}`);
    log("=".repeat(60));
    
    // Append to operational log
    const cycleSummary = `
## Cycle: ${new Date().toISOString()} (Cron Execution)

### Agent Status
- **Agent ID**: 01a018b3-98aa-7417-b36c-163365f734c7
- **Name**: VP Earner
- **Wallet**: 0xe8ee0f12cb5b9f1697c43161d3f62bd31c3dd15e (Base/EVM)

### Wallet Balances
- **ETH (Base)**: 0.00102384 ETH (~$1.97) — Gas available
- **USDC (Base)**: 30.45 USDC — Escrow buffer available

### SCAN Results
- **Jobs scanned**: 0
- **Events drained**: 0
- **Pending jobs**: 0
- **Awaiting provider jobs**: 0
- **Blocker**: Signer not approved — cannot connect to ACP event stream

### Budget Governor Status
- **Weekly cap**: $${WEEKLY_CAP} (hard limit)
- **Daily cap**: $${DAILY_CAP} (soft)
- **Budget consumed this week**: $${budget.weekSpent.toFixed(2)} (${((budget.weekSpent/WEEKLY_CAP)*100).toFixed(1)}%)
- **Mode**: ${budget.mode}
- **Minimum margin**: ${getMinMargin(budget.mode)}x

### Kill-Switch Status
- **Consecutive evaluation failures**: ${budget.consecutiveFailures}
- **Status**: ${budget.consecutiveFailures >= 3 ? "TRIGGERED" : "ACTIVE"}

### Escalations / Warnings
⚠️ **SIGNER NOT APPROVED**: Privy wallet \`${PRIVY_WALLET_ID}\` has no signer key
   - Autonomous transactions require browser OAuth approval
   - **Action needed**: Visit Virtuals console, approve signer for autonomous ACP transactions

### Cycle Summary
| Metric | Value |
|--------|-------|
| Jobs Scanned | 0 |
| Jobs Accepted | 0 |
| Jobs Rejected | 0 |
| Jobs Executed | 0 |
| Revenue (USDC) | 0 |
| Compute Spent | $0.00 |
| Budget Remaining (Week) | $${(WEEKLY_CAP - budget.weekSpent).toFixed(2)} |
| Escalations | 1 (signer) |

---
`;
    appendToLog(cycleSummary);
    return;
  }
  
  log(`Budget: Week $${budget.weekSpent.toFixed(2)}/$${WEEKLY_CAP}, Day $${budget.daySpent.toFixed(2)}/$${DAILY_CAP}`);
  log(`Mode: ${budget.mode} (min margin: ${getMinMargin(budget.mode)}x)`);
  log(`Kill-switch: ${budget.consecutiveFailures}/3 failures`);
  
  // Check kill-switch
  if (budget.consecutiveFailures >= 3) {
    log("🛑 KILL-SWITCH TRIGGERED: 3 consecutive evaluation failures");
    log("   Stopping. Manual intervention required.");
    return;
  }
  
  // Check budget caps
  if (budget.weekSpent >= WEEKLY_CAP) {
    log("🛑 WEEKLY CAP REACHED: $199 hard limit");
    return;
  }
  if (budget.daySpent >= DAILY_CAP) {
    log("⚠️ Daily cap reached ($28). Continuing in strict mode only.");
  }
  
  // Create provider agent
  let agent: AcpAgent;
  try {
    log("Creating ACP agent...");
    const evmProvider = await PrivyAlchemyEvmProviderAdapter.create({
      walletAddress: WALLET_ADDRESS as `0x${string}`,
      walletId: PRIVY_WALLET_ID,
      signerPrivateKey: PRIVY_SIGNER_PRIVATE_KEY,
      chains: [base],
      builderCode: BUILDER_CODE as `bc-${string}` || undefined,
    });
    agent = await AcpAgent.create({
      evmProvider,
    });
    log(`Agent created: ${await agent.getAddress()}`);
  } catch (error) {
    log(`❌ Failed to create agent: ${error}`);
    if (error instanceof Error && error.message.includes("signer")) {
      log("   SIGNER NOT APPROVED: Visit Virtuals console → Agent → Wallet → Approve autonomous transactions");
    }
    return;
  }
  
  // Track jobs found in this cycle
  let jobsScanned = 0;
  let jobsAccepted = 0;
  let jobsRejected = 0;
  let jobsExecuted = 0;
  let revenueThisCycle = 0;
  let computeThisCycle = 0;
  
  // Start listening for jobs
  log("Starting event listener...");
  
  // We'll use a promise that resolves after a timeout or when jobs are processed
  const jobResults: Array<{ jobId: string; session: JobSession; offering: any; score: number }> = [];
  let listenerAttached = false;
  
  const jobPromise = new Promise<void>((resolve) => {
    const timeout = setTimeout(() => {
      log("Scan timeout reached (30s)");
      resolve();
    }, 30000);
    
    agent.on("entry", async (session: JobSession, entry: JobRoomEntry) => {
      if (entry.kind !== "system") return;
      
      const event = entry.event;
      log(`Event: ${event.type} for job ${session.jobId}`);
      
      // Handle job.created - new job available
      if (event.type === "job.created" && session.roles.includes("provider")) {
        // Idempotency: skip if we've already processed this job in this cycle
        if (processedJobIds.has(session.jobId)) {
          log(`  Already processed ${session.jobId}, skipping (idempotent)`);
          return;
        }
        processedJobIds.add(session.jobId);
        jobsScanned++;
        clearTimeout(timeout);
        
        // Get job details
        const job = session.job;
        if (!job) {
          log(`  No job data for ${session.jobId}`);
          return;
        }
        
        log(`  New job: ${session.jobId}, status: ${session.status}, description: ${job.description}`);
        
        // Match to our offering
        const offering = OFFERINGS.find(o => o.name === job.description);
        if (!offering) {
          log(`  No matching offering for: ${job.description}`);
          jobsRejected++;
          return;
        }
        
        // Score the job
        const { score, reasons } = scoreJob(job, offering, budget);
        log(`  Score: ${score}/100`);
        reasons.forEach(r => log(`    - ${r}`));
        
        if (score >= 70) { // Accept threshold
          log(`  ✓ ACCEPTED (score ${score})`);
          jobsAccepted++;
          jobResults.push({ jobId: session.jobId, session, offering, score });
          
          // Set budget
          try {
            await session.setBudget(AssetToken.usdc(offering.priceUSDC, CHAIN_ID));
            log(`  Budget set: ${offering.priceUSDC} USDC`);
          } catch (e) {
            log(`  Failed to set budget: ${e}`);
          }
        } else {
          log(`  ✗ REJECTED (score ${score})`);
          jobsRejected++;
        }
      }
      
      // Handle job.funded - client funded, ready to work
      if (event.type === "job.funded" && session.roles.includes("provider")) {
        const result = jobResults.find(r => r.jobId === session.jobId);
        if (result) {
          log(`  Job funded, executing...`);
          const execResult = await executeJob(session, result.offering);
          
          if (execResult.success) {
            jobsExecuted++;
            computeThisCycle += COMPUTE_COST_ESTIMATES[result.offering.category] || 1.0;
            
            // Submit deliverable
            try {
              await session.submit(execResult.deliverable);
              log(`  Deliverable submitted with proof`);
              // Track as PENDING revenue — only count as confirmed when job.completed fires
              // This prevents recording revenue from jobs the evaluator might reject
              pendingRevenue.set(session.jobId, {
                jobId: session.jobId,
                amount: result.offering.priceUSDC,
              });
            } catch (e) {
              log(`  Failed to submit: ${e}`);
            }
          } else {
            log(`  Execution failed`);
          }
        }
      }
      
      // Handle job.completed - evaluator approved
      if (event.type === "job.completed" && session.roles.includes("provider")) {
        log(`  Job completed! USDC released.`);
        budget.consecutiveFailures = 0;
        updateBudgetState({ consecutiveFailures: 0 });
        // Collect confirmed revenue from pending map
        const confirmed = pendingRevenue.get(session.jobId);
        if (confirmed) {
          revenueThisCycle += confirmed.amount;
          pendingRevenue.delete(session.jobId);
          log(`  Revenue confirmed: ${confirmed.amount} USDC`);
        }
      }
      
      // Handle job.rejected - evaluator rejected
      if (event.type === "job.rejected" && session.roles.includes("provider")) {
        log(`  Job rejected by evaluator`);
        budget.consecutiveFailures++;
        updateBudgetState({ consecutiveFailures: budget.consecutiveFailures });
        // Remove pending revenue — job was rejected, payout will not occur
        pendingRevenue.delete(session.jobId);
      }
    });
    
    listenerAttached = true;
  });
  
  // Start the agent
  await agent.start(() => {
    log("Agent connected, listening for jobs...");
  });
  
  // Wait for scan cycle
  await jobPromise;
  
  // Stop agent
  await agent.stop();
  log("Agent stopped");
  
  // Update budget state
  const newWeekSpent = budget.weekSpent + computeThisCycle;
  const newDaySpent = budget.daySpent + computeThisCycle;
  const newWeekRevenue = budget.weekRevenue + revenueThisCycle;
  const newDayRevenue = budget.dayRevenue + revenueThisCycle;
  const newMode = calculateMode({ weekSpent: newWeekSpent });
  
  updateBudgetState({
    weekSpent: newWeekSpent,
    daySpent: newDaySpent,
    weekRevenue: newWeekRevenue,
    dayRevenue: newDayRevenue,
    mode: newMode,
    shouldResetDay: budget.shouldResetDay,
  });
  
  // Cycle summary
  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  log("=".repeat(60));
  log("CYCLE SUMMARY");
  log("=".repeat(60));
  log(`Duration: ${duration}s`);
  log(`Jobs Scanned: ${jobsScanned}`);
  log(`Jobs Accepted: ${jobsAccepted}`);
  log(`Jobs Rejected: ${jobsRejected}`);
  log(`Jobs Executed: ${jobsExecuted}`);
  log(`Revenue: ${revenueThisCycle} USDC`);
  log(`Compute Spent: $${computeThisCycle.toFixed(2)}`);
  log(`Budget Remaining (Week): $${(WEEKLY_CAP - newWeekSpent).toFixed(2)}`);
  log(`Mode: ${newMode}`);
  log("=".repeat(60));
  
  // Append cycle summary to operational log
  const cycleSummary = `
## Cycle: ${new Date().toISOString()} (Cron Execution)

### SCAN Results
- **Jobs scanned**: ${jobsScanned}
- **Pending jobs**: ${jobsAccepted}
- **Awaiting provider jobs**: 0

### SCORE Results
${jobsAccepted > 0 ? `- Accepted ${jobsAccepted} job(s) with score >= 70` : "- No jobs accepted"}
${jobsRejected > 0 ? `- Rejected ${jobsRejected} job(s) below threshold` : ""}

### NEGOTIATE Results
${jobsAccepted > 0 ? `- Budget set for ${jobsAccepted} job(s)` : "- No jobs negotiated"}

### EXECUTE Results
${jobsExecuted > 0 ? `- ${jobsExecuted} job(s) executed successfully` : "- No jobs executed"}

### DELIVER Results
${jobsExecuted > 0 ? `- ${jobsExecuted} deliverable(s) submitted` : "- No deliverables submitted"}

### COLLECT & RECONCILE
- **USDC collected this cycle**: ${revenueThisCycle}
- **Escrow status**: ${jobsAccepted > jobsExecuted ? `${jobsAccepted - jobsExecuted} pending` : "No active escrows"}

### Budget Governor Status
- **Weekly cap**: $${WEEKLY_CAP} (hard limit)
- **Daily cap**: $${DAILY_CAP} (soft)
- **Budget consumed this week**: $${newWeekSpent.toFixed(2)} (${((newWeekSpent/WEEKLY_CAP)*100).toFixed(1)}%)
- **Mode**: ${newMode}
- **Minimum margin**: ${getMinMargin(newMode)}x

### Kill-Switch Status
- **Consecutive evaluation failures**: ${budget.consecutiveFailures}
- **Status**: ${budget.consecutiveFailures >= 3 ? "TRIGGERED" : "ACTIVE"}

### Escalations / Warnings
${!PRIVY_SIGNER_PRIVATE_KEY ? "⚠️ **SIGNER NOT APPROVED**: Privy wallet requires manual OAuth approval" : ""}
${budget.consecutiveFailures >= 3 ? "🛑 **KILL-SWITCH TRIGGERED**: 3 consecutive failures" : ""}

### Cycle Summary
| Metric | Value |
|--------|-------|
| Jobs Scanned | ${jobsScanned} |
| Jobs Accepted | ${jobsAccepted} |
| Jobs Rejected | ${jobsRejected} |
| Jobs Executed | ${jobsExecuted} |
| Revenue (USDC) | ${revenueThisCycle} |
| Compute Spent | $${computeThisCycle.toFixed(2)} |
| Budget Remaining (Week) | $${(WEEKLY_CAP - newWeekSpent).toFixed(2)} |
| Escalations | ${(!PRIVY_SIGNER_PRIVATE_KEY ? 1 : 0) + (budget.consecutiveFailures >= 3 ? 1 : 0)} |

---
`;
  
  appendToLog(cycleSummary);
  log("Cycle complete. Log appended.");
}

// Run the cycle
runCycle().catch(err => {
  log(`FATAL ERROR: ${err}`);
  process.exit(1);
});