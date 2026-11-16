// One entry per operator. Stat-only parts for now; abilities/triggers arrive with the simulation core.
// verified:false until you mark it true.
(function () {
  const { mod } = globalThis.Endfield;
  Endfield.data.operators = Endfield.data.operators || {};
  Endfield.data.operators.ZhuangFangyi = {
    name: 'Zhuang Fangyi', class: 'Caster', element: 'Electric', weaponType: 'ArtsUnit',
    mainAttribute: 'WIL', secondaryAttribute: 'INT', ultimateEnergyCost: 240, verified: false,
    baseStats: { HP: 5495, ATK: 326, STR: 99, AGL: 99, INT: 123, WIL: 184 },
    passives: [
      { name: 'Talent: WIL +60', modifiers: [mod('WIL', 60)] },
      { name: 'P2', minPotential: 2, modifiers: [mod('WIL', 20), mod('DamageBonus', 0.15, ['BattleSkill'])] },
      { name: 'P4', minPotential: 4, modifiers: [mod('UltimateEnergyCost', -0.15)] },
      { name: 'P5 (only while Ultimate active)', minPotential: 5, condition: 'UltimateActive', modifiers: [mod('IgnoreResistance', 15, ['Electric'])] },
    ],
  };
})();
