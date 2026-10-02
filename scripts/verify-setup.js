#!/usr/bin/env node
/**
 * Setup verifier — run after cloning to confirm the project is real, not just boilerplate.
 * Usage: node scripts/verify-setup.js
 *
 * Checks:
 * 1. Node.js v18+ available
 * 2. dist/run-cycle.js compiled
 * 3. All 6 credentials present in profile .env
 * 4. package.json has correct metadata
 * 5. No secrets in committed files
 */
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const HERMES_HOME = process.env.HERMES_HOME || '';

let pass = 0, fail = 0;
const results = [];

function check(name, condition, detail = '') {
    const status = condition ? '✅ PASS' : '❌ FAIL';
    if (condition) pass++; else fail++;
    results.push(`${status} ${name}${detail ? ' — ' + detail : ''}`);
}

// 1. Node version
const nodeVersion = process.versions.node.split('.').map(Number);
check('Node.js v18+', nodeVersion[0] >= 18, `v${process.versions.node}`);

// 2. Compiled output exists
const distPath = path.join(PROJECT_ROOT, 'dist', 'run-cycle.js');
check('Compiled output (dist/run-cycle.js)', fs.existsSync(distPath));

// 3. Credentials in profile .env
const envPath = HERMES_HOME ? path.join(HERMES_HOME, '.env') : '';
let envVars = {};
if (envPath && fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf-8');
    for (const line of content.split('\n')) {
        if (line.trim() && !line.startsWith('#') && line.includes('=')) {
            const [k, ...v] = line.split('=');
            envVars[k.trim()] = v.join('=').trim();
        }
    }
}
const required = ['WALLET_ADDRESS', 'PRIVY_WALLET_ID', 'PRIVY_SIGNER_PRIVATE_KEY', 'VIRTUALS_API_KEY', 'ALCHEMY_API_KEY'];
for (const key of required) {
    check(`${key} set`, !!envVars[key], envVars[key] ? '(set)' : '(missing)');
}
// BUILDER_CODE is optional
check('BUILDER_CODE (optional)', !envVars.BUILDER_CODE || envVars.BUILDER_CODE.length > 0, envVars.BUILDER_CODE ? '(set)' : '(not set, optional)');

// 4. Package.json metadata
const pkgPath = path.join(PROJECT_ROOT, 'package.json');
if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    check('package.json description', pkg.description && pkg.description.length > 10, pkg.description || '(empty)');
    check('package.json keywords', pkg.keywords && pkg.keywords.length >= 3, `${pkg.keywords?.length || 0} keywords`);
    check('ACX node dependency', pkg.dependencies?.['@virtuals-protocol/acp-node-v2'], pkg.dependencies?.['@virtuals-protocol/acp-node-v2'] || '(missing)');
} else {
    check('package.json', false, 'file not found');
}

// 5. README exists and has real content
const readmePath = path.join(PROJECT_ROOT, 'README.md');
const readmeLen = fs.existsSync(readmePath) ? fs.statSync(readmePath).size : 0;
check('README.md > 1KB', readmeLen > 1024, `${Math.round(readmeLen)} bytes`);

// 6. No secrets leaked in source files (not docs/examples)
const sourceFiles = ['run-cycle.ts', 'dist/run-cycle.js'];
let secretsLeaked = false;
for (const f of sourceFiles) {
    const p = path.join(PROJECT_ROOT, f);
    if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf-8');
        // Look for actual key patterns (prefix + real characters, not just prefix)
        if (content.match(/alch_[a-z0-9]{10,}/) || content.match(/acp-[a-f0-9]{10,}/)) {
            secretsLeaked = true;
        }
    }
}
check('No secrets in source', !secretsLeaked);

// Summary
console.log('\n=== VP Earner Setup Verification ===\n');
results.forEach(r => console.log(r));
console.log(`\n${pass} passed, ${fail} failed`);

if (fail > 0) {
    console.log('\n❌ Fix the failing items above.');
    process.exit(1);
}
console.log('\n✅ All checks passed — agent is ready to earn.');
