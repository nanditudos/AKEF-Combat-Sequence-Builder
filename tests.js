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
    gearPieces: [d.gear.byName('Xiranflow Light Armor'), d.gear.byName('Xiranflow Gloves'), d.gear.byName('Xiranflow Baton'), d.gear.byName('LYNX Slab')], setBonuses: d.gear.setBonuses });
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
    const simulation = new E.Simulation({ team: [{ operator: d.operators.ZhuangFangyi, potential: 0, weapon: currentWeapon, gearPieces: [d.gear.byName('Xiranflow Light Armor'), d.gear.byName('Xiranflow Gloves'), d.gear.byName('Xiranflow Baton'), d.gear.byName('LYNX Slab')], ...member },
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
  s2 = withSet('Aethertech', function* (a) { a.applyVulnerable(4); a.applyVulnerable(1); });
  check('trigger: Æthertech 2 stacks + extra 16% at 4 vulnerable', bonus(s2, 'Physical'), 0.32);
  s2 = withSet('Swordmancer', function* (a) { a.applyVulnerable(1); a.applyPhysicalStatus('Lift'); a.applyPhysicalStatus('Lift'); });
  check('trigger: Swordmancer extra hit, 15s cooldown', countHits(s2, 'ExtraHit'), 1);
  s2 = withSet('MI Security', function* (a) { for (let i = 0; i < 11; i++) a.hit({ element: 'Electric', category: 'BattleSkill', multiplier: 1 }); });
  check('crit counter: 10% CR over 11 hits -> 1 crit event', stacksOf(s2, 'MISecurityAttack'), 1);
  s2 = withSet('Frontiers', function* (a) { a.restoreSkillPoints(10); });
  check('trigger: Frontiers team DMG +16% on SP restored', bonus(s2, 'Electric'), 0.416);
  s2 = withSet('Frontiers', function* (a) { a.returnSkillPoints(10); });
  check('trigger: Frontiers does NOT fire on SP returned', bonus(s2, 'Electric'), 0.256);
  let rejected = 0; try { E.mod('Typo', 1); } catch (e) { rejected++; } try { E.mod('ATK', 1, ['Electric']); } catch (e) { rejected++; } try { E.mod('DamageBonus', 1, ['Fire']); } catch (e) { rejected++; }
  check('mod() rejects unknown stat / tags on untagged stat / unknown tag', rejected, 3);
  const battleSkillHits = (withReaction) => {
    const run = new E.Simulation({ team: [{ operator: d.operators.ZhuangFangyi, potential: 0, weapon: d.weapons.LoneBarge, gearPieces: [] }], enemy: d.enemies.TestDummy, setBonuses: {}, criticalMode: 'never' });
    run.run([...(withReaction ? [{ operator: 0, action: 'Custom', script: function* (a) { a.applyReaction('Electric', 1); } }] : []), { operator: 0, action: 'BattleSkill' }]);
    return run.damageLog.filter((h) => h.category === 'BattleSkill');
  };
  check('weapon: Lone Barge +56% applies to the same cast', battleSkillHits(true)[0].factors.multiplierGroup - battleSkillHits(false)[0].factors.multiplierGroup, 0.56);
  const staggeredStart = new E.Simulation({ team: [{ operator: d.operators.ZhuangFangyi, potential: 0, gearPieces: [] }], enemy: d.enemies.TestDummy, startStaggeredFor: 5, criticalMode: 'never' });
  staggeredStart.run([{ operator: 0, action: 'BattleSkill' }]);
  check('initial stagger: enemy starts Staggered (x1.3 on first hit)', staggeredStart.damageLog[0].factors.stagger, 1.3);

  // Weapons (all 68 load; representative trigger mechanics)
  check('weapons: all 68 loaded', Object.keys(d.weapons).length, 68);
  check('weapons: exact fraction stat (Complexed Industry Electric 43.33% = 130/3 %)', d.weapons.ComplexedIndustry.modifiers.find((m) => m.stat === 'DamageBonus').value, 1.3 / 3, 1e-6);
  const arts = (weaponName, entries, gearPieces = []) => {
    const run = new E.Simulation({ team: [{ operator: d.operators.ZhuangFangyi, potential: 0, weapon: d.weapons[weaponName], gearPieces }, { operator: d.operators.ZhuangFangyi, potential: 0, gearPieces: [] }],
      enemy: d.enemies.TestDummy, setBonuses: {}, criticalMode: 'never' });
    run.run(entries.map((e) => (typeof e === 'function' ? { operator: 0, action: 'Custom', script: e } : { operator: 0, action: 'Custom', ...e })));
    return run;
  };
  const sheetBonus = (run, operatorIndex, stat, ...tags) => { const sheet = run.operators[operatorIndex].sheet; sheet.currentTime = run.now; return sheet.sum(stat, tags); };
  let w = arts('ComplexedIndustry', [{ category: 'ComboSkill', script: function* (a) { a.applyInfliction('Electric'); } }]);
  check('weapon: Complexed Industry Arts Intensity +42 (combo skill infliction)', sheetBonus(w, 0, 'ArtsIntensity'), 42);
  w = arts('ComplexedIndustry', [function* (a) { a.applyInfliction('Electric'); }]);
  check('weapon: Complexed Industry needs a combo skill', sheetBonus(w, 0, 'ArtsIntensity'), 0);
  const ultimateHitFactor = (withVulnerable) => {
    const entries = [...(withVulnerable ? [{ category: 'BattleSkill', script: function* (a) { a.applyVulnerable(1); a.applyVulnerable(1); } }] : []),
      { category: 'Ultimate', script: function* (a) { a.hit({ element: 'Electric', category: 'Ultimate', multiplier: 1 }); } }];
    return arts('GloriousMemory', entries).damageLog.filter((h) => h.category === 'Ultimate')[0].factors.multiplierGroup;
  };
  check('weapon: Glorious Memory armed buff (+33.6%, 0.5s cooldown -> 1 stack) on next ultimate', ultimateHitFactor(true) - ultimateHitFactor(false), 0.336);
  w = arts('GloriousMemory', [{ category: 'BattleSkill', script: function* (a) { a.applyVulnerable(1); } }, { category: 'Ultimate', script: function* () {} }]);
  check('weapon: armed buff is released after the cast', sheetBonus(w, 0, 'DamageBonus'), 0);
  w = arts('NeverRest', [function* (a) { a.restoreSkillPoints(10); }]);
  check('weapon: Never Rest self +14% Physical', sheetBonus(w, 0, 'DamageBonus', 'Physical') - 0.44800, 0.14, 1e-6);
  check('weapon: Never Rest others get half (+7%)', sheetBonus(w, 1, 'DamageBonus', 'Physical'), 0.07, 1e-9);
  w = arts('EminentRepute', [function* (a) { a.applyVulnerable(2); a.applyPhysicalStatus('Crush'); }]);
  check('weapon: Eminent Repute ATK +[14%+7%x2] self, half for others', sheetBonus(w, 0, 'ATKBonus') - 0.28, 0.28, 1e-9);
  check('weapon: Eminent Repute others', sheetBonus(w, 1, 'ATKBonus'), 0.14, 1e-9);
  const strikes = Array.from({ length: 5 }, () => ({ operator: 0, action: 'BasicAttack' }));
  const princely = new E.Simulation({ team: [{ operator: d.operators.ZhuangFangyi, potential: 0, weapon: d.weapons.SunderedPrince, gearPieces: [] }], enemy: d.enemies.TestDummy, setBonuses: {}, criticalMode: 'never' });
  princely.run(strikes);
  check('weapon: Sundered Prince Final Strike stagger x1.336 when controlled', princely.enemy.stagger, 18 * 1.336, 1e-6);
  check('weapon: Sundered Prince ATK +56% when controlled', sheetBonus(princely, 0, 'ATKBonus'), 0.56 + 0, 1e-9);
  w = arts('Type42SolemnPhalanx', [function* (a) { a.applyInfliction('Heat'); }]);
  check('weapon: Type 42 (INT >= WIL) Arts DMG +56% on own infliction', sheetBonus(w, 0, 'DamageBonus', 'Arts') - 0, 0.56, 1e-9);
  w = arts('Type42SolemnPhalanx', [function* (a) { a.applyInfliction('Heat', 2); }], [{ name: 'big will', modifiers: [E.mod('WIL', 200)] }]);
  check('weapon: Type 42 (WIL > INT) burst -> enemy Arts DMG taken +16.8%', w.enemy.status.modifiers(1).find((m) => m.stat === 'DamageTaken').value, 0.168);
  w = arts('UmbraofFrigidEventide', [{ category: 'BattleSkill', script: function* () {} }, function* (a) { a.applyInfliction('Heat', 2); }]);
  check('weapon: Frigid Eventide consumes a Windform on Burst', w.operators[0].stackCount('Windform', w.now), 3);
  check('weapon: Frigid Eventide Arts +11.2% stack', w.operators[0].stackCount('HunterInstinctArts', w.now), 1);
  w = arts('LupineScarlet', [function* (a) { for (let i = 0; i < 70; i++) a.hit({ element: 'Physical', category: 'BattleSkill', multiplier: 1 }); }]);
  check('weapon: Lupine Scarlet 16 Wolven Blood -> extra +67.2% window', w.operators[0].effects.LupineBonus ? 1 : 0, 1);
  w = arts('FlickersintheMist', [{ operator: 0, action: 'BattleSkill' }]);
  check('weapon: Flickers in the Mist reacts to real Force of Nature (Electric Amp)', w.operators[0].stackCount('OverlappingFlickers', w.now) >= 1 ? 1 : 0, 1);
  w = arts('DeliveryGuaranteed', [{ category: 'ComboSkill', script: function* (a) { a.applyVulnerable(1); a.applyPhysicalStatus('Lift'); } }]);
  check('weapon: Delivery Guaranteed team Arts +33.6% +9.8% per Lifted enemy', sheetBonus(w, 1, 'DamageBonus', 'Arts'), 0.434, 1e-9);
  w = arts('Valiant', [function* (a) { a.applyVulnerable(1); a.applyPhysicalStatus('Lift'); }]);
  check('weapon: Valiant extra raw physical hit (336% ATK)', w.damageLog.filter((h) => h.subtype === 'ExtraHit')[0].multiplier, 3.36);
  w = arts('Navigator', [function* (a) { a.applyReaction('Cryo', 1); }]);
  check('weapon: Navigator doubled when the wielder triggers it (CR +11.2% total)', sheetBonus(w, 0, 'CriticalRate') - 0.098, 0.112, 1e-9);
  w = arts('DetonationUnit', [function* (a) { a.applyInfliction('Heat', 2); }]);
  check('weapon: Detonation Unit enemy Arts DMG taken +25.2%', w.enemy.status.modifiers(1).find((m) => m.stat === 'DamageTaken').value, 0.252);
  w = arts('Clannibal', [function* (a) { a.applyReaction('Heat', 1); a.consumeReaction('Combustion'); a.applyReaction('Nature', 1); a.consumeReaction('Corrosion'); }]);
  check('weapon: Clannibal 25s cooldown (one debuff only)', w.enemy.status.modifiers(1).filter((m) => m.stat === 'DamageTaken').length, 1);
  w = arts('MountainBearer', [{ category: 'BattleSkill', script: function* (a) { a.applyVulnerable(1); } }]);
  check('weapon: Mountain Bearer All Attributes +22.4% ((184+60 talent) x1.224)', w.operators[0].sheet.attribute('WIL'), 244 * 1.224, 1e-6);
  w = arts('LoneBarge', [function* (a) { a.applyReaction('Electric', 1); }]);
  check('weapon: enemy tag Vulnerable available for damage bonuses', (() => { w.enemy.status.addVulnerableStacks(1, { operator: w.operators[0] }); return w.enemy.forDamage(w.now).tags.includes('Vulnerable') ? 1 : 0; })(), 1);

  // Gear file, combo/ultimate/forms/finisher/dive, operators
  check('gear: 184 pieces from Gear.txt loaded', d.gear.armor.length + d.gear.gloves.length + d.gear.kits.length, 184);
  const O = d.operators;
  const crew = (members, enemy = d.enemies.TestDummy, options = {}) => new E.Simulation({ team: members.map((m) => ({ potential: 0, gearPieces: [], ...m })), enemy, setBonuses: d.gear.setBonuses, criticalMode: 'never', ...options });
  const me = (name, extra = {}) => ({ operator: O[name], ...extra });
  const step = (operator, action, extra = {}) => ({ operator, action, ...extra });
  const script = (operator, fn, extra = {}) => ({ operator, action: 'Custom', script: fn, ...extra });
  const basicAttacks = (operator, count) => Array.from({ length: count }, () => step(operator, 'BasicAttack'));
  const same = (a, b) => (a === b ? 1 : 0);
  const warned = (run, pattern) => run.warnings.filter((w) => pattern.test(w.text)).length;

  let r = crew([me('ZhuangFangyi', { startUltimateEnergy: 240 })]);
  r.run([step(0, 'Ultimate'), step(0, 'BattleSkill'), ...basicAttacks(0, 3)]);
  check('Fangyi ult: UE spent, none gained while transformed', r.operators[0].ultimateEnergy, 0);
  check('Fangyi ult: BATK uses the transformed sequence', same(r.damageLog.filter((h) => h.category === 'BasicAttack').map((h) => h.multiplier).join(), '1.5,2.1,3'), 1);
  check('Fangyi ult: first BS is free (3 hits, no SP)', r.damageLog.filter((h) => h.category === 'BattleSkill').length * 100 + Math.round(r.team.sp), 3 * 100 + Math.round(200 + 8 * 3.3 + 20));
  check('Fangyi ult: BS final hit applies Electric Infliction', r.enemy.status.activeInfliction() ? 1 : 0, 1);
  r = crew([me('ZhuangFangyi')]);
  r.run([script(0, function* (a) { a.applyInfliction('Electric', 2); }), ...basicAttacks(0, 5), step(0, 'ComboSkill')]);
  check('Fangyi combo: Final Strike on Electric Infliction opens it; forces Electrification level = stacks', r.enemy.status.reactionLevel('Electrification', r.horizon - 0.01), 2);
  check('Fangyi combo: +10 UE per stack, no window warning', r.operators[0].ultimateEnergy * 1000 + warned(r, /combo/), 20000);
  check('combo without a window only warns', warned(crew([me('ZhuangFangyi')]).run([step(0, 'ComboSkill')]) && { warnings: [] }, /x/) + warned((r = crew([me('ZhuangFangyi')]), r.run([step(0, 'ComboSkill')]), r), /window/), 1);

  const fragile = { ...d.enemies.TestDummy, staggerCapacity: 10 };
  r = crew([me('ZhuangFangyi')], fragile);
  r.run([...basicAttacks(0, 5), step(0, 'BasicAttack'), step(0, 'Finisher'), step(0, 'Finisher')]);
  check('finisher: BATK is invalid while a Finisher is pending', r.timeline[5].invalid ? 1 : 0, 1);
  check('finisher: available once per Staggered window', (r.timeline[6].invalid ? 1 : 0) * 10 + (r.timeline[7].invalid ? 1 : 0), 1);
  const finisherHit = r.damageLog.find((h) => h.subtype === 'Finisher');
  check('finisher: 900% with Staggered x1.3 (does not end the stagger)', finisherHit.multiplier * finisherHit.factors.stagger, 9 * 1.3);
  r = crew([me('ZhuangFangyi'), me('Perlica')]);
  r.run([step(1, 'DiveAttack'), step(0, 'DiveAttack')]);
  check('dive: only the controlled operator (180%)', (r.timeline[0].invalid ? 1 : 0) + r.damageLog.filter((h) => h.subtype === 'Dive')[0].multiplier, 2.8);
  r = crew([me('ZhuangFangyi', { startUltimateEnergy: 240 })], d.enemies.TestDummy, { startStaggeredFor: 100 });
  r.run([step(0, 'Ultimate'), step(0, 'Finisher'), step(0, 'BasicAttack')]);
  check('forms: no Finisher in Empyrean, BATK stays allowed', (r.timeline[1].invalid ? 1 : 0) * 10 + (r.timeline[2].invalid ? 1 : 0), 10);

  r = crew([me('Perlica')]);
  r.run([...basicAttacks(0, 4), step(0, 'ComboSkill')]);
  check('Perlica: Final Strike opens combo; forced Electrification lasts 5s', r.enemy.status.modifiers(8.99).length * 10 + r.enemy.status.modifiers(9.01).length, 10);
  r = crew([me('Perlica', { potential: 1 })]);
  r.run([...basicAttacks(0, 4), step(0, 'ComboSkill')]);
  check('Perlica P1: Electrification +75% duration (8.75s)', r.enemy.status.modifiers(12.74).length * 10 + r.enemy.status.modifiers(12.76).length, 10);
  r = crew([me('Perlica', { potential: 3 })]);
  r.run([step(0, 'BattleSkill'), script(0, function* (a) { a.applyReaction('Electric', 1); })]);
  check('Perlica P3: ATK +20% after applying Electrification', r.operators[0].stackCount('PerlicaP3', r.now), 1);

  r = crew([me('Liino'), me('Perlica')]);
  r.run([step(0, 'BattleSkill'), script(1, function* (a) { a.applyReaction('Electric', 1); }, { extraDelay: 1.5 }), step(0, 'ComboSkill')]);
  check('Liino: Vocalist Stance gives the team ATK +10%', ((x) => { x.operators[1].sheet.currentTime = x.now; return x.operators[1].sheet.sum('ATKBonus'); })(r), 0.10);
  check('Liino: combo opens on a reaction during the stance (+20 UE +1.625 from 25 SP spent, no warning)', r.operators[0].ultimateEnergy * 1000 + warned(r, /combo/), 21625);
  r = crew([me('Liino'), me('Perlica')]);
  r.run([step(0, 'BattleSkill'), step(1, 'BasicAttack', { extraDelay: 10.5 })]);
  check('Liino: Additional ATK 10s into the stance (2 battle skill hits)', r.damageLog.filter((h) => h.operator === 'Liino').length, 2);
  r = crew([me('Liino')]);
  r.run([step(0, 'BattleSkill'), step(0, 'BattleSkill')]);
  check('Liino: second battle skill is End Stance (no SP, stance cleared)', (r.operators[0].stance ? 1 : 0) * 1000 + Math.round(r.team.sp), Math.round(200 - 25 + 8 * 2));

  const wilGear = [{ name: 'will', modifiers: [E.mod('WIL', 100)] }];
  r = crew([me('Arcane')]); r.run([step(0, 'BattleSkill')]);
  check('Arcane: INT >= WIL -> Array Arcana INT (500%)', r.damageLog[0].multiplier, 5.0);
  r = crew([me('Arcane', { gearPieces: wilGear })]); r.run([step(0, 'BattleSkill')]);
  check('Arcane: WIL > INT -> Array Arcana WILL (300%)', r.damageLog[0].multiplier, 3.0);
  r = crew([me('Arcane')]);
  r.run([step(0, 'BattleSkill'), step(0, 'ComboSkill'), step(0, 'BattleSkill'), script(0, function* () {}, { lock: 1 })]);
  check('Arcane INT: Nature infliction opens combo; BS ends Imprisonment (5.0 bonus hit, 30 SP back)', r.damageLog.filter((h) => h.multiplier === 5 && h.category === 'ComboSkill').length * 1000 + Math.round(r.team.sp) + warned(r, /combo/) * 99999, 1000 + Math.round(200 - 100 - 100 + 30 + 8 * 4));
  r = crew([me('Arcane', { startUltimateEnergy: 100 })]);
  r.run([step(0, 'Ultimate'), ...basicAttacks(0, 10), step(0, 'Ultimate')]);
  check('Arcane ult: 2 Cluster Strikes (360% each) then Gloompurge Arcana (1440%) for free', same(r.damageLog.filter((h) => h.category === 'Ultimate').map((h) => h.multiplier).join(), '1.8,3.6,3.6,14.4'), 1);
  check('Arcane ult: Arcana costs no UE', r.operators[0].ultimateEnergy, 0);

  r = crew([me('Gilberta'), me('Perlica')]);
  r.run([script(0, function* (a) { a.applyReaction('Heat', 1); }), step(0, 'ComboSkill')]);
  check('Gilberta: combo forcibly Lifts (Vulnerable +1, Lifted)', r.enemy.status.vulnerableStacks(0.5) * 10 + (r.enemy.status.isLifted(0.5) ? 1 : 0), 11);
  check("Gilberta: Messenger's Song +7% Ultimate Efficiency to a Caster ally", ((x) => { x.operators[1].sheet.currentTime = 0; return x.operators[1].sheet.sum('UltimateEfficiency'); })(r), 0.07);
  r = crew([me('Gilberta', { startUltimateEnergy: 90 })]);
  r.run([script(0, function* (a) { a.applyVulnerable(2); }), step(0, 'Ultimate')]);
  check('Gilberta ult: Arts Susceptibility 30% + 3% x Vulnerable stacks', r.enemy.status.modifiers(2).find((m) => m.stat === 'Susceptibility').value, 0.36, 1e-9);

  r = crew([me('MiFu')]);
  r.run([script(0, function* (a) { a.applyVulnerable(3); }), step(0, 'BattleSkill'), step(0, 'BattleSkill'), step(0, 'BattleSkill')]);
  check('Mi Fu: Cloudtrapper 150% -> Trail and Mangle 200%', same(r.damageLog.filter((h) => h.category === 'BattleSkill').map((h) => h.multiplier).join(), '1.5,2'), 1);
  check('Mi Fu: Crush (150%+150%x3) then World Splitter 600% as Crush damage', r.damageLog.filter((h) => h.category === 'Status' && h.multiplier === 6).length, 2);
  check('Mi Fu: BS SP 100-50, 50, 50 (net 150)', Math.round(r.team.sp), Math.round(200 - 150 + 8 * 3));
  r = crew([me('MiFu')]);
  r.run([script(0, function* (a) { a.applyVulnerable(3); }), step(0, 'ComboSkill'), step(0, 'BattleSkill')]);
  check('Mi Fu: combo (3 Vulnerable) applies Physical Susceptibility 5% and queues Trail and Mangle', r.enemy.status.hasSusceptibility('Physical', 1.5) ? r.damageLog.filter((h) => h.category === 'BattleSkill')[0].multiplier : -1, 2);

  // Clarifications: Arts tag, Cosmovoice, Perlica chain, dynamic susceptibility, timing slices, new set bonuses
  const statusBurst = (category) => E.computeDamage({ element: 'Electric', category, subtype: category === 'Status' ? 'ArtsBurst' : undefined, multiplier: 1 }, { attack: 1000, criticalRate: 0.05, criticalDamage: 0.5, artsIntensity: 0, level: 90, modifiers: [E.mod('DamageBonus', 1, ['Arts'])] }, { tier: 'Common', defense: 100, staggered: false, resistance: { Electric: 0 }, modifiers: [] }, { criticalMode: 'never' }).factors.multiplierGroup;
  check('Arts-tagged bonus applies to skills AND to Burst/Reaction hits (measured)', statusBurst('BattleSkill') * 10 + statusBurst('Status'), 22);
  r = crew([me('Liino', { startUltimateEnergy: 160 }), me('Perlica')]);
  r.run([step(0, 'Ultimate'), script(1, function* (a) { a.applyReaction('Electric', 1); }, { extraDelay: 1.5 }), step(0, 'ComboSkill')]);
  check('Liino: combo does not trigger during Cosmovoice (window warning)', warned(r, /window/), 1);
  check('Liino ult: Stage Pyrotechnics at 0s and Extravaganza at 0.5s (hit at the start of each slice)', r.damageLog.filter((h) => h.category === 'Ultimate').slice(0, 2).map((h) => h.time).join() === '0,0.5' ? 1 : 0, 1);
  r = crew([me('Perlica')]);
  r.run([script(0, function* (a) { a.applyVulnerable(1); }), ...basicAttacks(0, 4), step(0, 'ComboSkill')]);
  check('Perlica: Cycle Protocol never chains with a single enemy', r.damageLog.filter((h) => h.category === 'ComboSkill').length, 1);
  r = crew([me('Gilberta', { startUltimateEnergy: 90 })]);
  r.run([script(0, function* (a) { a.applyVulnerable(2); }), step(0, 'Ultimate')]);
  check('Gilberta ult: Susceptibility is dynamic and ends with the 5s field', r.enemy.status.modifiers(2).length * 10 + r.enemy.status.modifiers(6.01).filter((m) => m.stat === 'Susceptibility').length, 10);
  r = crew([me('Gilberta')]); r.run([step(0, 'BattleSkill')]);
  check('Gilberta BS: two hits, each at the start of a 0.5s slice', r.damageLog.map((h) => h.time).join() === '0,0.5' ? 1 : 0, 1);
  const setRun = (setName, entries, members = 1) => crew([me('ZhuangFangyi', { gearPieces: set3(setName) }), ...(members > 1 ? [me('Perlica')] : [])]);
  const firstBattleSkillGroup = (setName, withCombo) => {
    const run = setRun(setName);
    run.run([...(withCombo ? [script(0, function* () {}, { category: 'ComboSkill' })] : []), script(0, function* (a) { a.hit({ element: 'Electric', category: 'BattleSkill', multiplier: 1 }); }, { category: 'BattleSkill' })]);
    return run.damageLog.find((h) => h.category === 'BattleSkill').factors.multiplierGroup;
  };
  check('set: Bonekrusha combo cast -> next battle skill +30% (ATK +15% separate)', firstBattleSkillGroup('Bonekrusha', true) - firstBattleSkillGroup('Bonekrusha', false), 0.30, 1e-9);
  r = setRun('Type 50 Yinglung');
  r.run([script(0, function* () {}, { category: 'BattleSkill' }), script(0, function* (a) { a.hit({ element: 'Electric', category: 'ComboSkill', multiplier: 1 }); }, { category: 'ComboSkill' })]);
  check('set: Type 50 Yinglung battle skill cast -> next combo +20%', r.damageLog[0].factors.multiplierGroup - 1 - 0.256 * 0, 0.20, 1e-9);
  r = crew([me('ZhuangFangyi', { gearPieces: set3('Grizzled Edge') })]);
  r.run([script(0, function* (a) { a.applyVulnerable(3); a.applyPhysicalStatus('Crush'); })]);
  check('set: Grizzled Edge Physical +6% x 3 stacks consumed', sheetBonus(r, 0, 'DamageBonus', 'Physical'), 0.18, 1e-9);
  r = crew([me('ZhuangFangyi', { gearPieces: set3('Grizzled Edge') })]);
  r.run([script(0, function* (a) { a.applySusceptibility('Physical', 0.05, 10); a.applyVulnerable(3); a.applyPhysicalStatus('Crush'); })]);
  check('set: Grizzled Edge x1.5 vs Physical Susceptibility', sheetBonus(r, 0, 'DamageBonus', 'Physical'), 0.27, 1e-9);
  r = crew([me('ZhuangFangyi', { gearPieces: set3('Eternal Xiranite') }), me('Perlica')]);
  r.run([script(0, function* (a) { a.applySusceptibility('Arts', 0.1, 5); })]);
  check('set: Eternal Xiranite gives OTHER teammates +16% when the wearer applies Susceptibility', sheetBonus(r, 1, 'DamageBonus') * 100 + sheetBonus(r, 0, 'DamageBonus'), 16 + 0, 1e-9);

  // In-game calibration (your measurements)
  const perlicaGear = ['Qingbo Light Armor', 'Eternal Xiranite Gloves T1', 'Qingbo Cask', 'Qingbo Cask'].map((n) => d.gear.byName(n));
  r = crew([{ operator: O.Perlica, potential: 5, weapon: d.weapons.WildWanderer, gearPieces: perlicaGear }]);
  r.run([step(0, 'BattleSkill')]);
  check('calibration: Perlica ATK 3365 / WIL 297 (Qingbo armor gives 26.9 Arts Intensity)', Math.round(r.operators[0].sheet.attack()) * 1000 + Math.round(r.operators[0].sheet.attribute('WIL')), 3366 * 1000 + 297, 1000);
  check('calibration: Perlica Battle Skill 9065', r.damageLog.find((h) => h.category === 'BattleSkill').damage / 9065, 1, 0.001);
  r = crew([{ operator: O.Perlica, potential: 5, weapon: d.weapons.WildWanderer, gearPieces: perlicaGear }]);
  r.run([...basicAttacks(0, 4), step(0, 'ComboSkill')]);
  check('calibration: Perlica Combo Skill 8186 (forced Electrification first, no initial hit)', r.damageLog.find((h) => h.category === 'ComboSkill').damage / 8186, 1, 0.001);
  const type42Unmaxed = { name: 'Type 42 (not maxed)', baseAttack: 505, modifiers: [E.mod('ATKBonus', 0.256)], triggers: [
    { on: 'ArtsBurst', when: ({ owner }) => owner.sheet.attribute('INT', true) < owner.sheet.attribute('WIL', true), give: E.dsl.give('enemy', 'T42Burst', [E.mod('DamageTaken', 0.096, ['Arts'])], 25) },
    { on: 'SusceptibilityApplied', when: ({ owner }) => owner.sheet.attribute('INT', true) < owner.sheet.attribute('WIL', true), give: E.dsl.give('enemy', 'T42Susceptibility', [E.mod('DamageTaken', 0.096, ['Arts'])], 25) }] };
  const natureEnemy = { ...d.enemies.TestDummy, resistance: { ...d.enemies.TestDummy.resistance, Nature: 30 } };
  r = crew([{ operator: O.Arcane, potential: 1, weapon: type42Unmaxed, gearPieces: [{ name: 'calibration', modifiers: [E.mod('INT', 242), E.mod('WIL', 435)] }] }, { operator: O.Perlica }], natureEnemy);
  r.run([script(1, function* (a) { a.applyInfliction('Electric'); }), step(0, 'ComboSkill'), script(0, function* () {}, { lock: 8 })]);
  const arcaneHits = r.damageLog.filter((h) => h.operator === 'Arcane');
  check('calibration: Arcane ATK 4620', r.operators[0].sheet.attack() / 4620, 1, 0.001);
  check('calibration: Arcane combo initial hit 2166', arcaneHits.find((h) => h.category === 'ComboSkill' && h.multiplier === 1.04).damage / 2166, 1, 0.001);
  check('calibration: Arcane Electric Burst 6407 (weapon triggers before the Burst damage)', arcaneHits.find((h) => h.subtype === 'ArtsBurst').damage / 6407, 1, 0.001);
  check('calibration: Arcane Explosion 3533 (P1 scales the Explosion)', arcaneHits.find((h) => h.category === 'ComboSkill' && h.multiplier > 1.5).damage / 3533, 1, 0.001);
  r = crew([me('ZhuangFangyi', { gearPieces: set3('Qingbo') })]);
  r.run([script(0, function* () {}, { category: 'ComboSkill' }), script(0, function* () {}, { category: 'ComboSkill' }), script(0, function* () {}, { category: 'ComboSkill' })]);
  check('set: Qingbo skill DMG +20% per combo cast, max 2 stacks (3 skill tags each)', r.operators[0].stackCount('QingboSkillDamage', r.now), 2);

  // Sequence builder logic
  const B = E.builder;
  let view = B.simulate(B.defaultState());
  check('builder: default state simulates (6 rows, damage > 0)', view.error ? -1 : view.rows.length * 1000 + (view.result.totalDamage > 0 ? 1 : 0), 6001);
  check('builder: Force of Nature shows up as an effect of the first row (operator column 0)', view.rows[0].effects[0].some((effect) => effect.name === 'ForceOfNature') ? 1 : 0, 1);
  check('builder: hits are attributed to their action', view.rows[0].damage > 0 && view.rows[5].damage > 0 ? 1 : 0, 1);
  check('builder: Sunderblade appears in the Team column', view.rows[0].effects[4].some((effect) => effect.name === 'Sunderblade') ? 1 : 0, 1);
  let state = B.defaultState(); state.actions.push({ slot: 2, action: 'BasicAttack', extraDelay: 0 });
  view = B.simulate(state);
  check('builder: action on an empty slot has no simulation record', view.rows[6].record === null ? 1 : 0, 1);
  state = B.defaultState(); state.team[1] = B.newSlot('Perlica', 'WildWanderer', []); state.actions.push({ slot: 1, action: 'DiveAttack', extraDelay: 0 });
  view = B.simulate(state);
  check('builder: Dive by a non-controlled operator is reported invalid', view.rows[6].record.invalid ? 1 : 0, 1);
  check('builder: HP follows 5 x STR', Math.round(B.slotStats(B.defaultState().team[0]).HP), Math.round(5495 + 5 * B.slotStats(B.defaultState().team[0]).STR));

  // Sequencing fixes: effects resolve at cast start, persistence, team effects, labels, controlled operator
  r = crew([me('ZhuangFangyi'), me('Perlica')]);
  r.run([...basicAttacks(0, 5), step(1, 'ComboSkill')]);
  check('sequencing: Perlica combo right after Fangyi Final Strike needs no padding (no warning)', warned(r, /combo/), 0);
  check('sequencing: Perlica combo starts at the Final Strike BATK start (4s), not after it', r.timeline[5].start, 4);
  r = crew([me('ZhuangFangyi', { startUltimateEnergy: 240 }), me('Perlica')]);
  r.run([step(0, 'Ultimate'), ...basicAttacks(0, 3), step(1, 'ComboSkill')]);
  check('sequencing: also in Fangyi ult form (3rd attack is the Final Strike)', warned(r, /combo/), 0);
  check('class: Fangyi is a Striker (no Messenger\'s Song efficiency)', ((x) => { x.run([]); const f = x.operators[1], p = x.operators[2]; f.sheet.currentTime = 0; p.sheet.currentTime = 0; return Math.round(f.sheet.sum('UltimateEfficiency') * 100) * 100 + Math.round(p.sheet.sum('UltimateEfficiency') * 100); })(crew([me('Gilberta'), me('ZhuangFangyi'), me('Perlica')])), 7);
  state = B.defaultState(); state.team[1] = B.newSlot('Liino', '', []); state.actions = [{ slot: 1, action: 'BattleSkill', extraDelay: 0 }, { slot: 1, action: 'BasicAttack', extraDelay: 0 }, { slot: 1, action: 'BattleSkill', extraDelay: 0 }];
  view = B.simulate(state);
  check('builder: team buffs show in the Team column, not on the operator', view.rows[0].effects[4].some((e) => e.name === 'LiinoStanceAttack') && !view.rows[0].effects[1].some((e) => e.name === 'LiinoStanceAttack') ? 1 : 0, 1);
  check('builder: effects persist on later rows while active', view.rows[1].effects[4].some((e) => e.name === 'LiinoStanceAttack' && !e.ended) ? 1 : 0, 1);
  check('builder: End Stance row shows the stance as ended', view.rows[2].effects[1].some((e) => e.name === 'Vocalist Stance' && e.ended) && view.rows[2].label === 'End Stance' ? 1 : 0, 1);
  view = B.simulate(B.defaultState());
  check('builder: Force of Nature stays listed on the last row', view.rows[5].effects[0].some((e) => e.name === 'ForceOfNature' && !e.ended) ? 1 : 0, 1);
  check('builder: BATK labels (BATK 1 ... BATK 3)', same(view.rows[1].label + '|' + view.rows[3].label, 'BATK 1|BATK 3'), 1);

  // Consumables, tacticals, UE pool, quality, team-effect scope
  check('consumables: 36 loaded; Ginseng Meat Stew = ATK +180, Crit Rate +11.44%', Object.keys(d.consumables).length * 100 + d.consumables.GinsengMeatStew.modifiers.length, 3602);
  r = crew([me('ZhuangFangyi', { consumable: d.consumables.JakubsLegacy })]);
  r.run([step(0, 'BasicAttack'), step(0, 'BasicAttack', { extraDelay: 300 })]);
  check('consumable: ATK +27% from the battle start, gone after 300s', ((x, t1, t2) => { x.operators[0].sheet.currentTime = t1; const a = x.operators[0].sheet.sum('ATKBonus'); x.operators[0].sheet.currentTime = t2; return a * 100 + x.operators[0].sheet.sum('ATKBonus'); })(r, 1, 301), 27);
  r = crew([me('ZhuangFangyi', { tactical: d.tacticals.StewMeeting })]); r.run([]);
  check('tactical: triggers anytime UE < 50% (0 -> 144 UE, 3 of 4 uses)', r.operators[0].ultimateEnergy * 10 + r.operators[0].tacticalUses, 1441);
  r = crew([me('ZhuangFangyi', { tactical: d.tacticals.MiniHoneySlugpudding }), me('Perlica')]); r.run([]);
  check('tactical: team tactical gives every operator 8% of its own max UE per use (4 uses)', Math.round(r.operators[0].ultimateEnergy * 10) * 1000 + Math.round(r.operators[1].ultimateEnergy * 10), 768256);
  r = crew([me('ZhuangFangyi', { tactical: d.tacticals.HerbalTisane, startUltimateEnergy: 240 })]);
  r.run([step(0, 'Tactical'), step(0, 'Tactical'), step(0, 'Tactical'), step(0, 'Tactical')]);
  check('tactical: manual use takes no time/lock; 3 uses, the 4th is invalid', r.timeline[2].end * 100 + (r.timeline[3].invalid ? 1 : 0) + r.operators[0].tacticalUses * 10, 1);
  r = crew([me('ZhuangFangyi', { startUltimateEnergy: 235 })]);
  r.run([script(0, function* (a) { a.gainUltimateEnergy(20); })]);
  check('UE: overflow above the pool (240) is lost', r.operators[0].ultimateEnergy, 240);
  r = crew([me('ZhuangFangyi', { startUltimateEnergy: 240, tactical: d.tacticals.StewMeeting })]);
  r.run([step(0, 'Ultimate')]);
  check('tactical: triggers after the ultimate drains UE (even in the form that blocks UE gain)', Math.round(r.operators[0].ultimateEnergy), 144);
  r = crew([me('Liino'), me('Perlica')]);
  r.run([step(0, 'BattleSkill'), script(1, function* (a) { a.applyReaction('Electric', 1); }, { extraDelay: 1.5 }), step(0, 'ComboSkill'), step(1, 'BattleSkill')]);
  const starry = r.effectTimeline.find((e) => e.name === 'Starry Boost of 1st Magnitude');
  check('Liino: Starry Boost is a Team status, ends when a Battle Skill triggers it', starry && starry.target === 'Team' && starry.end < 31 ? 1 : 0, 1);
  state = B.defaultState(); state.team[0] = B.newSlot('Perlica', '', []); state.team[1] = B.newSlot('Gilberta', '', []); state.actions = [{ slot: 1, action: 'BattleSkill', extraDelay: 0 }];
  view = B.simulate(state);
  check("builder: partial-team effects (Messenger's Song) show on each recipient, not in the Team column", view.rows[0].effects[0].some((e) => e.name === 'MessengersSong') && view.rows[0].effects[1].some((e) => e.name === 'MessengersSong') && !view.rows[0].effects[4].some((e) => e.name === 'MessengersSong') ? 1 : 0, 1);
  check('builder: UE end shows the pool (240) and stagger end is reported', view.finalUE.find(([i]) => i === 1)[2] * 1000 + (view.finalStagger.capacity > 0 ? 1 : 0), 90001);
  check('quality: Perlica is 5 stars, default 6', (O.Perlica.stars || 6) * 10 + (O.Arcane.stars || 6), 56);
  state = B.defaultState(); state.team[0].consumable = 'JakubsLegacy'; state.team[0].tactical = 'StewMeeting';
  check('builder: shown ATK includes the consumable', B.slotStats(state.team[0]).ATK / B.slotStats(B.defaultState().team[0]).ATK > 1.1 ? 1 : 0, 1);

  // Calibration against the game (reported, not pass/fail): Fangyi P0, BS with 0 blades, weapon Electric 25.6%.
  const calibrationSheet = E.buildStatSheet({ operator: d.operators.ZhuangFangyi, potential: 0, weapon: currentWeapon,
    gearPieces: [d.gear.byName('Xiranflow Light Armor'), d.gear.byName('Xiranflow Gloves'), d.gear.byName('Xiranflow Baton'), d.gear.byName('LYNX Slab')], setBonuses: d.gear.setBonuses });
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
