// Set bonuses (3-piece): stat modifiers + triggers. Keys must match the `set` name used by the pieces in gear.js.
(function () {
  const { mod } = globalThis.Endfield;
  const gear = Endfield.data.gear, { give, dmg } = Endfield.dsl;
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

  sets['Aethertech'] = { modifiers: [mod('ATKBonus', 0.08)], triggers: [{
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
    on: 'SPRestored', when: ({ event }) => !['BasicAttack', 'PerfectDodge'].includes(event.source.category), // restored (not returned) by a skill
    apply: ({ simulation }) => simulation.applyToTeam('FrontiersTeam', [mod('DamageBonus', 0.16)], 15) }] };

  sets['AIC Fieldwork'] = { modifiers: [mod('DamageBonus', 0.20), mod('UltimateEfficiency', 0.10)], triggers: [] };

  sets.Bonekrusha = { modifiers: [mod('ATKBonus', 0.15)], triggers: [{ // combo cast -> next battle skill +30% (2 stacks, no timer)
    on: 'SkillCast', when: ({ event }) => event.category === 'ComboSkill',
    give: give('self', 'BonekrushingSmash', [dmg(0.30)], Infinity, { armedFor: ['BattleSkill'], maxStacks: 2 }) }] };

  sets['Type 50 Yinglung'] = { modifiers: [mod('ATKBonus', 0.15)], triggers: [{ // ANY operator's battle skill cast -> wearer's next combo +20% (3 stacks)
    on: 'SkillCast', by: 'any', when: ({ event }) => event.category === 'BattleSkill',
    give: give('self', 'YinglungEdge', [dmg(0.20)], Infinity, { armedFor: ['ComboSkill'], maxStacks: 3 }) }] };

  sets['Eternal Xiranite'] = { modifiers: [mod('HP', 1000)], // wearer applies Amp / Protection / Susceptibility / Weakness -> OTHER teammates +16% for 15s (refreshes)
    triggers: ['AmpGained', 'AmpGranted', 'SusceptibilityApplied', 'ProtectionApplied', 'WeaknessApplied'].map((on) => ({ on, give: give('others', 'EternalXiranite', [dmg(0.16)], 15) })) };

  sets['Grizzled Edge'] = { modifiers: [mod('ATKBonus', 0.08)], triggers: [{ // Crush/Breach -> Physical +6% per Vulnerable stack consumed, x1.5 vs Physical Susceptibility / Staggered (Originium Crystals not modeled)
    on: 'PhysicalStatusApplied', when: ({ event }) => ['Crush', 'Breach'].includes(event.kind),
    give: give('self', 'GrizzledEdge', ({ event, simulation, now }) => {
      const boosted = simulation.enemy.status.hasSusceptibility('Physical', now) || simulation.enemy.isStaggered(now);
      return [dmg(0.06 * event.stacksConsumed * (boosted ? 1.5 : 1), 'Physical')];
    }, 20) }] };

  sets.LYNX = { modifiers: [mod('TreatmentBonus', 0.20)], triggers: [{ // defensive only: treated target gets 15% Final Damage Reduction for 10s
    on: 'TreatmentGranted', give: give('targets', 'LynxGuard', [mod('FinalDamageReduction', 0.15)], 10) }] };

  sets.Qingbo = { modifiers: [mod('ComboSkillCooldownReduction', 0.15)], triggers: [{ // combo cast -> Skill DMG +20% for 15s, 2 stacks with separate timers
    on: 'SkillCast', when: ({ event }) => event.category === 'ComboSkill',
    give: give('self', 'QingboSkillDamage', Endfield.mods.skillDamage(0.20), 15, { maxStacks: 2 }) }] };
})();
