#!/usr/bin/env node
/**
 * Skill Router — maps incoming ACP jobs to the right skill.
 *
 * Usage:
 *   const router = new SkillRouter();
 *   const skill = router.route(job);
 *   if (skill) {
 *     const result = await skill.execute(job, offering);
 *     const verification = await skill.verify(result);
 *   }
 */

const fs = require('fs');
const path = require('path');

class SkillRouter {
  constructor() {
    this.skills = new Map();
    this.load_skills();
  }

  load_skills() {
    const skillsDir = path.resolve(__dirname, '../skills');
    if (!fs.existsSync(skillsDir)) return;

    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const skillPath = path.join(skillsDir, entry.name, 'skill.js');
        if (fs.existsSync(skillPath)) {
          try {
            const SkillClass = require(skillPath);
            const skill = new SkillClass();
            this.skills.set(skill.name, skill);
          } catch (e) {
            console.error(`Failed to load skill ${entry.name}:`, e.message);
          }
        }
      }
    }
  }

  /**
   * Find the best matching skill for a job.
   * @param {object} job - ACP job with { description, name, ... }
   * @returns {BaseSkill|null}
   */
  route(job) {
    const desc = (job.description || job.name || '').toLowerCase();

    // Exact match first
    for (const [_, skill] of this.skills) {
      if (skill.can_handle(job)) {
        return skill;
      }
    }

    // Keyword fuzzy match as fallback
    let bestMatch = null;
    let bestScore = 0;

    for (const [_, skill] of this.skills) {
      let score = 0;
      for (const kw of skill.keywords) {
        if (desc.includes(kw.toLowerCase())) {
          score += 1;
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = skill;
      }
    }

    return bestScore > 0 ? bestMatch : null;
  }

  list_skills() {
    return Array.from(this.skills.values()).map(s => ({
      name: s.name,
      displayName: s.displayName,
      categories: s.categories,
      keywords: s.keywords,
    }));
  }
}

module.exports = { SkillRouter };
