// One entry per weapon. triggers: [] are filled in when the trigger system exists.
(function () {
  const { mod } = globalThis.Endfield;
  Endfield.data.weapons = Endfield.data.weapons || {};
  Endfield.data.weapons.LoneBarge = {
    name: 'Lone Barge', type: 'ArtsUnit', baseAttack: 510, verified: false,
    modifiers: [mod('WIL', 156), mod('ATKBonus', 0.39), mod('DamageBonus', 0.448, ['Electric'])],
    triggers: [
      { on: 'ReactionConsumed', cooldown: 0.1, when: ({ event }) => event.source.category === 'BattleSkill',
        apply: ({ owner, now }) => owner.addStacks('LoneBargeBattleSkill', 1, { modifiers: [mod('DamageBonus', 0.56, ['Electric', 'BattleSkill'])], duration: 20, maxStacks: 2 }, now) },
      { on: 'SkillCast', when: ({ event }) => event.category === 'Ultimate',
        apply: ({ owner, now }) => owner.setEffect('LoneBargeUltimate', [mod('DamageBonus', 1.12, ['Electric', 'BattleSkill'])], 25, now, {}) },
    ],
  };
})();
