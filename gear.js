// One line per piece. DEF and other irrelevant stats are omitted on purpose.
(function () {
  const { mod } = globalThis.Endfield;
  const gear = (Endfield.data.gear = Endfield.data.gear || { armor: [], gloves: [], kits: [], setBonuses: {} });
  const piece = (name, set, ...modifiers) => ({ name, set, modifiers });

  gear.armor.push(piece('Xiranflow Light Armor', 'Xiranflow', mod('WIL', 75), mod('INT', 75), mod('DamageBonus', 0.149, ['Cryo']), mod('DamageBonus', 0.149, ['Electric'])));
  gear.gloves.push(piece('Xiranflow Gloves', 'Xiranflow', mod('WIL', 84), mod('INT', 55), mod('DamageBonus', 0.249, ['Cryo']), mod('DamageBonus', 0.249, ['Electric'])));
  gear.kits.push(piece('Xiranflow Baton', 'Xiranflow', mod('WIL', 41), mod('INT', 27), mod('DamageBonus', 0.538, ['BattleSkill'])));
  gear.kits.push(piece('LYNX Slab', 'LYNX', mod('WIL', 41), mod('INT', 27), mod('MainAttributeBonus', 0.269)));

  gear.setBonuses.Xiranflow = {
    modifiers: [mod('ATKBonus', 0.10)],
    triggers: [], // consuming Electrification/Corrosion -> stacks of +15% Electric & Nature damage (max 3, 25s each)
  };
})();
