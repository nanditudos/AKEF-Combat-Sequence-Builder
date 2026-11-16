// node run-node.js
const fs = require('fs'), path = require('path');
for (const file of ['nomenclature.js', 'stats.js', 'damage.js', 'sim.js', 'status.js', 'effects.js', 'operators.js', 'operators2.js', 'weapons.js', 'weapon-effects.js', 'gear.js', 'sets.js', 'enemies.js', 'icons.js', 'consumables.js', 'tacticals.js', 'builder.js', 'optimizer.js', 'tests.js'])
  (0, eval)(fs.readFileSync(path.join(__dirname, file), 'utf8'));
globalThis.Endfield.testsDone.then(() => process.exit(globalThis.Endfield.testResults.every((r) => r.pass) ? 0 : 1));
