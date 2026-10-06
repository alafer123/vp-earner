#!/usr/bin/env node
/**
 * Subscription Offerings
 *
 * ACP now supports subscriptions (recurring) as well as one-time offerings,
 * plus discoverable resources/endpoints. This module defines subscription
 * offerings that turn VP Earner into agent-as-a-service.
 *
 * Instead of: "One report — Market Intelligence — $5"
 * Offer:     "30-Day Crypto Intelligence Subscription — $25/month"
 */

// Subscription offerings (recurring revenue model)
const SUBSCRIPTION_OFFERINGS = [
  {
    id: "crypto-intel-subscription",
    name: "30-Day Crypto Intelligence Subscription",
    type: "subscription",
    priceUSDC: 25,
    billingCycle: "monthly",
    description: "Daily market briefs, token research, protocol comparison, and risk reports",
    features: [
      "Daily DeFi TVL briefs",
      "Token research reports (2/week)",
      "Protocol security updates",
      "Risk assessment scores",
      "Telegram/Discord delivery"
    ],
    slaHours: 24,
    category: "market-intel",
    autoRenew: true,
    gracePeriodDays: 3,
  },
  {
    id: "security-monitor-subscription",
    name: "Dependency Security Monitoring (Monthly)",
    type: "subscription",
    priceUSDC: 15,
    billingCycle: "monthly",
    description: "Weekly dependency vulnerability scans with automated alerts",
    features: [
      "Weekly npm/pip audit scans",
      "Vulnerability alerts (critical/high)",
      "SBOM generation",
      "Remediation recommendations",
      "SARIF report delivery"
    ],
    slaHours: 48,
    category: "dependency-security-audit",
    autoRenew: true,
    gracePeriodDays: 3,
  },
];

// Discoverable resources (agent-as-a-service endpoints)
const DISCOVERABLE_RESOURCES = [
  {
    id: "get_token_risk_score",
    name: "Token Risk Score",
    type: "resource",
    description: "Evaluate token security, distribution, and risk metrics",
    inputSchema: {
      tokenAddress: { type: "string", required: true },
      chain: { type: "string", enum: ["base", "ethereum"], default: "base" },
    },
    estimatedCost: 0.05,
  },
  {
    id: "check_dependency_vulnerability",
    name: "Dependency Vulnerability Check",
    type: "resource",
    description: "Check if package dependencies have known vulnerabilities",
    inputSchema: {
      packageJson: { type: "string", required: true },
    },
    estimatedCost: 0.10,
  },
  {
    id: "analyze_repository",
    name: "Repository Analysis",
    type: "resource",
    description: "Full code quality + security analysis of a GitHub repo",
    inputSchema: {
      repoUrl: { type: "string", required: true },
      depth: { type: "string", enum: ["quick", "full"], default: "quick" },
    },
    estimatedCost: 0.50,
  },
  {
    id: "market_sentiment_snapshot",
    name: "Market Sentiment Snapshot",
    type: "resource",
    description: "Get AI agent market sentiment and narrative analysis",
    inputSchema: {
      query: { type: "string", required: true },
      sources: { type: "array", items: { type: "string" }, default: ["coingecko", "defillama", "messari"] },
    },
    estimatedCost: 0.15,
  },
];

/**
 * Check if a job is for a subscription renewal.
 */
function isSubscriptionJob(job) {
  return job.offerType === "subscription" || job.metadata?.offerType === "subscription";
}

/**
 * Check if a job is for a discoverable resource call.
 */
function isResourceJob(job) {
  return job.offerType === "resource" || job.metadata?.offerType === "resource";
}

/**
 * Calculate LTV (lifetime value) of a subscription.
 * Used in scoring to prioritize recurring revenue over one-off jobs.
 */
function subscriptionLTV(sub) {
  const monthly = sub.priceUSDC;
  const retentionRate = 0.8; // assume 80% monthly retention
  // LTV = monthly_price / (1 - retention_rate) for churn-based model
  // Simplified: LTV = monthly_price * expected_months
  const expectedMonths = sub.autoRenew ? 1 / (1 - retentionRate) : 1;
  return monthly * expectedMonths;
}

module.exports = {
  SUBSCRIPTION_OFFERINGS,
  DISCOVERABLE_RESOURCES,
  isSubscriptionJob,
  isResourceJob,
  subscriptionLTV,
};
