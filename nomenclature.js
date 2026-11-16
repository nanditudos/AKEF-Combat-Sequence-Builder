// =====================================================================================
//  NOMENCLATURE: how to write stats for gear / weapons / operators / effects
// =====================================================================================
//  Everything a piece of equipment (or buff, talent, potential...) gives is a list of
//  MODIFIERS, written with  mod(stat, value, tags?)
//
//      mod('WIL', 75)                              // flat +75 Will
//      mod('ATKBonus', 0.39)                       // +39% ATK   (percentages are fractions: 39% = 0.39)
//      mod('DamageBonus', 0.149, ['Electric'])     // +14.9% Electric Damage Dealt
//      mod('DamageBonus', 0.538, ['BattleSkill'])  // +53.8% Battle Skill Damage Dealt
//      mod('DamageBonus', 0.15, ['Electric', 'BattleSkill'])   // combination: needs BOTH tags
//      mod('DamageBonus', 0.2)                     // no tags = applies to every damage instance
//
//  RULES
//   1. Percentages are fractions (0.39), flat values are plain numbers (75). Exception: Arts Intensity
//      and Ignore Resistance are plain points (30 Arts Intensity = 30, 15% Ignore Res = 15).
//   2. `tags` (a list) restrict WHEN a modifier applies: it applies only to damage that carries ALL its tags.
//      Only the "tagged stats" below accept tags. Unknown stat names or tags throw an error on load.
//   3. Several modifiers of the same stat simply add up. "Cryo & Electric Damage" = two modifiers (or use the helper).
//   4. Every stat is kept even if the simulation does not use it yet (HP, DEF, Treatment...). Just enter it.
//   5. Time-limited / conditional effects are NOT written in gear lists; they are triggers (see gear.js sets).
//
//  WIKI TEXT  ->  KEYWORD
//   Strength / Agility / Intellect / Will ........ STR / AGL / INT / WIL            (flat)
//   Main Attribute (flat number) ................. MainAttribute                      (adds to the operator's main attribute)
//   Main Attribute (a percentage) ................ MainAttributeBonus                 (same for Secondary...)
//   Attack (a percentage) ........................ ATKBonus          Attack (flat) ... ATK
//   HP (flat) / HP (%) ........................... HP / HPBonus      Defense .......... DEF
//   Critical Rate / Critical Damage .............. CriticalRate / CriticalDamage
//   Arts Intensity ............................... ArtsIntensity
//   Ultimate Gain Efficiency ..................... UltimateEfficiency      Ultimate Energy Cost (negative %) ... UltimateEnergyCost
//   Stagger Efficiency ........................... StaggerEfficiency
//   Combo Skill Cooldown Reduction ............... ComboSkillCooldownReduction
//   Treatment Bonus / Treatment Received ......... TreatmentBonus / TreatmentReceivedBonus   Shield Applied ... ShieldAppliedBonus
//   Final Damage Reduction ....................... FinalDamageReduction
//   Physical DMG Dealt ........................... mod('DamageBonus', v, ['Physical'])
//   Heat / Electric / Cryo / Nature DMG Dealt .... mod('DamageBonus', v, ['Heat']) ...   (two elements -> two mods, or elementDamage helper)
//   Arts DMG Dealt (all 4 Arts elements) ......... mod('DamageBonus', v, ['Arts'])
//   Basic Attack / Battle Skill / Combo Skill / Ultimate DMG Dealt ... mod('DamageBonus', v, ['BasicAttack'|'BattleSkill'|'ComboSkill'|'Ultimate'])
//   "Skill DMG" (BS + CS + Ult) .................. skillDamage(v) helper (three mods)
//   DMG Dealt vs. Staggered enemies .............. mod('DamageBonus', v, ['Staggered'])
//   Electric Amp / Physical Amp / Any-element Amp  mod('Amp', v, ['Electric']) / ['Physical'] / no tags
//   Ignore Electric Resistance (points) .......... mod('IgnoreResistance', 15, ['Electric'])
//   Physical Susceptibility ...................... mod('Susceptibility', v, ['Physical'])  (enemy-side)
//   Arts Damage Taken ............................ mod('DamageTaken', v, ['Arts'])           (enemy-side)
//   Weakness / Protection ........................ mod('Weakness', v) / mod('Protection', v)
//   Any other multiplicative multiplier .......... mod('MultiplicativeMultiplier', v, tags?)
//
//  TAGS: elements Physical Electric Heat Cryo Nature; Arts (= any of the 4 non-physical elements, added automatically)
//        categories BasicAttack BattleSkill ComboSkill Ultimate Status
//        subtypes FinalStrike Finisher Dive DoT ArtsBurst ArtsReaction PhysicalStatus Shatter ExtraHit
//        NOTE: Arts = Electric/Heat/Nature/Cryo and is present on every such hit, including Burst/Reaction/DoT damage (measured)
//        Staggered (enemy is Staggered), Vulnerable (enemy has Vulnerable stacks), CryoInflictionOrSolidification (enemy has either)
//  Extra stats: STRBonus/AGLBonus/INTBonus/WILBonus (fraction; 'All Attributes +x%' = allAttributesBonus(x) helper), DEFBonus (fraction)
// =====================================================================================
(function () {
  const Endfield = (globalThis.Endfield = globalThis.Endfield || {});

  Endfield.STAT_NAMES = {
    STR: 'flat Strength', AGL: 'flat Agility', INT: 'flat Intellect', WIL: 'flat Will',
    MainAttribute: 'flat, added to the main attribute', MainAttributeBonus: 'fraction, main attribute multiplier (after flat)',
    SecondaryAttribute: 'flat, added to the secondary attribute', SecondaryAttributeBonus: 'fraction, secondary attribute multiplier',
    HP: 'flat HP', HPBonus: 'fraction', DEF: 'flat Defense', ATK: 'flat ATK (added after percentages)', ATKBonus: 'fraction, summed with all other ATK bonuses',
    CriticalRate: 'fraction (base 5%, capped at 100%)', CriticalDamage: 'fraction (base 50%)', ArtsIntensity: 'points',
    UltimateEfficiency: 'fraction, multiplies all UE gained', UltimateEnergyCost: 'fraction, negative reduces cost', StaggerEfficiency: 'fraction, multiplies stagger dealt',
    ComboSkillCooldownReduction: 'fraction (ignored: combo skills have no cooldown)', TreatmentBonus: 'fraction (taggable)', TreatmentReceivedBonus: 'fraction',
    ShieldAppliedBonus: 'fraction', FinalDamageReduction: 'fraction (damage receiver)',
    DamageBonus: 'fraction, Multiplier Group (taggable)', Amp: 'fraction, Amp multiplier (taggable)', IgnoreResistance: 'points (taggable by element)',
    Susceptibility: 'fraction, enemy-side (taggable)', DamageTaken: 'fraction, enemy-side (taggable)', Weakness: 'fraction', Protection: 'fraction, only the strongest applies',
    MultiplicativeMultiplier: 'fraction, own multiplicative factor (taggable)', Resistance: 'points, operator-side resistance (taggable by element)',
  };
  Object.assign(Endfield.STAT_NAMES, { STRBonus: 'fraction', AGLBonus: 'fraction', INTBonus: 'fraction', WILBonus: 'fraction', DEFBonus: 'fraction' });
  Endfield.TAGGED_STATS = ['DamageBonus', 'Amp', 'IgnoreResistance', 'Susceptibility', 'DamageTaken', 'MultiplicativeMultiplier', 'TreatmentBonus', 'Resistance'];
  Endfield.VALID_TAGS = ['Physical', 'Electric', 'Heat', 'Cryo', 'Nature', 'Arts', 'BasicAttack', 'BattleSkill', 'ComboSkill', 'Ultimate', 'Status',
    'FinalStrike', 'Finisher', 'Dive', 'DoT', 'ArtsBurst', 'ArtsReaction', 'PhysicalStatus', 'Shatter', 'ExtraHit', 'Staggered', 'Vulnerable', 'CryoInflictionOrSolidification'];

  // Helpers that expand one wiki line into several modifiers (gear.js flattens these).
  Endfield.mods = {
    skillDamage: (value) => ['BattleSkill', 'ComboSkill', 'Ultimate'].map((tag) => ({ stat: 'DamageBonus', value, tags: [tag] })),
    allAttributesBonus: (value) => ['STR', 'AGL', 'INT', 'WIL'].map((name) => ({ stat: name + 'Bonus', value })),
    elementDamage: (elements, value) => elements.map((element) => ({ stat: 'DamageBonus', value, tags: [element] })),
  };
})();
