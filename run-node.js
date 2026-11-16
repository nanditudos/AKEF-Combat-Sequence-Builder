// node tests/run-node.js
const fs = require('fs'), path = require('path');
for (const file of ['js/stats.js', 'js/damage.js', 'data/operators.js', 'data/weapons.js', 'data/gear.js', 'data/enemies.js', 'tests/tests.js'])
  (0, eval)(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
process.exit(globalThis.Endfield.testResults.every((r) => r.pass) ? 0 : 1);
