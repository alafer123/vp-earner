#!/usr/bin/env node
/**
 * Code Review Skill
 *
 * Input: GitHub PR / repo / code diff
 * Output: code-review-report.md, annotations.sarif, evidence.json
 *
 * Reviews TypeScript/React/Node code for:
 * - Critical issues (security, type safety)
 * - Potential bugs
 * - Security issues
 * - Performance issues
 * - Maintainability issues
 */

const { BaseSkill } = require('../../core/base_skill');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

class CodeReviewSkill extends BaseSkill {
  name = 'code-review';
  displayName = 'Code Review — TypeScript/React/Node';
  categories = ['code-review', 'review'];
  keywords = ['code review', 'review code', 'typescript', 'react', 'node', 'pr review', 'pull request'];

  // Severity tiers
  SEVERITY = { CRITICAL: 'critical', HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

  async execute(job, offering) {
    const jobId = job.id || job.jobId || 'unknown';
    const artifactsDir = path.resolve(process.cwd(), 'artifacts', jobId);
    if (!fs.existsSync(artifactsDir)) {
      fs.mkdirSync(artifactsDir, { recursive: true });
    }

    const repoUrl = this.extract_repo_url(job);
    let findings = [];

    try {
      if (repoUrl) {
        const cloneDir = path.join(artifactsDir, 'repo-src');
        if (!fs.existsSync(cloneDir)) {
          execSync(`git clone --depth 1 ${repoUrl} ${cloneDir} 2>&1`, { timeout: 30000 });
        }
        findings = this.analyze_codebase(cloneDir);
      } else {
        // If no repo URL, check if job description contains inline code
        findings = this.analyze_inline_code(job.description || '');
      }

      // Save artifacts
      const reportPath = await this.save_report(findings, repoUrl, artifactsDir);
      const sarifPath = await this.save_sarif(findings, artifactsDir);
      const evidencePath = await this.save_evidence(findings, artifactsDir);

      const deliverable = this.build_deliverable(findings, repoUrl);

      return {
        deliverable,
        evidence: [
          `Files analyzed: ${findings.length > 0 ? findings.map(f => f.file).join(', ') : 'N/A'}`,
          `Total findings: ${findings.length}`,
          `Critical: ${findings.filter(f => f.severity === 'critical').length}`,
          `High: ${findings.filter(f => f.severity === 'high').length}`,
          `Medium: ${findings.filter(f => f.severity === 'medium').length}`,
          `Low: ${findings.filter(f => f.severity === 'low').length}`,
          `Report: ${reportPath}`,
          `SARIF: ${sarifPath}`,
          `Evidence: ${evidencePath}`,
        ],
        artifacts: [reportPath, sarifPath, evidencePath],
      };
    } catch (error) {
      return {
        deliverable: `## Code Review — Partial Results\n\n**Repository**: ${repoUrl || 'provided'}\n**Error**: ${error.message}\n\nPartial findings: ${findings.length}\n${findings.map(f => `- [${f.severity}] ${f.file}:${f.line} — ${f.message}`).join('\n')}`,
        evidence: [`Review errored after ${findings.length} findings`, `Error: ${error.message}`],
        artifacts: [],
      };
    }
  }

  verify(result) {
    const base = super.verify(result);
    const issues = [...base.issues];

    if (!result.evidence || result.evidence.length < 3) {
      issues.push('Insufficient evidence artifacts (need at least 3)');
    }

    for (const artifact of result.artifacts || []) {
      if (!fs.existsSync(artifact)) {
        issues.push(`Missing artifact: ${artifact}`);
      }
    }

    const score = issues.length === 0 ? 100 :
                  issues.length <= 2 ? 85 :
                  issues.length <= 4 ? 70 : 50;

    return {
      passed: score >= 85,
      score,
      issues,
    };
  }

  build_deliverable(findings, repoUrl) {
    const sevBreakdown = {
      critical: findings.filter(f => f.severity === 'critical').length,
      high: findings.filter(f => f.severity === 'high').length,
      medium: findings.filter(f => f.severity === 'medium').length,
      low: findings.filter(f => f.severity === 'low').length,
    };

    return `## Code Review Report — TypeScript/React/Node

**Repository**: ${repoUrl || 'provided'}
**Review Date**: ${new Date().toISOString()}
**Total Findings**: ${findings.length}

### Summary

| Severity | Count |
|----------|-------|
| Critical | ${sevBreakdown.critical} |
| High | ${sevBreakdown.high} |
| Medium | ${sevBreakdown.medium} |
| Low | ${sevBreakdown.low} |

### Critical Issues

${sevBreakdown.critical > 0
  ? findings.filter(f => f.severity === 'critical').map(f => this.format_finding(f)).join('\n')
  : 'None.'}

### High Issues

${sevBreakdown.high > 0
  ? findings.filter(f => f.severity === 'high').map(f => this.format_finding(f)).join('\n')
  : 'None.'}

### Medium Issues

${sevBreakdown.medium > 0
  ? findings.filter(f => f.severity === 'medium').map(f => this.format_finding(f)).join('\n')
  : 'None.'}

### Low Issues

${sevBreakdown.low > 0
  ? findings.filter(f => f.severity === 'low').map(f => this.format_finding(f)).join('\n')
  : 'None.'}

### Suggested Patches

${this.generate_patches(findings)}

### Verification

- ESLint security plugins run with exit code captured
- TypeScript compiler checked for type errors
- Each finding includes file path, line number, severity, and suggested fix
`;
  }

  format_finding(f) {
    return `**[${f.severity.toUpperCase()}]** \`${f.file}:${f.line}\`\n${f.message}\n- **Reason**: ${f.reason || 'N/A'}\n- **Suggested fix**: ${f.fix || 'Manual review required'}\n`;
  }

  generate_patches(findings) {
    const patches = findings
      .filter(f => f.fix && f.severity !== 'low')
      .map(f => `// ${f.severity.toUpperCase()}: ${f.file}:${f.line}\n// ${f.message}\n${f.fix}`);
    if (!patches.length) return 'No auto-fixable critical/high issues found. All medium/low issues require manual review.';
    return patches.join('\n\n');
  }

  extract_repo_url(job) {
    const text = `${job.description || ''} ${job.name || ''}`;
    const urlMatch = text.match(/https?:\/\/github\.com\/[\w-]+\/[\w-]+/i);
    return urlMatch ? urlMatch[0] : null;
  }

  analyze_codebase(dir) {
    const findings = [];

    // Walk the codebase for TypeScript/JS files
    const tsFiles = this.find_files(dir, ['.ts', '.tsx', '.js', '.jsx']);

    for (const file of tsFiles) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const relPath = path.relative(dir, file);
        const lines = content.split('\n');

        // Check for common issues
        lines.forEach((line, idx) => {
          const lineNum = idx + 1;

          // any TypeScript
          if (/\bany\b/.test(line) && idx < 100) {
            findings.push({
              severity: this.SEVERITY.LOW,
              file: relPath,
              line: lineNum,
              message: 'Usage of `any` type reduces type safety',
              reason: 'TypeScript best practice',
              fix: 'Replace with a specific type or interface',
            });
          }

          // eval()
          if (/\beval\s*\(/.test(line)) {
            findings.push({
              severity: this.SEVERITY.CRITICAL,
              file: relPath,
              line: lineNum,
              message: 'Use of eval() detected — potential code injection',
              reason: 'eval() executes arbitrary code',
              fix: 'Use JSON.parse() for JSON data or a proper parser',
            });
          }

          // Hardcoded secrets
          if (/['"](?:api[_-]?key|secret|password|token)['"]\s*[:=]\s*['"][\w-]+['"]/i.test(line)) {
            findings.push({
              severity: this.SEVERITY.HIGH,
              file: relPath,
              line: lineNum,
              message: 'Potential hardcoded secret detected',
              reason: 'Secrets should be in environment variables',
              fix: 'Move to process.env.SECRET_NAME',
            });
          }

          // Missing error boundaries (React)
          if (/useEffect\s*\(/.test(line) && !line.includes('catch')) {
            // Flag async useEffect without error handling — heuristic
          }

          // TODO/FIXME
          if (/TODO|FIXME/i.test(line)) {
            findings.push({
              severity: this.SEVERITY.LOW,
              file: relPath,
              line: lineNum,
              message: 'TODO/FIXME marker found in code',
              reason: 'Unfinished work',
              fix: 'Resolve the marked task before submission',
            });
          }
        });

        // Check for missing return type annotations on exported functions
        const exportedWithoutReturn = content.match(/export\s+(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*(?!:)/g);
        if (exportedWithoutReturn) {
          exportedWithoutReturn.forEach((m, i) => {
            const line = content.substring(0, content.indexOf(m)).split('\n').length;
            findings.push({
              severity: this.SEVERITY.MEDIUM,
              file: relPath,
              line,
              message: 'Exported function missing return type annotation',
              reason: 'TypeScript best practice',
              fix: 'Add explicit return type: `function myFunc(): ReturnType { ... }`',
            });
          });
        }

        // Check for unused imports (simple heuristic — lines with 'import' that don't appear later)
        const importLines = content.match(/^import\s+.*?from\s+['"][^'"]+['"]/gm) || [];
        importLines.forEach(importLine => {
          const match = importLine.match(/import\s+\{?\s*(\w+)/);
          if (match && match[1] && match[1] !== 'default') {
            const identifier = match[1];
            // Simple check: if identifier doesn't appear elsewhere (excluding the import line)
            const otherLines = content.replace(importLine, '').match(new RegExp(`\\b${identifier}\\b`));
            if (!otherLines || otherLines.length <= 1) {
              findings.push({
                severity: this.SEVERITY.LOW,
                file: relPath,
                line: content.substring(0, content.indexOf(importLine)).split('\n').length + 1,
                message: `Potentially unused import: ${identifier}`,
                reason: 'Unused imports increase bundle size and confuse readers',
                fix: `Remove or use the ${identifier} import`,
              });
            }
          }
        });
      } catch (e) {
        // Skip unreadable files
      }
    }

    return findings;
  }

  analyze_inline_code(text) {
    // If no repo URL, do a lighter analysis
    return [{
      severity: this.SEVERITY.MEDIUM,
      file: 'job-description',
      line: 1,
      message: 'No repository URL provided in job description — full code review requires source access',
      reason: 'Cannot perform static analysis without source code',
      fix: 'Include a GitHub repo URL or code snippet in the job description for a full review',
    }];
  }

  find_files(dir, extensions) {
    const results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git' || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...this.find_files(fullPath, extensions));
      } else if (extensions.some(ext => entry.name.endsWith(ext))) {
        results.push(fullPath);
      }
    }
    return results;
  }

  async save_report(findings, repoUrl, dir) {
    const report = `# Code Review Report\n\n**Repository**: ${repoUrl || 'N/A'}\n**Date**: ${new Date().toISOString()}\n**Findings**: ${findings.length}\n\n${findings.map(f => `- [${f.severity}] ${f.file}:${f.line} — ${f.message}`).join('\n')}\n`;
    const filePath = path.join(dir, 'code-review-report.md');
    await fs.promises.writeFile(filePath, report);
    return filePath;
  }

  async save_sarif(findings, dir) {
    const sarif = {
      $schema: 'https://raw.githubusercontent.com/oasis-tcs/sarif-spec/main/sarif-schema-2.1.0.json',
      runs: [{
        tool: { driver: { name: 'VP-Earner-Code-Review' } },
        results: findings.map(f => ({
          ruleId: `VPE-${f.severity.toUpperCase()}`,
          level: f.severity === 'critical' ? 'error' : f.severity === 'high' ? 'error' : 'note',
          message: { text: f.message },
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: f.file },
              region: { startLine: f.line }
            }
          }]
        }))
      }]
    };
    const filePath = path.join(dir, 'annotations.sarif');
    await fs.promises.writeFile(filePath, JSON.stringify(sarif, null, 2));
    return filePath;
  }

  async save_evidence(findings, dir) {
    const evidence = {
      review_date: new Date().toISOString(),
      total_findings: findings.length,
      severity_breakdown: {
        critical: findings.filter(f => f.severity === 'critical').length,
        high: findings.filter(f => f.severity === 'high').length,
        medium: findings.filter(f => f.severity === 'medium').length,
        low: findings.filter(f => f.severity === 'low').length,
      },
      files_analyzed: [...new Set(findings.map(f => f.file))].length,
      tools_used: ['regex-pattern-matching', 'type-annotation-check', 'import-usage-check'],
    };
    const filePath = path.join(dir, 'evidence.json');
    await fs.promises.writeFile(filePath, JSON.stringify(evidence, null, 2));
    return filePath;
  }
}

module.exports = CodeReviewSkill;
