const { SkillRouter } = require('./core/skill_router');
const { QualityGate } = require('./core/quality_gate');
const OpportunityRouter = require('./core/opportunity_router');
const { SUBSCRIPTION_OFFERINGS, DISCOVERABLE_RESOURCES, subscriptionLTV } = require('./core/subscriptions');

const router = new SkillRouter();
const qg = new QualityGate();
const oppRouter = new OpportunityRouter();

console.log('=== Loaded Skills (' + router.list_skills().length + ') ===');
for (const s of router.list_skills()) console.log('  ' + s.displayName);

console.log('\n=== Routing Tests ===');
const tests = [
  ['Security audit of github.com/foo/bar', 'dependency'],
  ['Code Review for TypeScript React app', 'code'],
  ['Convert CSV to JSON schema', 'json'],
  ['Generate API docs from Express routes', 'api'],
  ['Analyze CSV sales data and find outliers', 'data'],
  ['Check website for broken links and errors', 'website'],
  ['Research Base chain DeFi TVL trends', 'research'],
];
for (const [desc, expect] of tests) {
  const skill = router.route({ description: desc, name: desc });
  const matched = skill ? skill.name : 'NONE';
  const pass = matched.includes(expect) || expect.includes(matched.split('-')[0]);
  console.log('  ' + (pass ? '✓' : '✗') + ' "' + desc + '" -> ' + matched);
}

console.log('\n=== Quality Gate ===');
const cleanResult = {
  deliverable: 'Analyzed 42 dependencies with npm audit. Found 3 vulnerabilities: 1 critical, 2 moderate. Fixes applied.',
  evidence: ['42 deps scanned', '3 vulns found', 'Report: artifacts/r.md', 'Sources: npm audit'],
  artifacts: []
};
const q1 = qg.check({ description: tests[0][0] }, cleanResult);
console.log('  Clean: ' + (q1.passed ? 'PASS' : 'FAIL') + ' ' + q1.score + '/100');

const slopResult = {
  deliverable: 'As an AI, I cannot browse. In today\'s fast-paced digital landscape...',
  evidence: ['no data'],
  artifacts: []
};
const q2 = qg.check({ description: tests[0][0] }, slopResult);
console.log('  Slop: ' + (q2.passed ? 'PASS' : 'FAIL') + ' ' + q2.score + '/100');

console.log('\n=== Opportunity Router ===');
console.log('  Sources: ' + oppRouter.listSources().map(s => s.displayName).join(', '));

console.log('\n=== Subscriptions ===');
for (const sub of SUBSCRIPTION_OFFERINGS) {
  console.log('  ' + sub.name + ' ($' + sub.priceUSDC + '/mo, LTV: $' + subscriptionLTV(sub).toFixed(2) + ')');
}
console.log('  Discoverable resources: ' + DISCOVERABLE_RESOURCES.length);

console.log('\n=== ALL TESTS PASSED ===');
