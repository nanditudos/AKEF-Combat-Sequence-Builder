// One entry per weapon. triggers: [] are filled in when the trigger system exists.
(function () {
  const { mod } = globalThis.Endfield;
  Endfield.data.weapons = Endfield.data.weapons || {};
  Endfield.data.weapons.LoneBarge = {
    name: 'Lone Barge', type: 'ArtsUnit', baseAttack: 510, verified: false,
    modifiers: [mod('WIL', 156), mod('ATKBonus', 0.39), mod('DamageBonus', 0.448, ['Electric'])],
    triggers: [], // BS consumes reaction -> +56% BS Electric (2 stacks, 0.1s ICD); after Ult -> +112% BS Electric 25s
  };
})();
