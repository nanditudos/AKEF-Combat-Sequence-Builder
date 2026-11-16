// Operators, batch 2 (F2P roster). Implemented so far: Estella. The rest of the batch is still to do.
// Assumptions are marked "assumption". Talents that only heal/shield are not modeled. Cooldowns are informational.
(function () {
  const E = globalThis.Endfield, { mod } = E, K = E.opkit, { batk, P } = K;
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
})();
