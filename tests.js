(function () {
  const E = globalThis.Endfield, results = [];
  const check = (name, actual, expected, tolerance = 1e-6) => {
    results.push({ name, pass: Math.abs(actual - expected) <= tolerance, actual, expected });
  };
  const enemy = (overrides) => ({ tier: 'Common', defense: 100, staggered: false, resistance: { Electric: 0, Physical: 0 }, modifiers: [], ...overrides });
  const attacker = (modifiers = [], extra = {}) => ({ attack: 1000, criticalRate: 0.05, criticalDamage: 0.5, artsIntensity: 0, level: 90, modifiers, ...extra });
  const hit = (instance, atk, foe, options = { criticalMode: 'never' }) =>
    E.computeDamage({ element: 'Electric', category: 'BattleSkill', multiplier: 1, ...instance }, atk, foe, options).damage;

  // Stat pipeline (hand-computed from the spec; NOT yet checked against the game)
  const d = E.data;
  const sheet = E.buildStatSheet({ operator: d.operators.ZhuangFangyi, potential: 0, weapon: d.weapons.LoneBarge,
    gearPieces: [d.gear.armor[0], d.gear.gloves[0], d.gear.kits[0], d.gear.kits[1]], setBonuses: d.gear.setBonuses });
  check('Fangyi WIL', sheet.attribute('WIL'), 641 * 1.269);
  check('Fangyi INT', sheet.attribute('INT'), 307);
  check('Fangyi ATK P0', sheet.attack(), 7076.66, 0.05);
  const p5 = E.buildStatSheet({ operator: d.operators.ZhuangFangyi, potential: 5 });
  check('P4 UE cost 240 -> 204', p5.ultimateEnergyCost(240), 204);

  // Damage engine
  check('plain hit vs DEF100/RES0', hit({}, attacker(), enemy()), 500);
  check('staggered x1.3', hit({}, attacker(), enemy({ staggered: true })), 650);
  check('Boss finisher x1.75', hit({ category: 'BasicAttack', subtype: 'Finisher', multiplier: 9 }, attacker(), enemy({ tier: 'Boss' })), 1000 * 9 * 1.75 * 0.5);
  check('Link 3 stacks BS', hit({ linkStacks: 3 }, attacker(), enemy()), 500 * 1.6);
  check('Link ignored on BATK', hit({ category: 'BasicAttack', linkStacks: 3 }, attacker(), enemy()), 500);
  check('resistance 20', hit({}, attacker(), enemy({ resistance: { Electric: 20 } })), 400);
  check('negative DEF -100', hit({}, attacker(), enemy({ defense: -100 })), 1000 * (2 - Math.pow(0.99, 100)));
  check('ignore resistance 15 (tagged)', hit({}, attacker([E.mod('IgnoreResistance', 15, ['Electric'])]), enemy({ resistance: { Electric: 20 } })), 1000 * 0.65 * 0.5);
  check('tagged bonus needs all tags', hit({}, attacker([E.mod('DamageBonus', 1, ['BattleSkill', 'Cryo'])]), enemy()), 500);
  check('vs-staggered bonus', hit({}, attacker([E.mod('DamageBonus', 0.2, ['Staggered'])]), enemy({ staggered: true })), 1000 * 1.2 * 1.3 * 0.5);
  check('crit mean', hit({}, attacker([], { criticalRate: 0.5 }), enemy(), { criticalMode: 'mean' }), 500 * 1.25);
  check('crit median low CR', hit({}, attacker([], { criticalRate: 0.49 }), enemy(), { criticalMode: 'median' }), 500);
  check('crit median high CR', hit({}, attacker([], { criticalRate: 0.5 }), enemy(), { criticalMode: 'median' }), 750);
  check('DoT never crits', hit({ subtype: 'DoT', category: 'Status' }, attacker([], { criticalRate: 1 }), enemy(), { criticalMode: 'always' }), 500);
  check('Arts status scaling', hit({ category: 'Status', statusKind: 'ArtsStatus' }, attacker([], { artsIntensity: 100 }), enemy()), 500 * (1 + 89 / 196) * 2);
  check('Protection uses max only', hit({}, attacker(), enemy({ modifiers: [E.mod('Protection', 0.2), E.mod('Protection', 0.5)] })), 250);
  check('Corrosion shred', hit({}, attacker(), enemy({ resistanceShred: 10 })), 450);

  const failed = results.filter((r) => !r.pass);
  const lines = results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  got ${r.actual}, expected ${r.expected}`}`);
  lines.push('', `${results.length - failed.length}/${results.length} passed`);
  if (typeof document !== 'undefined') { const pre = document.createElement('pre'); pre.textContent = lines.join('\n'); document.body.appendChild(pre); }
  console.log(lines.join('\n'));
  E.testResults = results;
})();
