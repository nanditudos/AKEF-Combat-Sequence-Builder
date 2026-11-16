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
  check('Fangyi WIL', sheet.attribute('WIL'), 679 * 1.269);
  check('Fangyi INT', sheet.attribute('INT'), 307);
  check('Fangyi ATK P0 (hand-computed)', sheet.attack(), 1245.64 * (1 + 0.005 * 679 * 1.269 + 0.002 * 307), 0.01);
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



  // Simulation core
  var currentWeapon = { ...d.weapons.LoneBarge, modifiers: d.weapons.LoneBarge.modifiers.map((m) => (m.stat === 'DamageBonus' ? { ...m, value: 0.256 } : m)) };
  const simulate = (actionList, member = {}, options = {}) => {
    const simulation = new E.Simulation({ team: [{ operator: d.operators.ZhuangFangyi, potential: 0, weapon: currentWeapon, gearPieces: [d.gear.armor[0], d.gear.gloves[0], d.gear.kits[0], d.gear.kits[1]], ...member },
      { operator: d.operators.ZhuangFangyi, potential: 0, weapon: currentWeapon, gearPieces: [] }], enemy: d.enemies.TestDummy, setBonuses: d.gear.setBonuses, criticalMode: 'never', ...options });
    return simulation.run(actionList);
  };
  const singleBattleSkill = simulate([{ operator: 0, action: 'BattleSkill' }]);
  check('sim: one BS vs in-game 26214 (rounding tolerance 0.3%)', singleBattleSkill.totalDamage / 26214, 1, 0.003);
  check('sim: BS lock 0.3 + 0.1*1 blade', singleBattleSkill.horizon, 0.4);
  check('sim: SP after BS at t=0.4 (200-100+8*0.4)', singleBattleSkill.finalSP, 103.2);
  const chained = simulate([{ operator: 0, action: 'BattleSkill' }, { operator: 0, action: 'BasicAttack' }]);
  check('sim: BATK waits for BS lock', chained.timeline[1].start, 0.4);
  const resetCheck = simulate([{ operator: 0, action: 'BasicAttack' }, { operator: 0, action: 'BasicAttack', extraDelay: 1.5 }, { operator: 0, action: 'BasicAttack' }]);
  check('sim: BATK sequence resets after >1s gap', resetCheck.damageLog[1].multiplier, 0.36);
  check('sim: BATK continues without gap', resetCheck.damageLog[2].multiplier, 0.54);
  const switching = simulate([{ operator: 1, action: 'Switch' }, { operator: 0, action: 'Switch' }]);
  check('sim: switch-back locked for 1s', switching.timeline[1].start, 1);
  const finalStrike = simulate([0, 0, 0, 0, 0].map(() => ({ operator: 0, action: 'BasicAttack' })));
  check('sim: Final Strike restores 20 SP', finalStrike.finalSP, 200 + 20 + 8 * 5 > 300 ? 300 : 260);

  // Status system (scripts run at t=0 on the first operator; `lock` advances the horizon)
  const scenario = (script, lock = 0) => {
    const simulation = new E.Simulation({ team: [{ operator: d.operators.ZhuangFangyi, potential: 0, weapon: currentWeapon, gearPieces: [] }], enemy: d.enemies.TestDummy, setBonuses: {}, criticalMode: 'never' });
    simulation.run([{ operator: 0, action: 'Custom', script, lock }]);
    return simulation;
  };
  const countHits = (simulation, subtype) => simulation.damageLog.filter((hit) => hit.subtype === subtype).length;
  let sim1 = scenario(function* (a) { a.applyInfliction('Heat', 6); });
  check('status: Burst only while stacks increase (6 Heat -> 3 bursts)', countHits(sim1, 'ArtsBurst'), 3);
  check('status: infliction caps at 4', sim1.enemy.status.activeInfliction().stacks, 4);
  sim1 = scenario(function* (a) { a.applyInfliction('Heat', 3); a.applyInfliction('Cryo'); });
  check('status: different element -> reaction level = consumed stacks', sim1.enemy.status.reactionLevel('Solidification'), 3);
  check('status: infliction consumed by reaction', sim1.enemy.status.activeInfliction() ? 1 : 0, 0);
  sim1 = scenario(function* (a) { a.applyInfliction('Nature'); a.applyInfliction('Heat'); }, 10);
  check('status: Combustion = 11 DoT hits over 10s', countHits(sim1, 'DoT'), 11);
  check('status: Combustion DoT multiplier 12%+12%*level', sim1.damageLog.find((h) => h.subtype === 'DoT').multiplier, 0.24);
  sim1 = scenario(function* (a) { a.applyReaction('Nature', 1); });
  check('status: Corrosion shred at t=0 (3.6)', sim1.enemy.status.resistanceShred(0), 3.6);
  check('status: Corrosion shred at t=5 (3.6+0.84*5)', sim1.enemy.status.resistanceShred(5), 7.8);
  check('status: Corrosion shred capped at 12', sim1.enemy.status.resistanceShred(14), 12);
  sim1 = scenario(function* (a) { a.applyReaction('Electric', 2); });
  check('status: Electrification Arts damage taken (8%+4%*2)', sim1.enemy.status.modifiers(1)[0].value, 0.16);
  check('status: Electrification lasts 6+6*2 = 18s', sim1.enemy.status.modifiers(18.01).length, 0);
  sim1 = scenario(function* (a) { a.applyVulnerable(2); a.applyPhysicalStatus('Crush'); });
  check('status: Crush 150%+150%*stacks', sim1.damageLog[0].multiplier, 4.5);
  check('status: Crush consumes Vulnerable', sim1.enemy.status.vulnerableStacks(), 0);
  sim1 = scenario(function* (a) { a.applyPhysicalStatus('Lift'); a.applyPhysicalStatus('Lift'); });
  check('status: first Lift only adds Vulnerable (no damage)', sim1.damageLog.length, 1);
  check('status: second Lift deals 120% and 10 stagger', sim1.enemy.stagger, 10);
  check('status: Lift leaves Vulnerable at 2', sim1.enemy.status.vulnerableStacks(), 2);
  check('status: Lifted state set', sim1.enemy.status.isLifted(0.5) ? 1 : 0, 1);
  sim1 = scenario(function* (a) { a.applyInfliction('Heat', 2); a.applyInfliction('Cryo'); a.applyVulnerable(1); });
  const shatterHit = sim1.damageLog.find((h) => h.subtype === 'Shatter');
  check('status: Shatter 120%+120%*level (level 2)', shatterHit.multiplier, 3.6);
  check('status: Shatter consumes Solidification', sim1.enemy.status.reactionLevel('Solidification'), 0);
  sim1 = scenario(function* (a) { a.applyVulnerable(2); a.applyPhysicalStatus('Breach'); });
  check('status: Breach 50%+50%*stacks', sim1.damageLog[0].multiplier, 1.5);
  check('status: Breach Physical damage taken (8%+4%*2)', sim1.enemy.status.modifiers(1)[0].value, 0.16);
  sim1 = scenario(function* (a) { a.applyReaction('Electric', 2); });
  const withElectrification = new E.Simulation({ team: [{ operator: d.operators.ZhuangFangyi, potential: 0, weapon: currentWeapon, gearPieces: [] }], enemy: d.enemies.TestDummy, setBonuses: {}, criticalMode: 'never' });
  withElectrification.run([{ operator: 0, action: 'Custom', script: function* (a) { a.applyReaction('Electric', 2); }, lock: 0 }, { operator: 0, action: 'BattleSkill' }]);
  const bsHits = withElectrification.damageLog.filter((h) => h.category === 'BattleSkill');
  check('Fangyi BS consuming Electrification L2: 3 blades', bsHits.length, 3);
  check('Fangyi BS final hit (45%+9%*2)*6', bsHits[2].multiplier, 0.63 * 6);
  check('Fangyi BS consumed the reaction', withElectrification.enemy.status.reactionLevel('Electrification'), 0);

  // Triggers (set bonuses, weapon), crit counters, initial stagger
  const set3 = (setName) => [1, 2, 3].map((i) => ({ name: setName + i, set: setName, modifiers: [] }));
  const withSet = (setName, script, extra = {}) => {
    const simulation = new E.Simulation({ team: [{ operator: d.operators.ZhuangFangyi, potential: 0, weapon: currentWeapon, gearPieces: set3(setName) }], enemy: d.enemies.TestDummy, setBonuses: d.gear.setBonuses, criticalMode: 'never', ...extra });
    simulation.run([{ operator: 0, action: 'Custom', script, lock: 0 }]);
    return simulation;
  };
  const stacksOf = (simulation, name) => simulation.operators[0].stackCount(name, simulation.now);
  const bonus = (simulation, ...tags) => { const sheet = simulation.operators[0].sheet; sheet.currentTime = simulation.now; return sheet.sum('DamageBonus', tags); };
  let s2 = withSet('Xiranflow', function* (a) { a.applyReaction('Electric', 2); a.consumeReaction('Electrification'); a.applyReaction('Nature', 3); a.consumeReaction('Corrosion'); });
  check('trigger: Xiranflow stacks 2 then +3 capped at 3', stacksOf(s2, 'XiranflowBuff'), 3);
  s2 = withSet('Pulser Labs', function* (a) { a.applyReaction('Electric', 1); });
  check('trigger: Pulser Labs Electric +50% (weapon 25.6%)', bonus(s2, 'Electric'), 0.756);
  check('trigger: Pulser Labs static Arts Intensity +30', s2.operators[0].sheet.artsIntensity(), 30);
  s2 = withSet('Hot Work', function* (a) { a.applyReaction('Heat', 1); });
  check('trigger: Hot Work Combustion -> Heat +50%', bonus(s2, 'Heat'), 0.5);
  s2 = withSet('Tide Surge', function* (a) { a.applyInfliction('Heat', 2); });
  check('trigger: Tide Surge 2 stacks -> Arts +35%', bonus(s2, 'Electric', 'Arts'), 0.606);
  s2 = withSet('Tide Surge', function* (a) { a.applyInfliction('Heat', 1); });
  check('trigger: Tide Surge 1 stack -> nothing', bonus(s2, 'Electric', 'Arts'), 0.256);
  s2 = withSet('Deep Rampart', function* (a) { a.applyInfliction('Nature', 3); });
  check('trigger: Deep Rampart 0.1s ICD (2 bursts at once -> 1 stack)', stacksOf(s2, 'DeepRampartIntensity'), 1);
  s2 = withSet('Æthertech', function* (a) { a.applyVulnerable(4); a.applyVulnerable(1); });
  check('trigger: Æthertech 2 stacks + extra 16% at 4 vulnerable', bonus(s2, 'Physical'), 0.32);
  s2 = withSet('Swordmancer', function* (a) { a.applyVulnerable(1); a.applyPhysicalStatus('Lift'); a.applyPhysicalStatus('Lift'); });
  check('trigger: Swordmancer extra hit, 15s cooldown', countHits(s2, 'ExtraHit'), 1);
  s2 = withSet('MI Security', function* (a) { for (let i = 0; i < 11; i++) a.hit({ element: 'Electric', category: 'BattleSkill', multiplier: 1 }); });
  check('crit counter: 10% CR over 11 hits -> 1 crit event', stacksOf(s2, 'MISecurityAttack'), 1);
  s2 = withSet('Frontiers', function* (a) { a.returnSkillPoints(10); });
  check('trigger: Frontiers team DMG +16% on SP return', bonus(s2, 'Electric'), 0.416);
  const battleSkillHits = (withReaction) => {
    const run = new E.Simulation({ team: [{ operator: d.operators.ZhuangFangyi, potential: 0, weapon: d.weapons.LoneBarge, gearPieces: [] }], enemy: d.enemies.TestDummy, setBonuses: {}, criticalMode: 'never' });
    run.run([...(withReaction ? [{ operator: 0, action: 'Custom', script: function* (a) { a.applyReaction('Electric', 1); } }] : []), { operator: 0, action: 'BattleSkill' }]);
    return run.damageLog.filter((h) => h.category === 'BattleSkill');
  };
  check('weapon: Lone Barge +56% applies to the same cast', battleSkillHits(true)[0].factors.multiplierGroup - battleSkillHits(false)[0].factors.multiplierGroup, 0.56);
  const staggeredStart = new E.Simulation({ team: [{ operator: d.operators.ZhuangFangyi, potential: 0, gearPieces: [] }], enemy: d.enemies.TestDummy, startStaggeredFor: 5, criticalMode: 'never' });
  staggeredStart.run([{ operator: 0, action: 'BattleSkill' }]);
  check('initial stagger: enemy starts Staggered (x1.3 on first hit)', staggeredStart.damageLog[0].factors.stagger, 1.3);

  // Calibration against the game (reported, not pass/fail): Fangyi P0, BS with 0 blades, weapon Electric 25.6%.
  const calibrationSheet = E.buildStatSheet({ operator: d.operators.ZhuangFangyi, potential: 0, weapon: currentWeapon,
    gearPieces: [d.gear.armor[0], d.gear.gloves[0], d.gear.kits[0], d.gear.kits[1]], setBonuses: d.gear.setBonuses });
  calibrationSheet.addModifiers([E.mod('Amp', 0.20, ['Electric'])], 'Force of Nature');
  const calibration = E.computeDamage({ element: 'Electric', category: 'BattleSkill', multiplier: 0.45 * 6 }, calibrationSheet.snapshot(),
    { tier: 'Common', defense: 100, staggered: false, resistance: { Electric: 0 }, modifiers: [] }, { criticalMode: 'never' });
  const impliedAttack = 26214 / (calibration.damage / calibration.factors.attack);
  const calibrationBreakdown = Object.entries(calibrationSheet.attackBreakdown()).map(([name, value]) => `    ${name}: ${value}`);
  const calibrationLines = ['', 'ATK BREAKDOWN (calibration build)', ...calibrationBreakdown, `  ATK implied by in-game damage: ${impliedAttack.toFixed(1)}`, 'CALIBRATION (in game: 26214)', `  engine: ${calibration.damage.toFixed(1)}  (ratio game/engine ${(26214 / calibration.damage).toFixed(4)})`,
    ...Object.entries(calibration.factors).map(([name, value]) => `    ${name}: ${value}`)];

  const failed = results.filter((r) => !r.pass);
  const lines = results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.pass ? '' : `  got ${r.actual}, expected ${r.expected}`}`);
  lines.push('', `${results.length - failed.length}/${results.length} passed`, ...calibrationLines);
  if (typeof document !== 'undefined') { const pre = document.createElement('pre'); pre.textContent = lines.join('\n'); document.body.appendChild(pre); }
  console.log(lines.join('\n'));
  E.testResults = results;
})();
