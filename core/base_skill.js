#!/usr/bin/env node
/**
 * Base Skill interface for VP Earner.
 *
 * Every skill must implement:
 *   can_handle(job)      → boolean  (does this skill match the job?)
 *   estimate_cost(job)   → number   (estimated USD compute cost)
 *   execute(job)         → Promise<{ deliverable: string, evidence: string[], artifacts: string[] }>
 *   verify(result)       → Promise<{ passed: boolean, score: number, issues: string[] }>
 *   package_deliverable(result) → string (the text submitted to ACP)
 */

const path = require('path');
const fs = require('fs');

class BaseSkill {
  /** @type {string} Unique skill identifier, e.g. "dependency-security-audit" */
  name;

  /** @type {string} Human-readable skill name */
  displayName;

  /** @type {string[]} Categories/offering names this skill can handle */
  categories = [];

  /** @type {string[]} Keywords from the job description that trigger this skill */
  keywords = [];

  /**
   * Determine if this skill can handle the given job.
   * @param {object} job - ACP job object { id, description, name, slaMinutes, ... }
   * @returns {boolean}
   */
  can_handle(job) {
    const desc = (job.description || job.name || '').toLowerCase();
    return this.keywords.some(kw => desc.includes(kw.toLowerCase())) ||
           this.categories.includes(job.category);
  }

  /**
   * Estimate the compute cost in USD for this skill.
   * @param {object} job
   * @returns {number}
   */
  estimate_cost(job) {
    // Default: $0.50 base + $0.01 per estimated minute of SLA
    const slaHours = (job.slaMinutes || 360) / 60;
    return 0.50 + Math.min(slaHours * 0.10, 5.0); // cap estimation at $5
  }

  /**
   * Execute the skill. Must be overridden by subclasses.
   * @param {object} job - ACP JobSession object with .job, .submit(), etc.
   * @param {object} offering - The matched offering config
   * @returns {Promise<{deliverable: string, evidence: string[], artifacts: string[]}>}
   */
  async execute(job, offering) {
    throw new Error(`Skill "${this.name}" does not implement execute()`);
  }

  /**
   * Verify the execution result before submission.
   * Override to provide skill-specific verification.
   * @param {{deliverable: string, evidence: string[], artifacts: string[]}} result
   * @returns {Promise<{passed: boolean, score: number, issues: string[]}>}
   */
  async verify(result) {
    const issues = [];

    // Check 1: Deliverable is non-empty
    if (!result.deliverable || result.deliverable.length < 20) {
      issues.push('Deliverable is empty or too short');
    }

    // Check 2: Has at least one evidence artifact
    if (!result.evidence || result.evidence.length === 0) {
      issues.push('No evidence artifacts provided');
    }

    // Check 3: No obvious placeholders
    const placeholderPatterns = /TODO|FIXME|placeholder|example\.com|insert here|Lorem ipsum/gi;
    if (placeholderPatterns.test(result.deliverable)) {
      issues.push('Deliverable contains placeholder text');
    }

    // Check 4: Banned/fabricated phrases
    const banned = [
      'I cannot browse', 'As an AI', 'as an AI', 'I don\'t have access',
      'unfortunately, I cannot', 'In today\'s digital age',
      'In today\'s fast-paced', 'in today\'s fast-paced'
    ];
    const lower = result.deliverable.toLowerCase();
    for (const phrase of banned) {
      if (lower.includes(phrase.toLowerCase())) {
        issues.push(`AI-slop phrase detected: "${phrase}"`);
      }
    }

    const score = issues.length === 0 ? 100 :
                  issues.length === 1 ? 75 :
                  issues.length === 2 ? 50 : 25;

    return {
      passed: score >= 50,
      score,
      issues,
    };
  }

  /**
   * Package the final deliverable text for ACP submission.
   * @param {{deliverable: string, evidence: string[], artifacts: string[]}} result
   * @returns {string}
   */
  package_deliverable(result) {
    // Build the proof string with artifacts referenced
    const artifactList = (result.artifacts || [])
      .map(a => `- ${a}`)
      .join('\n');

    return `${result.deliverable}\n\n**Evidence & Artifacts:**\n${artifactList}`;
  }

  /** Helper: save an artifact to the artifacts directory */
  async save_artifact(content, filename) {
    const artifactsDir = path.resolve(process.cwd(), 'artifacts');
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }
    const filePath = path.join(artifactsDir, filename);
    await fs.promises.writeFile(filePath, content, 'utf-8');
    return filePath;
  }
}

module.exports = { BaseSkill };
