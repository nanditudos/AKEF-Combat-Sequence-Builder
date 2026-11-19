// Operators, batch 2 (F2P roster). Implemented so far: Estella. The rest of the batch is still to do.
// Assumptions are marked "assumption". Talents that only heal/shield are not modeled. Cooldowns are informational.
(function () {
  const E = globalThis.Endfield, { mod } = E, K = E.opkit, { batk, P } = K, { dmg, atk, intensity, give } = E.dsl;
  const operators = E.data.operators;
  const hit = (ability, element, category, multiplier, extra = {}) => ability.hit({ element, category, multiplier, ...extra });

  // =============================== Estella (4 star Guard) ===============================
  operators.Estella = {
    stars: 4, ultimateEnergyCost: 70, name: 'Estella', class: 'Guard', element: 'Cryo', weaponType: 'Polearm', mainAttribute: 'WIL', secondaryAttribute: 'STR', verified: false,
    baseStats: { HP: 5495, ATK: 312, STR: 104, AGL: 97, INT: 110, WIL: 151 },
    passives: [{ name: 'Talent: WIL +60', modifiers: [mod('WIL', 60)] }, P(2, mod('UltimateEnergyCost', -0.1)), P(4, mod('WIL', 10), mod('STR', 10))],
    triggers: [
      { on: 'Shatter', apply: ({ owner }) => { owner.flags.commiseration = true; } }, // Commiseration: Shatter -> the next Battle Skill returns 15 SP (cannot stack)
      { on: 'ReactionApplied', cooldown: 1, when: ({ event, owner }) => owner.potential >= 5 && event.name === 'Solidification', // P5
        apply: ({ event }) => event.source.gainUltimateEnergy(5) },
    ],
    kit: {
      basicAttackElement: 'Physical',
      basicAttackSequence: batk([0.56, 0.68, 0.79, 0.90], 17),
      battleSkill: { *run(ability) {
        const operator = ability.operator;
        ability.spendSkillPoints(100);
        if (operator.flags.commiseration) { ability.returnSkillPoints(15); operator.flags.commiseration = false; }
        hit(ability, 'Cryo', 'BattleSkill', 3.5 * (ability.potential >= 3 ? 1.4 : 1)); // P3: +40% to the first enemy hit (one enemy: always)
        ability.applyInfliction('Cryo', 1);
        ability.dealStagger(10);
      } },
      comboSkill: {
        cooldown: 17, windowTriggers: [{ on: 'ReactionApplied', when: ({ event }) => event.name === 'Solidification' }],
        *run(ability) {
          const solidified = ability.enemy.status.reactionLevel('Solidification', ability.now) > 0;
          if (solidified) ability.applySusceptibility('Physical', 0.15, 6 + (ability.potential >= 1 ? 3 : 0)); // assumption: applied before the hit, as measured for Arcane
          hit(ability, 'Physical', 'ComboSkill', solidified ? 6.3 : 3.6);
          ability.dealStagger(10);
          ability.applyPhysicalStatus('Lift', { forced: true }); // forced Lift: Shatter pops the Solidification
          ability.gainUltimateEnergy(10);
        },
      },
      ultimate: { *run(ability) {
        ability.spendUltimateEnergy(70);
        hit(ability, 'Physical', 'Ultimate', 11.0);
        ability.dealStagger(20);
        if (ability.enemy.status.hasSusceptibility('Physical', ability.now)) ability.applyPhysicalStatus('Lift', { forced: true });
      } },
    },
  };
  // =============================== Catcher (4 star Defender) ===============================
  operators.Catcher = {
    stars: 4, ultimateEnergyCost: 80, name: 'Catcher', class: 'Defender', element: 'Physical', weaponType: 'Great Sword', mainAttribute: 'STR', secondaryAttribute: 'WIL', verified: false,
    baseStats: { HP: 5495, ATK: 300, STR: 176, AGL: 96, INT: 86, WIL: 106 },
    passives: [{ name: 'Talent: STR +60', modifiers: [mod('STR', 60)] }, P(4, mod('UltimateEnergyCost', -0.1)), P(2, mod('DEF', 20), mod('WIL', 10))], //gain 0.12 DEF per WIL
    triggers: [
		{ on: 'OperatorAttacked', apply: ({ owner }) => { owner.flags.hitWhileShield = true; } },
		{ on: 'DamageDealt', when: ({ event, owner }) => owner.flags.choiceWithoutRegret , apply: ({ owner }) => { owner.flags.choiceWithoutRegret = false; owner.returnSkillPoints(10)} },
	],
    derived: { DEF: (sheet) => sheet.attribute('WIL') * 0.12 },
	kit: {
      basicAttackElement: 'Physical',
      basicAttackSequence: batk([0.79, 0.87, 1.12, 1.60], 22),
      battleSkill: { *run(ability) {
        const operator = ability.operator;
        ability.spendSkillPoints(100);
		ability.applyProtection(ability.controlledOperator(), 0.9, 1.5);
		ability.applyProtection(ability.operator, 0.9, 1.5);
		ability.lockFor(1.5);
		operator.flags.hitWhileShield = false;
		if (ability.potential>=5) operator.flags.choiceWithoutRegret = true;
		ability.returnSkillPoints(30);
		ability.background(function* () {
			yield ability.wait(1.5);
			operator.flags.choiceWithoutRegret = false;
			ability.applyProtection(ability.controlledOperator(), 0.9, 0.5);
			ability.applyProtection(ability.operator, 0.9, 0.5);
			if (operator.flags.hitWhileShield) {
				ability.lockFor(1);
				yield ability.wait(0.7);
				hit(ability, 'Physical', 'BattleSkill', 4);
				if (ability.potential>=1) ability.hit({ element: 'Physical', category: 'BattleSkill', flatDamage: 300 + 5 * ability.operator.sheet.defense() });
				ability.dealStagger(20);
				ability.applyVulnerable(1);
				yield ability.wait(0.3);
			}
		}())
      } },
      comboSkill: {
        cooldown: 33, windowTriggers: [{ on: 'OperatorAttacked', apply: ({hpAfter, controlled}) => hpAfter <= 0.4 && controlled},{ on: 'EnemyChargeStart'}],//test
        *run(ability) {
          ability.lockFor(1);
		  ability.dealStagger(10);
		  ability.gainUltimateEnergy(10);
		  ability.grantShield(ability.controlledOperator(), 810 + 5.06 * ability.operator.sheet.defense() , ability.potential >= 3 ? 15 : 10);
		  if (ability.controlledOperator() != ability.operator) ability.grantShield(ability.operator, 810 + 5.06 * ability.operator.sheet.defense() , ability.potential >= 3 ? 15 : 10);
		  ability.advance(1/3);
		  hit(ability, 'Physical', 'ComboSkill', 0.55);
		  ability.advance(1/3);
		  hit(ability, 'Physical', 'ComboSkill', 2.25);
        },
      },
      ultimate: { *run(ability) {
        ability.spendUltimateEnergy(70);
        ability.applyWeakness(8);//30%
        ability.lockFor(2);
		ability.dealStagger(20);
		ability.advance(0.5);
		ability.dealStagger(5);
		hit(ability, 'Physical', 'Ultimate', 2);
		if (ability.potential>=1) ability.hit({ element: 'Physical', category: 'BattleSkill', flatDamage: 300 + 5 * ability.operator.sheet.defense() });
		ability.advance(0.5);
		ability.dealStagger(5);
		hit(ability, 'Physical', 'Ultimate', 2.7);
		ability.advance(0.5);
		ability.dealStagger(10);
		ability.applyPhysicalStatus('KnockDown');
		hit(ability, 'Physical', 'Ultimate', 4);
		for (let i=0; i<3; i++) hit(ability, 'Physical', 'Ultimate', 0.45);
      } },
    },
  };
  
  // =============================== Antal (4 star Support) ===============================
  operators.Antal = {
    stars: 4, ultimateEnergyCost: 100, name: 'Antal', class: 'Support', element: 'Electric', weaponType: 'Arts Unit', mainAttribute: 'INT', secondaryAttribute: 'STR', verified: false,
    baseStats: { HP: 5495, ATK: 197, STR: 129, AGL: 86, INT: 165, WIL: 82 },
    passives: [{ name: 'Talent: INT +60', modifiers: [mod('INT', 60)] }, P(2, mod('UltimateEnergyCost', -0.1)), P(4, mod('INT', 10), mod('HPBonus', 0.1))],
    triggers: [
      { on: 'DamageDealt', by: 'any', cooldown: 30, cooldownKey: ({ event }) => event.source.operator.name, when: ({ event, now }) => { const o = event.source.operator; o.sheet.currentTime = now; return o.sheet.sum('Amp') > 0; }, apply: ({ event }) => simulation.contextFor(owner, 'BattleSkill').grantTreatment([event.source.operator]) }, //heal strength: 108 + STR*0.9
	  { on: 'EnemyDefeated', by: 'any', when: ({ simulation, now, owner }) => owner.potential >= 3 && simulation.enemy.status.hasEffect('Focus', now) , apply: ({ event }) => {event.source.restoreSkillPoints(15)} }
    ],
    kit: {
      basicAttackElement: 'Electric',
      basicAttackSequence: batk([0.52, 0.63, 0.77, 1.15], 15),
      battleSkill: { *run(ability) {
        ability.spendSkillPoints(100);
		ability.lockFor(0.5);
		ability.simulation.giveEffect(give('enemy', 'Focus', [mod('Susceptibility', 0.1, ['Heat']),mod('Susceptibility', 0.1, ['Electric'])], 60), { owner: ability.operator, now: ability.now, event: {} });
		hit(ability, 'Electric', 'BattleSkill', 2);
		if (ability.potential >= 5) {
			ability.background(function* () {
			  yield ability.wait(20);
			  if (ability.enemy.status.hasEffect('Focus', ability.simulation.now)) ability.simulation.giveEffect(give('enemy', 'Focus', [mod('Susceptibility', 0.14, ['Heat']),mod('Susceptibility', 0.14, ['Electric'])], 40), { owner: ability.operator, now: ability.now, event: {} });
			}());
		}
      } },
      comboSkill: {
        cooldown: 24, windowTriggers: [{ on: 'InflictionApplied', apply: ({ simulation }) => {simulation.enemy.status.hasEffect('Focus', simulation.now)} , capture: ({ event }) => ({ element: event.element, infliction: true }) },{ on: 'PhysicalStatusApplied', apply: ({ simulation }) => {simulation.enemy.status.hasEffect('Focus', simulation.now)} , capture: ({ event }) => ({ kind: event.kind, infliction: false }) }],
        *run(ability) {
		  ability.lockFor(0.5);
		  if (ability.operator.comboCapture)
		  if (ability.operator.comboCapture.infliction) ability.applyInfliction(ability.operator.comboCapture.element);
		  else ability.applyPhysicalStatus(ability.operator.comboCapture.kind);
		  hit(ability, 'Electric', 'ComboSkill', 3.4);
		  ability.dealStagger(10);
		  ability.gainUltimateEnergy(10);
        },
      },
      ultimate: { *run(ability) {
        ability.spendUltimateEnergy(100);
		const amp = 0.2 * ( ability.potential >= 1 ? 1.1 : 1);
        ability.simulation.giveEffect(give('team', "OverclockedMomentElectricAmp", [mod('Amp', amp, ['Electric'])], 12), { owner: ability.operator, now: ability.now, event: {} });
		ability.simulation.giveEffect(give('team', "OverclockedMomentHeatAmp", [mod('Amp', amp, ['Heat'])], 12), { owner: ability.operator, now: ability.now, event: {} });
      } },
    },
  };
  
  // =============================== Fluorite (4 star Caster) ===============================
  const detonateImprovisedExplosive = (ability, multiplier=1) => {
    ability.operator.flags.improvisedExplosive = false;
	if (ability.potential>=3) ability.applySlow(6);
	ability.dealStagger(10);
	ability.applyInfliction('Nature', 1);
	hit(ability, 'Nature', 'BattleSkill', 4.2*multiplier);
  };
  operators.Fluorite = {
    stars: 4, ultimateEnergyCost: 100, name: 'Fluorite', class: 'Caster', element: 'Nature', weaponType: 'Handcannon', mainAttribute: 'AGL', secondaryAttribute: 'INT', verified: false,
    baseStats: { HP: 5495, ATK: 303, STR: 90, AGL: 168, INT: 114, WIL: 91 },
    passives: [{ name: 'Talent: AGL +60', modifiers: [mod('AGL', 60)] }, P(4, mod('UltimateEnergyCost', -0.1)), P(1, mod('AGL', 10), mod('INT', 10)),  {name:'Talent: Mind Reading Technique', modifiers:[mod('DamageBonus', 0.2, ["Slowed"])]}],
    triggers: [/*If cryo infliction or nature infliction is applied on the enemy combo skill cooldown is reduced by 1s, cooldown of 1s*/],
    kit: {
      basicAttackElement: 'Nature',
      basicAttackSequence: batk([0.56, 0.73, 0.57, 1.35], 15),
      battleSkill: { *run(ability) {
        ability.spendSkillPoints(100);
		ability.operator.flags.improvisedExplosive = true;
        ability.applySlow(3);
        ability.background(function* () {
		  yield ability.wait(3);
		  if (ability.operator.flags.improvisedExplosive) detonateImprovisedExplosive(ability);
		}())
      } },
      comboSkill: {
        cooldown: 38, windowTriggers: [{ on: 'InflictionBatch', apply: ({ element , stacks}) => ( element == "Nature" || element == "Cryo" ) && stacks >= 2 }],
        *run(ability) {
          ability.dealStagger(10);
		  const infliction = ability.enemy.status.activeInfliction();//captures infliction on trigger?
		  ability.applyInfliction(infliction.element,1);
		  hit(ability, 'Nature', 'ComboSkill', 3.8);
		  ability.gainUltimateEnergy(10);
        },
      },
      ultimate: { *run(ability) {
        ability.spendUltimateEnergy(100);
		if (ability.operator.flags.improvisedExplosive) detonateImprovisedExplosive(ability,1.3);
		ability.dealStagger(20);
		for (let i=0; i<4; i++) {
			if (i>0) ability.advance(0.2);
			hit(ability, 'Nature', 'Ultimate', 2.5);
		}
		const infliction = ability.enemy.status.activeInfliction();
		console.log(infliction)
		if (["Nature","Cryo"].includes(infliction.element)&&infliction.stacks>=2) {
			ability.applyInfliction(infliction.element,1);
		}
      } },
    },
  };
  
  // =============================== Akekuri (4 star Caster) ===============================
  operators.Akekuri = {
    stars: 4, ultimateEnergyCost: 120, name: 'Akekuri', class: 'Vanguard', element: 'Heat', weaponType: 'Sword', mainAttribute: 'AGL', secondaryAttribute: 'INT', verified: false,
    baseStats: { HP: 5495, ATK: 319, STR: 110, AGL: 140, INT: 106, WIL: 108 },
    passives: [{ name: 'Talent: AGL +60', modifiers: [mod('AGL', 60)] }, P(4, mod('UltimateEnergyCost', -0.1)), P(2, mod('AGL', 10), mod('INT', 10))],
    triggers: [
      { on: 'SPRestored', when: ({ owner }) => owner.potential >= 1 , give: give('self', 'AkekuriP1', [atk(0.10)], 10, { maxStacks: 5 }) }
    ],
    kit: {
      basicAttackElement: 'Physical',
      basicAttackSequence: batk([0.35, 0.62, 0.73, 1.11], 17),
      battleSkill: { *run(ability) {
        ability.spendSkillPoints(100);
		ability.dealStagger(10);
		ability.applyInfliction("Heat",1);
		hit(ability, 'Heat', 'BattleSkill', 3.2);
      } },
      comboSkill: {
        cooldown: 9, windowTriggers: [{ on: 'EnemyStaggered'},{ on: 'StaggerNode'}],
        *run(ability) {
          for (let i = 0; i<2; i++) {
			  if (i>0) ability.advance(0.2);
			  ability.dealStagger(5);
			  hit(ability, 'Physical', 'ComboSkill', 1.8);
			  const SP = 7.5 * ( 1 + Math.min(0.75, ability.operator.sheet.attribute('INT')*0.0015) );
			  ability.restoreSkillPoints(SP);
		  }
		  ability.gainUltimateEnergy(10);
        },
      },
      ultimate: { *run(ability) {
        ability.spendUltimateEnergy(120);
		ability.grantLink(1, ability.potential >= 5 ? 8 : 3);
		if (ability.potential >= 3) ability.simulation.giveEffect(give('team', "Commited Team Player", [atk(0.10)], 2), { owner: ability.operator, now: ability.now, event: {} });
		const SP = 80/3;
		for (let i=0; i<3; i++) {
			if (i>0) ability.advance(1);
			ability.restoreSkillPoints(SP);
		}
      } },
    },
  };
})();
