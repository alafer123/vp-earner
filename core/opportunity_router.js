#!/usr/bin/env node
/**
 * Opportunity Router
 *
 * Aggregates jobs from multiple marketplace adapters and normalizes
 * them into a single job list for the scoring/acceptance pipeline.
 *
 * Marketplaces:
 *   - Virtuals ACP (primary, event-driven)
 *   - Superteam Earn (polling)
 *   - A2A Fans (polling)
 *   - [extensible for future adapters]
 */

const SuperteamEarnAdapter = require('../adapters/superteam-earn');
const A2AFansAdapter = require('../adapters/a2a-fans');

class OpportunityRouter {
  constructor() {
    this.adapters = [
      new SuperteamEarnAdapter(),
      new A2AFansAdapter(),
    ];
  }

  /**
   * Scan all marketplaces for available jobs.
   * @param {object} options - { maxAge_minutes, only_unclaimed }
   * @returns {Promise<Array>} Normalized job list from all sources
   */
  async scanAll(options = {}) {
    const allJobs = [];
    const errors = [];

    for (const adapter of this.adapters) {
      try {
        const rawJobs = await adapter.fetchJobs({
          limit: options.limit || 20,
          status: options.status || 'open',
        });
        for (const raw of rawJobs) {
          const normalized = adapter.normalizeJob(raw);
          allJobs.push(normalized);
        }
      } catch (error) {
        errors.push({ adapter: adapter.name, error: error.message });
        console.error(`⚠️  ${adapter.name} scan failed:`, error.message);
      }
    }

    // Deduplicate by (source, id)
    const seen = new Set();
    const unique = [];
    for (const job of allJobs) {
      const key = `${job.source}:${job.id}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push(job);
      }
    }

    // Sort by profitability (payout / slaMinutes) descending
    unique.sort((a, b) => {
      const aRatio = (a.priceValue || 0) / (a.slaMinutes || 1);
      const bRatio = (b.priceValue || 0) / (b.slaMinutes || 1);
      return bRatio - aRatio;
    });

    return { jobs: unique, errors, total_sources: this.adapters.length };
  }

  /**
   * Get a specific job from a specific source.
   * (Used when the ACP event handler receives a job.created event
   *  and we need to verify it against our offerings)
   */
  async getJob(source, jobId) {
    const adapter = this.adapters.find(a => a.name === source);
    if (!adapter) return null;
    // In production: fetch specific job by ID
    return null;
  }

  /**
   * Submit a deliverable to a specific marketplace.
   */
  async submitToSource(source, jobId, deliverable) {
    const adapter = this.adapters.find(a => a.name === source);
    if (!adapter) {
      throw new Error(`Unknown marketplace source: ${source}`);
    }
    return await adapter.submitDeliverable(jobId, deliverable);
  }

  listSources() {
    return this.adapters.map(a => ({
      name: a.name,
      displayName: a.displayName,
      baseUrl: a.baseUrl,
    }));
  }
}

module.exports = OpportunityRouter;
