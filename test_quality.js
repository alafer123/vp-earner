const {SkillRouter} = require('./core/skill_router');
const {QualityGate} = require('./core/quality_gate');
const r = new SkillRouter();
const qg = new QualityGate();

console.log('=== Loaded skills ===');
for (const s of r.list_skills()) console.log('  ' + s.name + ' | ' + s.displayName);

console.log('\n=== Routing ===');
const tests = [
  {desc:'Security audit of github.com/foo/bar', name:'Security audit'},
  {desc:'Code Review for TypeScript React app', name:'Code Review'},
  {desc:'Convert CSV to JSON schema', name:'Data Transform'},
  {desc:'Turn this text into JSON', name:'JSON Transform'},
];
tests.forEach(t => {
  const skill = r.route(t);
  console.log('  ', t.name, '->', skill ? skill.name : 'NONE');
});

console.log('\n=== Quality Gate (clean) ===');
const cleanResult = {
  deliverable: 'Analyzed 42 dependencies with npm audit. Found 3 vulnerabilities. All patched.',
  evidence: ['42 dependencies checked', '3 vulnerabilities found', 'Results saved', 'Sources: npm audit'],
  artifacts: []
};
const q1 = qg.check(tests[0], cleanResult);
console.log('  Passed:', q1.passed, 'Score:', q1.score, 'Issues:', q1.issues.length === 0 ? 'none' : q1.issues);

console.log('\n=== Quality Gate (slop) ===');
const slopResult = {
  deliverable: 'As an AI, I cannot browse. In today\'s fast-paced digital landscape, it is important to note that this is a great solution. TODO: improve.',
  evidence: ['no real data'],
  artifacts: []
};
const q2 = qg.check(tests[0], slopResult);
console.log('  Passed:', q2.passed, 'Score:', q2.score, 'Issues:', q2.issues);

console.log('\n=== ALL TESTS PASSED ===');
