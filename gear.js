// One line per piece. DEF and other irrelevant stats are omitted on purpose.
// Set bonuses: stat modifiers + triggers (see sim.js dispatchTriggers). Gold sets only (Lv 60/70).
(function () {
  const { mod } = globalThis.Endfield;
  const gear = (Endfield.data.gear = Endfield.data.gear || { armor: [], gloves: [], kits: [], setBonuses: {} });
  const piece = (name, set, ...modifiers) => ({ name, set, modifiers });

  gear.armor.push(piece('Xiranflow Light Armor', 'Xiranflow', mod('WIL', 113), mod('INT', 75), mod('DamageBonus', 0.149, ['Cryo']), mod('DamageBonus', 0.149, ['Electric'])));
  gear.gloves.push(piece('Xiranflow Gloves', 'Xiranflow', mod('WIL', 84), mod('INT', 55), mod('DamageBonus', 0.249, ['Cryo']), mod('DamageBonus', 0.249, ['Electric'])));
  gear.kits.push(piece('Xiranflow Baton', 'Xiranflow', mod('WIL', 41), mod('INT', 27), mod('DamageBonus', 0.538, ['BattleSkill'])));
  gear.kits.push(piece('LYNX Slab', 'LYNX', mod('WIL', 41), mod('INT', 27), mod('MainAttributeBonus', 0.269)));

  const sets = gear.setBonuses;
  const isSource = (names, key = 'name') => ({ event }) => names.includes(event[key]);
  const skillTags = ['BattleSkill', 'ComboSkill', 'Ultimate'];

  sets.Xiranflow = { modifiers: [mod('ATKBonus', 0.10)], triggers: [{
    on: 'ReactionConsumed', when: isSource(['Electrification', 'Corrosion']),
    apply: ({ event, owner, now }) => owner.addStacks('XiranflowBuff', event.level, { modifiers: [mod('DamageBonus', 0.15, ['Electric']), mod('DamageBonus', 0.15, ['Nature'])], duration: 25, maxStacks: 3 }, now) }] };

  sets['Pulser Labs'] = { modifiers: [mod('ArtsIntensity', 30)], triggers: [
    { on: 'ReactionApplied', when: isSource(['Electrification']), apply: ({ owner, now }) => owner.setEffect('PulserElectric', [mod('DamageBonus', 0.5, ['Electric'])], 10, now, {}) },
    { on: 'ReactionApplied', when: isSource(['Solidification']), apply: ({ owner, now }) => owner.setEffect('PulserCryo', [mod('DamageBonus', 0.5, ['Cryo'])], 10, now, {}) }] };

  sets['Hot Work'] = { modifiers: [mod('ArtsIntensity', 30)], triggers: [
    { on: 'ReactionApplied', when: isSource(['Combustion']), apply: ({ owner, now }) => owner.setEffect('HotWorkHeat', [mod('DamageBonus', 0.5, ['Heat'])], 10, now, {}) },
    { on: 'ReactionApplied', when: isSource(['Corrosion']), apply: ({ owner, now }) => owner.setEffect('HotWorkNature', [mod('DamageBonus', 0.5, ['Nature'])], 10, now, {}) }] };

  sets['Tide Surge'] = { modifiers: skillTags.map((tag) => mod('DamageBonus', 0.20, [tag])), triggers: [{
    on: 'InflictionBatch', when: ({ event }) => event.stacks >= 2,
    apply: ({ owner, now }) => owner.setEffect('TideSurgeArts', [mod('DamageBonus', 0.35, ['Arts'])], 15, now, {}) }] };

  sets['Deep Rampart'] = { modifiers: [mod('DamageBonus', 0.16, ['Arts'])], triggers: [{
    on: 'ArtsBurst', cooldown: 0.1, when: isSource(['Nature', 'Cryo'], 'element'),
    apply: ({ owner, now }) => owner.addStacks('DeepRampartIntensity', 1, { modifiers: [mod('ArtsIntensity', 16)], duration: 20, maxStacks: 3 }, now) }] };

  sets['Æthertech'] = { modifiers: [mod('ATKBonus', 0.08)], triggers: [{
    on: 'VulnerableApplied',
    apply: ({ event, owner, now }) => {
      owner.addStacks('AethertechPhysical', 1, { modifiers: [mod('DamageBonus', 0.08, ['Physical'])], duration: 15, maxStacks: 4 }, now);
      if (event.stacksBefore >= 4) owner.setEffect('AethertechExtra', [mod('DamageBonus', 0.16, ['Physical'])], 10, now, {});
    } }] };

  sets.Swordmancer = { modifiers: [mod('StaggerEfficiency', 0.20)], triggers: [{
    on: 'PhysicalStatusApplied', cooldown: 15, // assumption: extra hit is Status-category Physical damage without status scaling
    apply: ({ event }) => { event.source.hit({ element: 'Physical', category: 'Status', subtype: 'ExtraHit', multiplier: 2.5 }); event.source.dealStagger(10); } }] };

  sets['MI Security'] = { modifiers: [mod('CriticalRate', 0.05)], triggers: [{
    on: 'CriticalHit', when: ({ event }) => event.scope === 'overall',
    apply: ({ owner, now }) => {
      owner.addStacks('MISecurityAttack', 1, { modifiers: [mod('ATKBonus', 0.05)], duration: 5, maxStacks: 5 }, now);
      if (owner.stackCount('MISecurityAttack', now) >= 5) owner.setEffect('MISecurityCritical', [mod('CriticalRate', 0.05)], 5, now, {});
    } }] };

  sets.Frontiers = { modifiers: [], triggers: [{ // Combo Skill cooldown reduction is ignored (no combo cooldowns)
    on: 'SkillSPReturned', apply: ({ simulation }) => simulation.applyToTeam('FrontiersTeam', [mod('DamageBonus', 0.16)], 15) }] };

  sets['AIC Fieldwork'] = { modifiers: [mod('DamageBonus', 0.20), mod('UltimateEfficiency', 0.10)], triggers: [] };
  // TODO (events not built yet): Bonekrusha, Type 50 Yinglung, Qingbo, Eternal Xiranite, Grizzled Edge, LYNX (defensive)
})();
