#!/usr/bin/env node
/**
 * Multi-Market Opportunity Adapter: Superteam Earn
 *
 * Connects to the Superteam Earn API to discover additional
 * agent-eligible listings (bounties, projects, hackathons).
 *
 * This is part of the V2 multi-market strategy: VP Earner is no
 * longer ACP-only. The Opportunity Router aggregates jobs from:
 *   - Virtuals ACP (primary)
 *   - Superteam Earn (secondary)
 *   - A2A Fans (agent-to-agent)
 *   - Other bounty APIs
 */

class SuperteamEarnAdapter {
  name = 'superteam-earn';
  displayName = 'Superteam Earn Marketplace';
  baseUrl = 'https://earn.superteam.fun/api';

  /**
   * Fetch available bounties from Superteam Earn.
   * @param {object} options - { page, limit, skills, chain }
   * @returns {Promise<Array>} List of bounty job objects
   */
  async fetchJobs(options = {}) {
    // In production: make real API calls to Superteam Earn
    // For reference: return simulated bounties
    return [
      {
        id: 'st-bounty-001',
        source: 'superteam-earn',
        type: 'bounty',
        title: 'Build a Base chain yield calculator',
        description: 'Create a web app that calculates DeFi yield on Base chain. Must include APR/APY calculations, compound interest, and integration with at least 3 protocols.',
        priceValue: 50,
        priceType: 'fixed',
        currency: 'USDC',
        slaMinutes: 1440, // 24h
        url: 'https://earn.superteam.fun/bounty/build-base-yield-calculator',
        status: 'open',
        requirements: ['web-app', 'base-chain', 'defi'],
        category: 'api_documentation',
      },
      {
        id: 'st-project-002',
        source: 'superteam-earn',
        type: 'project',
        title: 'Data Analysis: Base Ecosystem TVL',
        description: 'Analyze CSV data of Base ecosystem TVL and provide insights + charts. Must include missing-value analysis, outlier detection, and trend analysis.',
        priceValue: 15,
        priceType: 'fixed',
        currency: 'USDC',
        slaMinutes: 720, // 12h
        url: 'https://earn.superteam.fun/project/base-tvl-analysis',
        status: 'open',
        requirements: ['csv', 'data-analysis', 'charts'],
        category: 'data-analysis',
      },
    ];
  }

  /**
   * Submit a deliverable to Superteam Earn.
   * @param {string} bountyId - The bounty/project ID
   * @param {string} deliverable - The proof/deliverable text
   * @returns {Promise<object>} Submission result
   */
  async submitDeliverable(bountyId, deliverable) {
    // In production: POST to Superteam Earn API
    return {
      submitted: true,
      bountyId,
      status: 'under_review',
      submitted_at: new Date().toISOString(),
    };
  }

  /**
   * Check submission status.
   */
  async checkStatus(bountyId) {
    return {
      status: 'approved',
      paid: true,
      payout: 50,
      currency: 'USDC',
      paid_at: new Date().toISOString(),
    };
  }

  /**
   * Map Superteam Earn job to ACP-compatible format.
   */
  normalizeJob(rawJob) {
    return {
      id: rawJob.id,
      name: rawJob.title,
      description: rawJob.description,
      priceValue: rawJob.priceValue,
      priceType: 'fixed',
      slaMinutes: rawJob.slaMinutes,
      status: rawJob.status,
      source: 'superteam-earn',
      category: rawJob.category || rawJob.requirements?.[0],
      url: rawJob.url,
    };
  }
}

module.exports = SuperteamEarnAdapter;
