// Operators: stars (quality) default to 6 when omitted. Stats, passives (potential-gated), triggers (talents) and kit (BATK, skills, forms). verified:false until you confirm.
// All casts take 1s unless stated. Hits land at the end of their slice. Cooldowns are informational only (combo skills have no cooldown).
// Skill scripts are generators: `yield ability.wait(s)` advances ability-local time; see sim.js (AbilityContext) for the available calls.
(function () {
  const E = globalThis.Endfield, { mod } = E, { dmg, atk, intensity, give } = E.dsl;
  const operators = (E.data.operators = E.data.operators || {});
  const batk = (multipliers, stagger) => multipliers.map((multiplier, i) => ({ multiplier, duration: 1, ...(i === multipliers.length - 1 ? { finalStrike: true, stagger, skillPointsRestored: 20 } : {}) }));
  const P = (potential, ...modifiers) => ({ name: 'P' + potential, minPotential: potential, modifiers });
  const enemyInflictionElement = (simulation) => (simulation.enemy.status.activeInfliction() || {}).element;
  const hasVulnerable = (ability) => ability.enemy.status.vulnerableStacks(ability.now) > 0;
  const vulnerableStacksAfter = ({ event }) => Math.min(4, event.stacksBefore + event.count);

  // =============================== Zhuang Fangyi ===============================
  const electricInflicted = ({ simulation }) => enemyInflictionElement(simulation) === 'Electric';
  operators.ZhuangFangyi = {
    ultimateEnergyCost: 240, name: 'Zhuang Fangyi', class: 'Striker', element: 'Electric', weaponType: 'Arts Unit', mainAttribute: 'WIL', secondaryAttribute: 'INT', verified: false,
    baseStats: { HP: 5495, ATK: 326, STR: 99, AGL: 99, INT: 123, WIL: 184 },
    passives: [{ name: 'Talent: WIL +60', modifiers: [mod('WIL', 60)] }, P(2, mod('WIL', 20), mod('DamageBonus', 0.15, ['BattleSkill'])), P(4, mod('UltimateEnergyCost', -0.15))],
    kit: {
      basicAttackElement: 'Electric',
      basicAttackSequence: batk([0.36, 0.54, 0.72, 1.01, 1.08], 18),
      forms: { Empyrean: { label: 'ULT', basicAttackSequence: batk([1.5, 2.1, 3.0], 18), disablesFinisher: true } },
      battleSkill: {
        *run(ability) {
          const operator = ability.operator, ultimateActive = operator.inForm('Empyrean', ability.now), potential = ability.potential;
          const applyForceOfNature = (value) => ability.applyEffect('ForceOfNature', [mod('Amp', value, ['Electric'])], 5, { value });
          const free = Boolean(operator.flags.freeBattleSkill); // first cast after the ultimate: no SP, no Electrification consumed, 3 blades
          operator.flags.freeBattleSkill = false;
          const consumedElectrificationLevel = free ? 0 : ability.consumeReaction('Electrification');
          if (!free) ability.spendSkillPoints(100);
          let sunderbladesToCreate = free ? 3 : Math.min(3, consumedElectrificationLevel + 1);
          if (potential >= 1 && !operator.flags.firstBattleSkillDone) sunderbladesToCreate += 1; // may exceed the cap of 3
          operator.flags.firstBattleSkillDone = true;
          ability.team.addStacks('Sunderblade', sunderbladesToCreate, 36 + (potential >= 3 ? 10 : 0), 9, ability.now); // wiki: 36s (you think 45s)
          if (consumedElectrificationLevel > 0 && potential >= 3) ability.returnSkillPoints(10);
          applyForceOfNature(0.18);
          const sunderbladeCount = ability.team.countStacks('Sunderblade', ability.now);
          ability.lockFor(ultimateActive ? 0.3 : 0.3 + 0.1 * sunderbladeCount);
          ability.setLabel(ultimateActive ? (free ? 'ULT Battle Skill (free)' : 'ULT Battle Skill') : 'Battle Skill');
          for (let hitNumber = 1; hitNumber <= sunderbladeCount; hitNumber++) { // everything resolves at cast start; the hits are 0.1s apart
            if (hitNumber > 1) ability.advance(0.1);
            applyForceOfNature(operator.effects.ForceOfNature.state.value + 0.02); // measured: +2% applies before the hit's damage
            const base = ultimateActive ? 0.81 + 0.18 * consumedElectrificationLevel : 0.45 + 0.09 * consumedElectrificationLevel;
            ability.hit({ element: 'Electric', category: 'BattleSkill', multiplier: base * (hitNumber === sunderbladeCount ? 6 : 1) * (potential >= 1 ? 1.15 : 1) });
            ability.gainUltimateEnergy(6);
          }
          if (ultimateActive) ability.applyInfliction('Electric', 1);
          ability.dealStagger(15);
        },
      },
      comboSkill: {
        cooldown: 17, // /4 during the ultimate
        windowTriggers: [{ on: 'FinalStrike', when: electricInflicted }, { on: 'Finisher', when: electricInflicted }],
        *run(ability) {
          const ultimateActive = ability.operator.inForm('Empyrean', ability.now);
          ability.lockFor(0.5);
          ability.hit({ element: 'Electric', category: 'ComboSkill', multiplier: ultimateActive ? 5.4 : 3.6 });
          ability.dealStagger(10);
          const consumedStacks = ability.consumeInfliction('Electric');
          if (consumedStacks > 0) {
            const hadElectrification = ability.enemy.status.reactionLevel('Electrification') > 0;
            ability.applyReaction('Electric', Math.min(4, hadElectrification ? consumedStacks + 1 : consumedStacks));
            ability.gainUltimateEnergy(10 * consumedStacks);
          }
        },
      },
      ultimate: {
        *run(ability) { // the 3s cinematic takes no combat time
          ability.spendUltimateEnergy(240); ability.lockFor(0);
          ability.enterForm('Empyrean', 25);
          ability.operator.flags.freeBattleSkill = true;
          ability.operator.flags.blockUltimateEnergyUntil = ability.now + 25;
          ability.operator.sheet.removeModifiersFrom('form:Empyrean'); // P5: part of the form itself, not a separate buff
          if (ability.potential >= 5) ability.operator.sheet.addModifiers([{ ...mod('IgnoreResistance', 15, ['Electric']), expires: ability.now + 25 }], 'form:Empyrean');
        },
      },
    },
  };

  // =============================== Perlica ===============================
  operators.Perlica = {
    stars: 5, ultimateEnergyCost: 80, name: 'Perlica', class: 'Caster', element: 'Electric', weaponType: 'Arts Unit', mainAttribute: 'INT', secondaryAttribute: 'WIL', verified: false,
    baseStats: { HP: 5495, ATK: 303, STR: 91, AGL: 93, INT: 161, WIL: 113 },
    passives: [{ name: 'Keen Mind: INT +60', modifiers: [mod('INT', 60)] }, { name: 'Obliteration Protocol', modifiers: [dmg(0.30, 'Staggered')] }, P(2, mod('UltimateEnergyCost', -0.15))],
    triggers: [{ on: 'ReactionApplied', when: ({ event, owner }) => owner.potential >= 3 && event.name === 'Electrification', // P3
      give: give('self', 'PerlicaP3', [atk(0.20)], 5, { maxStacks: 2 }) }],
    kit: {
      basicAttackElement: 'Electric',
      basicAttackSequence: batk([0.57, 0.68, 0.84, 1.27], 15),
      battleSkill: { *run(ability) {
        ability.spendSkillPoints(100);
        ability.hit({ element: 'Electric', category: 'BattleSkill', multiplier: 4.0 });
        ability.applyInfliction('Electric', 1); ability.dealStagger(10);
      } },
      comboSkill: {
        cooldown: 19, windowTriggers: [{ on: 'FinalStrike' }], // any controlled operator's Final Strike
        *run(ability) {
          const potential = ability.potential;

          // measured order: the forced Electrification (level 1, no initial hit) and everything it triggers come BEFORE the damage
          ability.applyReaction('Electric', 1, { duration: 5 * (potential >= 1 ? 1.75 : 1), debuffScale: potential >= 4 ? 1.33 : 1 });
          ability.hit({ element: 'Electric', category: 'ComboSkill', multiplier: 1.8 }); // Cycle Protocol never chains with a single enemy
          ability.dealStagger(10);
          ability.gainUltimateEnergy(10);
        },
      },
      ultimate: { *run(ability) {
        ability.spendUltimateEnergy(80);
        ability.hit({ element: 'Electric', category: 'Ultimate', multiplier: 10.0, extraCriticalRate: ability.potential >= 5 ? 0.30 : 0 });
        ability.dealStagger(20);
      } },
    },
  };

  // =============================== Liino ===============================
  const stanceActive = (operator, now) => Boolean(operator.stance && operator.stance.until > now);
  const vocalistActive = (operator, now) => stanceActive(operator, now) && operator.stance.name === 'Vocalist'; // combo does not trigger in Cosmovoice
  const endStance = (ability) => {
    const operator = ability.operator;
    if (operator.stance) {
      operator.stance.ended = true; ability.simulation.endEffect(operator.stance.record);
      for (const name of ['LiinoStanceAttack', 'LiinoCosmovoiceAmp']) ability.simulation.endEffectsNamed('Team', name);
    }
    operator.stance = null;
    for (const member of ability.simulation.operators) for (const name of ['LiinoStanceAttack', 'LiinoCosmovoiceAmp']) { member.sheet.removeModifiersFrom('effect:' + name); delete member.effects[name]; }
  };
  const startStance = (ability, name, duration, effects) => {
    endStance(ability);
    const stance = { name, until: ability.now + duration, ended: false };
    stance.record = ability.simulation.logEffect(ability.operator.name, name + ' Stance', { end: stance.until });
    ability.operator.stance = stance;
    for (const [effectName, mods] of effects) ability.simulation.giveEffect(give('team', effectName, mods, duration), { owner: ability.operator, now: ability.now, event: {} });
    return stance;
  };
  operators.Liino = {
    ultimateEnergyCost: 160, name: 'Liino', class: 'Supporter', element: 'Electric', weaponType: 'Polearm', mainAttribute: 'WIL', secondaryAttribute: 'AGL', verified: false,
    baseStats: { HP: 5495, ATK: 309, STR: 89, AGL: 121, INT: 91, WIL: 177 },
    passives: [{ name: 'Stalwart: WIL +60', modifiers: [mod('WIL', 60)] }, P(2, mod('WIL', 20), mod('TreatmentBonus', 0.10)), P(4, mod('UltimateEnergyCost', -0.15))],
    triggers: [{ on: 'SkillCast', by: 'any', // talent: Starry Boost of 1st Magnitude (30s after her combo skill, an Electric/Nature battle skill returns 10 SP; ends after triggering)
      when: ({ event, simulation, now }) => event.category === 'BattleSkill' && ['Electric', 'Nature'].includes(event.source.operator.definition.element) && (simulation.flags.starryBoostUntil || 0) > now,
      apply: ({ event, simulation }) => { simulation.flags.starryBoostUntil = 0; simulation.endEffectsNamed('Team', 'Starry Boost of 1st Magnitude'); event.source.returnSkillPoints(10); } }],
    kit: {
      basicAttackElement: 'Electric',
      basicAttackSequence: batk([0.42, 0.60, 0.60, 0.81, 1.00], 19),
      battleSkill: { *run(ability) {
        const operator = ability.operator, potential = ability.potential, scale = potential >= 5 ? 1.2 : 1;
        if (operator.stance) { endStance(ability); ability.setLabel('End Stance'); return; } // "End Stance": free (the short cooldown is ignored)
        ability.spendSkillPoints(25);
        if (potential >= 1 && !operator.flags.firstBattleSkillDone) ability.returnSkillPoints(25);
        operator.flags.firstBattleSkillDone = true;

        ability.hit({ element: 'Electric', category: 'BattleSkill', multiplier: 2.4 * scale }); ability.dealStagger(3);
        const stance = startStance(ability, 'Vocalist', 60, [['LiinoStanceAttack', [atk(0.10 + (potential >= 1 ? 0.06 : 0))]]]);
        ability.background((function* () { // Additional ATK every 10s (assumed: first at +10s, category BattleSkill)
          for (let elapsed = 10; elapsed <= 60; elapsed += 10) {
            yield ability.wait(10);
            if (stance.ended) return;
            ability.hit({ element: 'Electric', category: 'BattleSkill', multiplier: 1.2 * scale });
          }
        })());
      } },
      comboSkill: {
        cooldown: 8,
        windowTriggers: [{ on: 'ReactionApplied', when: ({ owner, now }) => vocalistActive(owner, now) }, { on: 'ReactionConsumed', when: ({ owner, now }) => vocalistActive(owner, now) }],
        *run(ability) {

          ability.hit({ element: 'Electric', category: 'ComboSkill', multiplier: 3.6 * (ability.potential >= 3 ? 1.4 : 1) });
          ability.dealStagger(5); ability.gainUltimateEnergy(20);
          ability.grantTreatment([ability.simulation.controlled]);
          ability.simulation.flags.starryBoostUntil = ability.now + 30;
          ability.simulation.logEffect('Team', 'Starry Boost of 1st Magnitude', { end: ability.now + 30 }); // a team status in game
        },
      },
      ultimate: { *run(ability) {
        const potential = ability.potential, scale = potential >= 5 ? 1.2 : 1;
        ability.spendUltimateEnergy(160); // two hits: the 1s is split into 2 slices, each hit at the start of its slice
        ability.grantTreatment();
        const amp = Math.min(0.60, 0.0004 * ability.operator.sheet.attribute('WIL')) * (potential >= 5 ? 1.2 : 1); // Amp from Will (assumed no base value)
        const stance = startStance(ability, 'Cosmovoice', 15, [['LiinoStanceAttack', [atk(0.10 + (potential >= 1 ? 0.06 : 0))]], ['LiinoCosmovoiceAmp', [mod('Amp', amp, ['Electric']), mod('Amp', amp, ['Nature'])]]]);
        ability.announce('AmpGranted');
        ability.hit({ element: 'Electric', category: 'Ultimate', multiplier: 3.2 * scale }); // Stage Pyrotechnics
        ability.advance(0.5);
        ability.hit({ element: 'Electric', category: 'Ultimate', multiplier: 6.4 * scale }); // Electrifying Extravaganza
        ability.applyReaction('Electric', 1); // assumption: forced Electrification level 1
        ability.dealStagger(20);
        ability.background((function* () {
          for (let beat = 1; beat <= 10; beat++) { yield ability.wait(1.5); if (stance.ended) return; ability.hit({ element: 'Electric', category: 'Ultimate', multiplier: 0.6 * scale }); }
          if (!stance.ended) ability.hit({ element: 'Electric', category: 'Ultimate', multiplier: 1.8 * scale }); // 3x a beat when the stance runs out
        })());
      } },
    },
  };

  // =============================== Arcane ===============================
  const arcaneMode = (operator) => (operator.sheet.attribute('INT', true) >= operator.sheet.attribute('WIL', true) ? 'INT' : 'WIL');
  const arrayActive = (operator, now) => Boolean(operator.array && operator.array.until > now);
  const willSusceptibility = (ability) => {
    if (arcaneMode(ability.operator) !== 'WIL') return;
    const value = Math.min(0.128, 0.0002 * ability.operator.sheet.attribute('WIL')) + (ability.potential >= 5 ? 0.07 : 0); // live WIL, frozen at application
    ability.applySusceptibility('Nature', value, 10); ability.applySusceptibility('Cryo', value, 10);
  };
  const explosionMultiplier = (potential) => 1.2 * (potential >= 1 ? 1.3 : 1); // P1 scales the whole combo skill, Explosion included (measured)
  const clusterStrike = ({ owner, simulation }) => {
    const array = owner.array;
    if (array.strikes >= 2) return;
    const ability = simulation.contextFor(owner, 'Ultimate');
    ability.hit({ element: 'Nature', category: 'Ultimate', multiplier: 3.6 }); willSusceptibility(ability);
    if (++array.strikes >= 2) array.arcanaReady = true;
  };
  operators.Arcane = {
    ultimateEnergyCost: 100, name: 'Arcane', class: 'Caster', element: 'Nature', weaponType: 'Arts Unit', mainAttribute: 'INT', secondaryAttribute: 'WIL', verified: false,
    baseStats: { HP: 5495, ATK: 312, STR: 91, AGL: 93, INT: 176, WIL: 121 },
    passives: [{ name: 'Keen Mind/Stalwart', modifiers: [mod('INT', 43), mod('WIL', 43)] }, P(2, mod('INT', 15), mod('WIL', 15), mod('ArtsIntensity', 16)), P(4, mod('UltimateEnergyCost', -0.15))],
    // Weapon Honing: Corrosion applied by Arcane lasts +10s (+5 at P3) and its max resistance reduction is x1.1 (+0.2 at P3)
    reactionOptions: (ability, element) => (element === 'Nature' ? { duration: 25 + (ability.potential >= 3 ? 5 : 0), shredScale: 1.1 + (ability.potential >= 3 ? 0.2 : 0) } : undefined),
    triggers: [{ on: 'FinalStrike', by: 'any', when: ({ owner, now }) => arrayActive(owner, now), apply: clusterStrike },
      { on: 'Finisher', by: 'any', when: ({ owner, now }) => arrayActive(owner, now), apply: clusterStrike }],
    kit: {
      basicAttackElement: 'Nature',
      basicAttackSequence: batk([0.42, 0.48, 0.75, 0.80, 1.06], 17),
      battleSkill: { *run(ability) {
        const operator = ability.operator, mode = arcaneMode(operator), potential = ability.potential;
        ability.spendSkillPoints(100);
        ability.setLabel('Battle Skill (' + mode + ')');
        ability.hit({ element: 'Nature', category: 'BattleSkill', multiplier: mode === 'INT' ? 5.0 : 3.0 });
        ability.applyInfliction('Nature', 1); ability.dealStagger(10);
        if (mode === 'INT' && ability.enemy.status.isImprisoned(ability.now)) { // INT array: hitting an imprisoned enemy
          ability.returnSkillPoints(30 + (potential >= 1 ? 10 : 0));
          ability.endImprisonment();
          ability.hit({ element: 'Nature', category: 'ComboSkill', multiplier: explosionMultiplier(potential) }); ability.dealStagger(5); // Explosion (assumed ComboSkill category)
          ability.applySusceptibility('Nature', 0.04, 2); ability.applySusceptibility('Cryo', 0.04, 2);
          ability.advance(0.5); ability.hit({ element: 'Nature', category: 'ComboSkill', multiplier: 5.0 }); // bonus hits after a short delay (assumed 0.5s, one hit)
        }
      } },
      comboSkill: {
        cooldown: 18,
        windowTriggers: [
          { on: 'InflictionBatch', when: ({ event, owner }) => arcaneMode(owner) === 'INT' && (event.element === 'Nature' || event.stacks >= 2) },
          { on: 'InflictionBatch', when: ({ owner }) => arcaneMode(owner) === 'WIL' }],
        *run(ability) {
          const operator = ability.operator, mode = arcaneMode(operator), potential = ability.potential;

          // measured order: Susceptibility (+ its weapon triggers) -> initial hit -> infliction/Burst -> Imprisonment ... Explosion when it ends
          const willBonus = Math.min(0.08, (0.08 * operator.sheet.attribute('WIL')) / 640);
          const susceptibility = mode === 'INT' ? 0.04 : 0.04 + willBonus + (potential >= 1 ? 0.06 : 0);
          const duration = mode === 'INT' ? 4 : 6;
          ability.applySusceptibility('Nature', susceptibility, duration); ability.applySusceptibility('Cryo', susceptibility, duration);
          ability.hit({ element: 'Nature', category: 'ComboSkill', multiplier: 0.8 * (potential >= 1 ? 1.3 : 1) }); // 80% = the 4 Tactical Doubles together (one hit)
          ability.dealStagger(5);
          if (mode === 'WIL') { const element = enemyInflictionElement(ability.simulation); if (element) ability.applyInfliction(element, 1); }
          ability.applyImprisonment(duration, () => { ability.hit({ element: 'Nature', category: 'ComboSkill', multiplier: explosionMultiplier(potential) }); ability.dealStagger(5); }); // Explosion when it ends
          ability.gainUltimateEnergy(10);
        },
      },
      ultimate: { *run(ability) {
        const operator = ability.operator, mode = arcaneMode(operator), potential = ability.potential;
        const array = operator.array && operator.array.until > ability.now ? operator.array : null;
        if (array && array.arcanaReady) { // Gloompurge Arcana: the ultimate switches after 2 Cluster Strikes (assumed free)
          ability.setLabel('Gloompurge Arcana');

          ability.hit({ element: 'Nature', category: 'Ultimate', multiplier: mode === 'INT' ? 14.4 * (potential >= 5 ? 1.3 : 1) : 3.6 });
          ability.dealStagger(10); willSusceptibility(ability); ability.endState(operator.array.record); operator.array = null;
          return;
        }
        ability.spendUltimateEnergy(100);
        ability.hit({ element: 'Nature', category: 'Ultimate', multiplier: 1.8 }); ability.dealStagger(10);
        if (mode === 'INT') {
          ability.applyReaction('Nature', 1); // forced Corrosion (assumed level 1; Weapon Honing applies via reactionOptions)
          ability.applyEffect('GloompurgeAmp', [mod('Amp', 0.24 + (potential >= 5 ? 0.16 : 0), ['Arts'])], 20, {});
        } else {
          const element = enemyInflictionElement(ability.simulation); if (element) ability.applyInfliction(element, 1);
          willSusceptibility(ability);
        }
        operator.array = { until: ability.now + 20, strikes: 0, arcanaReady: false, record: ability.trackState('Gloompurge Array', 20) };
      } },
    },
  };

  // =============================== Gilberta ===============================
  operators.Gilberta = {
    ultimateEnergyCost: 90, name: 'Gilberta', class: 'Supporter', element: 'Nature', weaponType: 'Arts Unit', mainAttribute: 'WIL', secondaryAttribute: 'INT', verified: false,
    baseStats: { HP: 5495, ATK: 329, STR: 89, AGL: 92, INT: 127, WIL: 171 },
    passives: [{ name: 'Stalwart: WIL +60', modifiers: [mod('WIL', 60)] }, P(4, mod('UltimateEnergyCost', -0.15))],
    triggers: [{ on: 'BattleStart', // Messenger's Song: guards, casters and supporters gain Ultimate Efficiency +7% (+5% at P3)
      give: give('classes', 'MessengersSong', ({ owner }) => [mod('UltimateEfficiency', 0.07 + (owner.potential >= 3 ? 0.05 : 0))], Infinity, { classes: ['Guard', 'Caster', 'Supporter'] }) }],
    kit: {
      basicAttackElement: 'Nature',
      basicAttackSequence: batk([0.68, 0.81, 0.91, 1.12], 16),
      battleSkill: { *run(ability) {
        ability.spendSkillPoints(100);
        ability.hit({ element: 'Nature', category: 'BattleSkill', multiplier: 2.19 }); // gravity pull (1s split into 2 slices, each hit at the start of its slice)
        ability.advance(0.5);
        ability.hit({ element: 'Nature', category: 'BattleSkill', multiplier: 1.3 }); // explosion
        ability.applyInfliction('Nature', 1); ability.dealStagger(10);
      } },
      comboSkill: {
        cooldown: 19, windowTriggers: [{ on: 'ReactionApplied' }],
        *run(ability) {

          ability.hit({ element: 'Nature', category: 'ComboSkill', multiplier: 3.15 * (ability.potential >= 5 ? 1.3 : 1) });
          ability.dealStagger(5);
          ability.applyPhysicalStatus('Lift', { forced: true });
          ability.gainUltimateEnergy(10);
        },
      },
      ultimate: { *run(ability) {
        const potential = ability.potential;
        ability.spendUltimateEnergy(90);
        ability.hit({ element: 'Nature', category: 'Ultimate', multiplier: 7.5 });
        ability.dealStagger(20); ability.applyInfliction('Nature', 1);
        // Arts Susceptibility follows the Vulnerable stacks while the enemy is in the 5s field (re-evaluated per hit)
        ability.applyDynamicSusceptibility('Arts', 5, (time) => 0.30 + 0.03 * (potential >= 2 ? 2 : 1) * Math.min(4, ability.enemy.status.vulnerableStacks(time) + (potential >= 2 ? 1 : 0)));
        ability.extendLift(ability.now + 5);
      } },
    },
  };

  // =============================== Mi Fu ===============================
  operators.MiFu = {
    ultimateEnergyCost: 80, name: 'Mi Fu', class: 'Guard', element: 'Physical', weaponType: 'Great Sword', mainAttribute: 'STR', secondaryAttribute: 'WIL', verified: false,
    baseStats: { HP: 5495, ATK: 315, STR: 173, AGL: 92, INT: 90, WIL: 119 },
    passives: [{ name: 'Forged: STR +60', modifiers: [mod('STR', 60)] }, P(2, mod('STR', 20), mod('ArtsIntensity', 16)), P(4, mod('UltimateEnergyCost', -0.15))],
    kit: {
      basicAttackElement: 'Physical',
      basicAttackSequence: batk([0.76, 0.86, 1.36, 1.72], 25),
      battleSkill: { *run(ability) { // Qingbo Triplex: move 1 Cloudtrapper -> 2 Trail and Mangle -> (3+ Vulnerable consumed) 3 World Splitter
        const operator = ability.operator, scale = ability.potential >= 5 ? 1.1 : 1, move = operator.flags.battleSkillMove || 1;
        if (move === 1) {
          ability.setLabel('Battle Skill 1: Cloudtrapper'); ability.spendSkillPoints(100); ability.returnSkillPoints(50);
          ability.hit({ element: 'Physical', category: 'BattleSkill', multiplier: 1.5 * scale });
          operator.flags.battleSkillMove = 2;
        } else if (move === 2) {
          ability.setLabel('Battle Skill 2: Trail and Mangle'); ability.spendSkillPoints(50);
          ability.hit({ element: 'Physical', category: 'BattleSkill', multiplier: 2.0 * scale }); ability.dealStagger(5);
          const crush = ability.applyPhysicalStatus('Crush');
          operator.flags.battleSkillMove = crush.effective && crush.stacksConsumed >= 3 ? 3 : 1;
        } else {
          ability.setLabel('Battle Skill 3: World Splitter'); ability.spendSkillPoints(50);
          const boosted = ability.enemy.status.hasSusceptibility('Physical', ability.now) || ability.enemy.isStaggered(ability.now); // Stern Crackdown
          ability.hit({ element: 'Physical', category: 'Status', subtype: 'PhysicalStatus', statusKind: 'PhysicalStatus', multiplier: 6.0 * scale * (boosted ? 1.2 : 1) }); // counts as Crush damage
          ability.dealStagger(10);
          operator.flags.battleSkillMove = 1;
        }
      } },
      comboSkill: {
        cooldown: 19, windowTriggers: [{ on: 'VulnerableApplied', when: (context) => vulnerableStacksAfter(context) >= 3 }],
        *run(ability) {
          const operator = ability.operator, potential = ability.potential;

          ability.hit({ element: 'Physical', category: 'ComboSkill', multiplier: 2.5 }); ability.dealStagger(10);
          ability.applySusceptibility('Physical', 0.05 + (potential >= 1 ? 0.05 : 0), 16 + (potential >= 1 ? 4 : 0));
          operator.flags.battleSkillMove = 2; ability.gainUltimateEnergy(10);
          // Vigilant Fury shield (every 60s, 45s at P3); P3: +6% ATK for 20s each time it triggers
          if (ability.now - (operator.flags.shieldAt === undefined ? -Infinity : operator.flags.shieldAt) >= (potential >= 3 ? 45 : 60)) {
            operator.flags.shieldAt = ability.now;
            if (potential >= 3) ability.applyEffect('VigilantFuryAttack', [atk(0.06)], 20, {});
          }
        },
      },
      ultimate: { *run(ability) {
        ability.spendUltimateEnergy(80);
        ability.applyPhysicalStatus('Lift', { forced: true });
        ability.hit({ element: 'Physical', category: 'Ultimate', multiplier: 7.0 });
        ability.dealStagger(20 + (ability.potential >= 5 ? 5 : 0));
        ability.operator.flags.battleSkillMove = 2;
      } },
    },
  };
  E.opkit = { batk, P, enemyInflictionElement, hasVulnerable, vulnerableStacksAfter }; // shared with operators2.js
})();
