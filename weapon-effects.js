// Weapon special effects as triggers, keyed by weapon name (stats are in weapons.js).
// Trigger: { on, by: 'self'(default)|'any', cooldown, when(ctx), give: {...} | apply(ctx) }   (see effects.js and sim.js)
// All "cannot stack" effects refresh. "Duration of each stack counted separately" = maxStacks. Healing/shield/HP effects are not modeled.
(function () {
  const E = globalThis.Endfield, { mod } = E;
  const dmg = (value, ...tags) => mod('DamageBonus', value, tags.length ? tags : undefined);
  const atk = (value) => mod('ATKBonus', value);
  const intensity = (value) => mod('ArtsIntensity', value);
  const give = (to, name, mods, duration, extra = {}) => ({ to, name, mods, duration, ...extra });
  const castBy = (...categories) => ({ event }) => categories.includes(event.source.category);
  const isSkill = castBy('BattleSkill', 'ComboSkill', 'Ultimate');
  const notBasicAttack = ({ event }) => event.source.category !== 'BasicAttack'; // "skill recovers SP"
  const eventIs = (key, ...values) => ({ event }) => values.includes(event[key]);
  const isArtsSusceptibility = ({ event }) => ['Arts', 'Heat', 'Electric', 'Cryo', 'Nature'].includes(event.element); // elemental Susceptibility counts as Arts (measured with Type 42)
  const all = (...conditions) => (context) => conditions.every((condition) => condition(context));
  const rawPhysicalHit = (multiplier) => ({ event }) => event.source.hit({ element: 'Physical', category: 'Status', subtype: 'ExtraHit', multiplier });
  const intAtLeastWill = ({ owner }) => owner.sheet.attribute('INT', true) >= owner.sheet.attribute('WIL', true); // permanent sources only
  const enemyHasCryoInfliction = ({ simulation }) => (simulation.enemy.status.activeInfliction() || {}).element === 'Cryo';
  const W = {};

  // ---------------- Sword ----------------
  W['Complexed Industry'] = [{ on: 'InflictionBatch', when: all(castBy('ComboSkill'), eventIs('element', 'Electric')), give: give('self', 'ComplexedAdvantage', [intensity(42), dmg(0.224, 'Electric')], 15) }];
  W['Eminent Repute'] = [{ on: 'VulnerableConsumed', give: give('selfAndOthers', 'Disciplinarian', ({ event }) => [atk(0.14 + 0.07 * event.stacks)], 20, { othersScale: 0.5 }) }];
  W['Farsight'] = [{ on: 'BattleStart', give: give('team', 'DreamStriving', [dmg(0.14), intensity(28), mod('DEFBonus', 0.084)], 20) }];
  W['Forgeborn Scathe'] = [{ on: 'SkillCast', when: castBy('Ultimate'), give: give('self', 'BlazingWail', [dmg(2.1, 'BasicAttack')], 20) }];
  W['Glorious Memory'] = [{ on: 'VulnerableApplied', cooldown: 0.5, when: isSkill, give: give('self', 'LingeringGlow', [dmg(0.336)], 30, { armedFor: ['Ultimate'], maxStacks: 3 }) }];
  const grandVision = give('self', 'LongTimeWish', [dmg(1.008, 'Physical')], 20, { armedFor: ['BattleSkill', 'Ultimate'] });
  W['Grand Vision'] = [{ on: 'OriginiumCrystalsApplied', give: grandVision }, { on: 'ReactionApplied', when: eventIs('name', 'Solidification'), give: grandVision }];
  W['Lupine Scarlet'] = [{ on: 'CriticalHit', when: eventIs('scope', 'skill'), apply: ({ owner, now, simulation }) => {
    if (owner.effects.LupineBonus && owner.effects.LupineBonus.expires > now) return;
    owner.addStacks('WolvenBlood', 1, { modifiers: [dmg(0.028, 'Physical'), dmg(0.028, 'Heat')], duration: Infinity, maxStacks: 16 }, now);
    if (owner.stackCount('WolvenBlood', now) >= 16) {
      owner.setEffect('LupineBonus', [dmg(0.672, 'Physical'), dmg(0.672, 'Heat')], 20, now, {});
      simulation.schedule(now + 20, () => { for (const stack of owner.stacks.WolvenBlood) owner.sheet.removeModifiersFrom(stack.source); owner.stacks.WolvenBlood = []; });
    } } }];
  W['Never Rest'] = [{ on: 'SPRestored', cooldown: 0.1, when: notBasicAttack, give: give('selfAndOthers', 'Reincarnation', [dmg(0.14, 'Physical')], 30, { maxStacks: 5, othersScale: 0.5 }) }];
  const thermalRelease = give('team', 'ThermalRelease', [atk(0.14)], 20, { maxStacks: 2 });
  W['Thermite Cutter'] = [{ on: 'SPRestored', when: notBasicAttack, give: thermalRelease }, { on: 'LinkGranted', give: thermalRelease }];
  W['Umbra Torch'] = [{ on: 'ReactionApplied', by: 'any', cooldown: 0.1, when: eventIs('name', 'Combustion', 'Corrosion'), give: give('self', 'CovetousBuildup', [dmg(0.224, 'Heat'), dmg(0.224, 'Nature')], 20, { maxStacks: 2 }) }];
  W['White Night Nova'] = [{ on: 'ReactionApplied', when: eventIs('name', 'Combustion', 'Electrification'), give: give('self', 'WhiteNightNova', [dmg(0.336, 'Arts'), intensity(70)], 15) }];
  W['Aspirant'] = [{ on: 'PhysicalStatusApplied', cooldown: 0.5, when: eventIs('kind', 'Lift'), give: give('self', 'ImposingPeak', [dmg(0.336, 'Physical')], 30, { armedFor: ['Ultimate'], maxStacks: 3 }) }];
  W['Dessert Moment'] = [{ on: 'TreatmentGranted', when: castBy('ComboSkill'), give: give('targets', 'SweetnessAndDreams', [intensity(14), dmg(0.098, 'Arts')], 20) }];
  W['Finchaser 3.0'] = [{ on: 'ReactionApplied', when: all(castBy('BattleSkill'), eventIs('name', 'Solidification')), give: give('enemy', 'FinChaserIntent', [mod('DamageTaken', 0.196, ['Cryo'])], 15) }];
  W['OBJ Edge of Lightness'] = [{ on: 'SPRestored', when: notBasicAttack, give: give('team', 'UnbridledEdge', [dmg(0.084, 'Heat'), dmg(0.084, 'Electric')], 20, { maxStacks: 3 }) }];
  W['Sundering Steel'] = [{ on: 'PhysicalStatusApplied', cooldown: 0.1, give: give('self', 'AnthemOfCinder', [atk(0.21)], 20, { maxStacks: 2 }) }];
  W['Twelve Questions'] = [{ on: 'ReactionConsumed', give: give('self', 'SincereInterrogation', [atk(0.12)], 20, { maxStacks: 2 }) }];

  // ---------------- Great Sword ----------------
  W['Amaranthine Tassel'] = [
    { on: 'SusceptibilityApplied', when: eventIs('element', 'Physical'), give: give('self', 'TasselIntensity', [intensity(84)], 20) },
    { on: 'PhysicalStatusApplied', when: eventIs('kind', 'Crush'), give: give('self', 'TasselCrush', ({ event }) => [dmg(0.252 + 0.084 * event.stacksConsumed, 'Physical')], 30) }];
  W['Exemplar'] = [{ on: 'DamageDealt', cooldown: 0.1, when: castBy('BattleSkill', 'Ultimate'), give: give('self', 'StackedHew', [dmg(0.28, 'Physical')], 30, { maxStacks: 3 }) }];
  W['Jade Vessel'] = [
    { on: 'ImmobilizationApplied', give: give('enemy', 'DabblesOfInkDebuff', [mod('DamageTaken', 0.21)], 30) },
    { on: 'ImmobilizationApplied', give: give('self', 'DabblesOfInk', [dmg(0.7)], 20, { armedFor: ['ComboSkill'] }) },
    { on: 'SkillCast', when: castBy('Ultimate'), give: give('self', 'DabblesOfInk', [dmg(0.7)], 20, { armedFor: ['ComboSkill'] }) }];
  W['Khravengger'] = [
    { on: 'InflictionBatch', when: all(castBy('BattleSkill'), eventIs('element', 'Cryo')), give: give('self', 'BonechillingA', [dmg(0.28, 'Cryo')], 15) },
    { on: 'DamageDealt', when: all(castBy('ComboSkill'), enemyHasCryoInfliction), give: give('self', 'BonechillingB', [dmg(0.56, 'Cryo')], 15) }];
  W['Long Heritage'] = [
    { on: 'InflictionBatch', when: all(castBy('BattleSkill'), eventIs('element', 'Cryo', 'Heat')), give: give('self', 'SecretHistory', [dmg(0.168, 'Cryo')], 20) },
    { on: 'AmpGranted', give: give('team', 'SecretHistoryTeam', [dmg(0.112, 'Arts')], 20) }];
  W['Phantom Pain'] = [{ on: 'SkillCast', cooldown: 0.1, when: castBy('BattleSkill', 'ComboSkill'), give: give('self', 'LayeredSuffering', [dmg(0.154, 'Physical')], 20, { maxStacks: 3 }) }];
  W['Sundered Prince'] = [{ on: 'FinalStrike', apply: ({ event, owner, now, simulation }) => {
    const controlled = simulation.controlled === owner;
    owner.setEffect('PrincelyDeterrence', [atk(controlled ? 0.56 : 0.28)], 8, now, {});
    if (controlled) event.staggerBonus += 0.336; } }];
  W['Ancient Canal'] = [{ on: 'VulnerableConsumed', give: give('self', 'LandsOfYore', ({ event }) => [dmg(0.14 * event.stacks, 'Physical')], 20) }];
  W['OBJ Heavy Burder'] = [
    { on: 'PhysicalStatusApplied', when: eventIs('kind', 'KnockDown'), give: give('self', 'TenaciousWill', [mod('DEFBonus', 0.504)], 15) },
    { on: 'WeaknessApplied', give: give('self', 'TenaciousWill', [mod('DEFBonus', 0.504)], 15) }];
  W['Seeker of Dark Lung'] = [{ on: 'ArtsBurst', cooldown: 0.1, give: give('self', 'SeekerOfTheEsoteric', [atk(0.168)], 30, { maxStacks: 3 }) }];

  // ---------------- Polearm ----------------
  W['Beacon of Duty'] = [
    { on: 'InflictionBatch', when: all(isSkill, eventIs('element', 'Heat')), give: give('self', 'FuelForTheTorch', [dmg(0.224, 'Physical'), dmg(0.224, 'Heat')], 20) },
    { on: 'SusceptibilityApplied', when: all(isSkill, eventIs('element', 'Heat')), give: give('team', 'FuelForTheTorchTeam', [dmg(0.112, 'Physical'), dmg(0.112, 'Heat')], 30) }];
  W['Bedazzling Night Debut'] = [{ on: 'TreatmentGranted', cooldown: 0.1, when: isSkill, give: give('targets', 'ShimmeringCurtain', [atk(0.098)], 20, { maxStacks: 4 }) }];
  W['Blessing of Lustrous Carmine'] = [
    { on: 'SPRestored', when: notBasicAttack, give: give('team', 'AbsolverOfGuiltAtk', [atk(0.168)], 20) },
    { on: 'InflictionBatch', when: all(isSkill, eventIs('element', 'Heat')), give: give('team', 'AbsolverOfGuiltHeat', [dmg(0.168, 'Heat')], 20) }];
  W['Golden Age'] = [
    { on: 'DamageDealt', when: castBy('ComboSkill'), give: give('self', 'GreatHeroTreatment', [mod('TreatmentBonus', 0.112)], 15) },
    { on: 'TreatmentGranted', when: castBy('ComboSkill'), give: give('team', 'GreatHeroArts', [dmg(0.14, 'Arts')], 20) }];
  W['JET'] = [
    { on: 'SkillCast', when: castBy('BattleSkill'), give: give('self', 'AstrophysicsBattle', [dmg(0.336, 'Arts')], 15) },
    { on: 'SkillCast', when: castBy('ComboSkill'), give: give('self', 'AstrophysicsCombo', [dmg(0.336, 'Arts')], 15) }];
  W['Mountain Bearer'] = [
    { on: 'VulnerableApplied', when: castBy('BattleSkill'), give: give('self', 'WeightOfMountainA', E.mods.allAttributesBonus(0.224), 15) },
    { on: 'SusceptibilityApplied', when: all(castBy('BattleSkill'), eventIs('element', 'Physical')), give: give('self', 'WeightOfMountainB', E.mods.allAttributesBonus(0.224), 15) }];
  W['Valiant'] = [{ on: 'PhysicalStatusApplied', apply: rawPhysicalHit(3.36) }];
  W['Chimeric Justice'] = [{ on: 'VulnerableApplied', when: ({ event }) => event.stacksBefore === 0, give: give('self', 'CementedFury', [atk(0.42)], 15) }];
  W['Cohesive Traction'] = [{ on: 'SkillCast', when: castBy('ComboSkill'), give: give('self', 'ConcentricCircles', [dmg(0.28, 'Electric')], 30, { armedFor: ['BattleSkill'], maxStacks: 3 }) }];
  W['OBJ Razorhorn'] = [{ on: 'ReactionConsumed', when: eventIs('name', 'Solidification'), give: give('self', 'ConquestOfIcyPeaks', [atk(0.336)], 15) }];

  // ---------------- Handcannon ----------------
  W['Artzy Tyrannical'] = [{ on: 'CriticalHit', cooldown: 0.1, when: eventIs('scope', 'skill'), give: give('self', 'ArtzyExaggeration', [dmg(0.392, 'Cryo')], 30, { maxStacks: 3 }) }];
  W["Brigand's Calling"] = [
    { on: 'InflictionBatch', when: all(castBy('BattleSkill', 'Ultimate'), eventIs('element', 'Cryo')), give: give('self', 'BrigandsBane', [dmg(0.56, 'Cryo')], 20) },
    { on: 'SusceptibilityApplied', when: all(castBy('BattleSkill', 'Ultimate'), isArtsSusceptibility), give: give('enemy', 'BrigandsBaneDebuff', [mod('DamageTaken', 0.168, ['Arts'])], 20) }];
  W['Clannibal'] = [{ on: 'ReactionConsumed', cooldown: 25, give: give('enemy', 'ViciousPurge', ({ event }) => [mod('DamageTaken', 0.28, [event.element])], 15) }];
  W['Home Longing'] = [{ on: 'SkillCast', when: castBy('ComboSkill'), give: give('self', 'OldenMoon', [dmg(0.224, 'Cryo'), dmg(0.224, 'Nature')], 20, { armedFor: ['BattleSkill'], maxStacks: 2 }) }];
  W['Navigator'] = [{ on: 'ReactionApplied', by: 'any', when: eventIs('name', 'Solidification', 'Corrosion'), apply: ({ event, owner, now }) => {
    const factor = event.source && event.source.operator === owner ? 2 : 1; // doubled when triggered by the wielder
    owner.setEffect('LoneAndDistantSail', [dmg(0.098 * factor, 'Cryo'), dmg(0.098 * factor, 'Nature'), mod('CriticalRate', 0.056 * factor)], 15, now, {}); } }];
  W['Wedge'] = [
    { on: 'SkillCast', when: castBy('BattleSkill'), give: give('self', 'WedgeCast', [dmg(0.224, 'Arts')], 15) },
    { on: 'ReactionApplied', when: castBy('BattleSkill'), give: give('self', 'WedgeReaction', [dmg(0.448, 'Arts')], 15) }];
  W['OBJ Velocitous'] = [{ on: 'InflictionConsumed', give: give('self', 'RapidStrike', ({ event }) => [dmg(0.14 * event.stacks, 'Nature')], 20) }];
  W['Opus: The Living'] = [{ on: 'ReactionApplied', cooldown: 0.1, give: give('self', 'RoadHomeForAllLife', [atk(0.21)], 20, { maxStacks: 2 }) }];
  W['Rational Farewell'] = [
    { on: 'ArtsBurst', when: castBy('ComboSkill'), give: give('self', 'AidFromThePast', [atk(0.448)], 15) },
    { on: 'ReactionApplied', when: all(castBy('ComboSkill'), eventIs('name', 'Combustion')), give: give('self', 'AidFromThePast', [atk(0.448)], 15) }];

  // ---------------- Arts Unit ----------------
  W['Chivalric Virtues'] = [{ on: 'TreatmentGranted', when: isSkill, give: give('team', 'BlightFervor', [atk(0.252)], 15) }];
  W['Delivery Guaranteed'] = [{ on: 'PhysicalStatusApplied', when: all(castBy('ComboSkill'), eventIs('kind', 'Lift')),
    give: give('team', 'DutyFulfilled', ({ simulation }) => [dmg(0.336 + Math.min(0.294, 0.098 * (simulation.enemy.status.isLifted() ? 1 : 0)), 'Arts')], 15) }];
  W['Detonation Unit'] = [{ on: 'ArtsBurst', give: give('enemy', 'ImposingChampion', [mod('DamageTaken', 0.252, ['Arts'])], 15) }];
  W['Dreams of the Starry Beach'] = [{ on: 'ReactionConsumed', when: eventIs('name', 'Corrosion'), give: give('enemy', 'TidalMurmurs', [mod('DamageTaken', 0.28, ['Arts'])], 25) }];
  W['Flickers in the Mist'] = [{ on: 'AmpGained', cooldown: 0.1, when: eventIs('element', 'Electric'), give: give('self', 'OverlappingFlickers', [dmg(0.154, 'Electric')], 30, { maxStacks: 3 }) }];
  W['Junction Point'] = [
    { on: 'InflictionBatch', when: castBy('ComboSkill'), give: give('selfAndOthers', 'FeedbackLoop', [atk(0.168)], 20, { maxStacks: 2, othersScale: 0.25 }) },
    { on: 'SusceptibilityApplied', when: all(castBy('ComboSkill'), isArtsSusceptibility), give: give('selfAndOthers', 'FeedbackLoop', [atk(0.168)], 20, { maxStacks: 2, othersScale: 0.25 }) }];
  W['Lone Barge'] = [
    { on: 'ReactionConsumed', cooldown: 0.1, when: castBy('BattleSkill'), give: give('self', 'StreamingBlitz', [dmg(0.56, 'Electric', 'BattleSkill')], 20, { maxStacks: 2 }) },
    { on: 'SkillCast', when: castBy('Ultimate'), give: give('self', 'StreamingBlitzUltimate', [dmg(1.12, 'Electric', 'BattleSkill')], 25) }];
  W['Oblivion'] = [
    { on: 'SkillCast', when: castBy('Ultimate'), give: give('self', 'HumiliationUltimate', [dmg(0.672, 'Arts')], 15) },
    { on: 'SkillCast', when: castBy('ComboSkill'), give: give('self', 'HumiliationCombo', [dmg(0.336, 'Arts')], 15) }];
  W['Opus: Etch Figure'] = [{ on: 'InflictionBatch', when: all(castBy('BattleSkill'), eventIs('element', 'Nature')), give: give('others', 'TilliteEtchings', [dmg(0.14 + 0.056, 'Arts')], 15) }]; // one enemy inflicted
  W["Suffering's End"] = [{ on: 'ArtsBurst', cooldown: 0.1, apply: ({ owner, now }) => {
    owner.addStacks('DawnOfTheLongNight', 1, { modifiers: [dmg(0.056, 'Nature')], duration: 25, maxStacks: 4 }, now);
    if (owner.stackCount('DawnOfTheLongNight', now) >= 4) owner.setEffect('DawnOfTheLongNightBonus', [dmg(0.168, 'Nature')], 25, now, {}); } }];
  W['Type 42: Solemn Phalanx'] = [ // INT >= WIL (permanent sources only) -> self buffs; WIL > INT -> enemy debuffs
    { on: 'InflictionBatch', when: intAtLeastWill, give: give('self', 'DebilitatingAssaultArts', [dmg(0.56, 'Arts')], 20) },
    { on: 'SusceptibilityApplied', when: all(intAtLeastWill, isArtsSusceptibility), give: give('self', 'DebilitatingAssaultAtk', [atk(0.56)], 20) },
    { on: 'ArtsBurst', when: (context) => !intAtLeastWill(context), give: give('enemy', 'DebilitatingAssaultBurst', [mod('DamageTaken', 0.168, ['Arts'])], 25) },
    { on: 'SusceptibilityApplied', when: (context) => !intAtLeastWill(context) && isArtsSusceptibility(context), give: give('enemy', 'DebilitatingAssaultSusceptibility', [mod('DamageTaken', 0.168, ['Arts'])], 25) }];
  W['Umbra of Frigid Eventide'] = [
    { on: 'SkillCast', when: castBy('BattleSkill'), apply: ({ owner, now }) => {
      owner.setEffect('HunterInstinct', [intensity(98)], 15, now, {});
      owner.stacks.Windform = []; owner.addStacks('Windform', 4, { modifiers: [], duration: 15, maxStacks: 4 }, now); } },
    { on: 'ArtsBurst', cooldown: 0.1, apply: ({ owner, now }) => {
      if (owner.consumeStacks('Windform', 1, now)) owner.addStacks('HunterInstinctArts', 1, { modifiers: [dmg(0.112, 'Arts')], duration: 30, maxStacks: 4 }, now); } }];
  W['Stanza of Memorials'] = [{ on: 'SkillCast', when: castBy('Ultimate'), give: give('otherElements', 'LustrousPyre', [atk(0.224)], 20) }];
  W['Wild Wanderer'] = [{ on: 'ReactionApplied', when: eventIs('name', 'Electrification'), give: give('team', 'WildernessCluster', [dmg(0.224, 'Physical'), dmg(0.224, 'Electric')], 15) }];
  W['OBJ Arts Identifier'] = [
    { on: 'ArtsBurst', when: castBy('ComboSkill'), give: give('team', 'TranscendentArts', [dmg(0.224, 'Heat'), dmg(0.224, 'Electric')], 15) },
    { on: 'PhysicalStatusApplied', when: castBy('ComboSkill'), give: give('team', 'TranscendentArts', [dmg(0.224, 'Heat'), dmg(0.224, 'Electric')], 15) }];
  // No modeled effect (healing / shields / HP only, or no special): Former Finery, Thunderberge, Freedom to Proselytize, Finishing Call, Fortmaker, Monaihe, Rapid Ascent

  const weapons = Object.values(E.data.weapons);
  for (const [name, triggers] of Object.entries(W)) {
    const weapon = weapons.find((candidate) => candidate.name === name);
    if (!weapon) throw new Error('weapon-effects.js: unknown weapon ' + name);
    weapon.triggers = triggers;
  }
})();
