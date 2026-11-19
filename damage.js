// Damage engine: one pure function, returns the damage plus every factor for the UI.
(function () {
  const Endfield = (globalThis.Endfield = globalThis.Endfield || {});

  const ARTS_ELEMENTS = ['Electric', 'Heat', 'Cryo', 'Nature'];
  const LINK_BONUS = { BattleSkill: [0, 0.30, 0.45, 0.60, 0.75], Ultimate: [0, 0.20, 0.30, 0.40, 0.50] };
  const FINISHER_MULTIPLIER = { Common: 1, Advanced: 1.25, Elite: 1.5, Alpha: 1.5, Boss: 1.75 };

  const artsIntensityMultiplier = (artsIntensity) => (3 * artsIntensity + 300) / (artsIntensity + 300);
  const defenseMultiplier = (defense) => (defense >= 0 ? 100 / (defense + 100) : 2 - Math.pow(0.99, -defense));

  // statusKind: 'PhysicalStatus' | 'ArtsStatus' (Burst, Reactions, Shatter) | null
  function statusScaling(statusKind, level, artsIntensity) {
    if (!statusKind) return 1;
    const levelDivisor = statusKind === 'PhysicalStatus' ? 394 : 196;
    return (1 + (level - 1) / levelDivisor) * (1 + artsIntensity / 100);
  }

  function criticalMultiplier(criticalMode, rate, damage) {
    switch (criticalMode) {
      case 'mean': return 1 + rate * damage;
      case 'median': return rate < 0.5 ? 1 : 1 + damage;
      case 'always': return 1 + damage;
      default: return 1;
    }
  }

  // instance: { element, category, subtype?, multiplier, statusKind?, linkStacks?, extraTags? }
  //   category: BasicAttack | BattleSkill | ComboSkill | Ultimate | Status
  //   subtype:  FinalStrike | Finisher | Dive | DoT | ArtsBurst | ArtsReaction | PhysicalStatus | Shatter
  // attacker: StatSheet.snapshot()   enemy: { tier, defense, resistance:{}, staggered,
  //   resistanceShred, modifiers:[] (Susceptibility, DamageTaken, Protection, FinalDamageReduction) }
  function computeDamage(instance, attacker, enemy, { criticalMode = 'mean' } = {}) {
    const tags = [instance.element, instance.category];
    if (instance.subtype) tags.push(instance.subtype);
    if (ARTS_ELEMENTS.includes(instance.element)) tags.push('Arts'); // Arts = Electric/Heat/Nature/Cryo; also on Burst/Reaction/DoT hits (measured: Arts Damage Taken boosted an Electric Burst)
    if (enemy.staggered) tags.push('Staggered');
    if (enemy.tags) tags.push(...enemy.tags);
    if (instance.extraTags) tags.push(...instance.extraTags);

    const sumAttacker = (stat) => Endfield.sumModifiers(attacker.modifiers, stat, tags);
    const sumEnemy = (stat) => Endfield.sumModifiers(enemy.modifiers || [], stat, tags);
    const canCritical = instance.subtype !== 'DoT';
    const protections = (enemy.modifiers || []).filter((m) => m.stat === 'Protection').map((m) => m.value);

    let weakness = 1, damageReduction = 1, multiplicative = 1;
    for (const m of attacker.modifiers) {
      if (m.stat === 'Weakness') weakness *= 1 - m.value;
      if (m.stat === 'MultiplicativeMultiplier' && (!m.tags || m.tags.every((t) => tags.includes(t)))) multiplicative *= 1 + m.value;
    }
    for (const m of enemy.modifiers || []) if (m.stat === 'FinalDamageReduction') damageReduction *= 1 - m.value;

    const ignoreResistance = Endfield.sumModifiers(attacker.modifiers, 'IgnoreResistance', tags);
    const linkTable = LINK_BONUS[instance.category];
    const factors = {
      attack: instance.flatDamage !== undefined ? 1 : attacker.attack, // flatDamage: a fixed amount that does not scale with ATK (all other factors still apply)
      baseMultiplier: instance.flatDamage !== undefined ? instance.flatDamage : instance.multiplier,
      statusScaling: statusScaling(instance.statusKind, attacker.level, attacker.artsIntensity),
      multiplierGroup: 1 + sumAttacker('DamageBonus'),
      critical: canCritical ? criticalMultiplier(criticalMode, Math.min(1, attacker.criticalRate + (instance.extraCriticalRate || 0)), attacker.criticalDamage) : 1,
      amp: 1 + sumAttacker('Amp'),
      stagger: enemy.staggered ? 1.3 : 1,
      finisher: instance.subtype === 'Finisher' ? FINISHER_MULTIPLIER[enemy.tier] : 1,
      link: linkTable && instance.linkStacks ? 1 + linkTable[Math.min(4, instance.linkStacks)] : 1,
      weakness,
      susceptibility: 1 + sumEnemy('Susceptibility'),
      damageTaken: 1 + sumEnemy('DamageTaken'),
      damageReduction,
      protection: 1 - (protections.length ? Math.max(...protections) : 0),
      defense: defenseMultiplier(enemy.defense),
      resistance: (100 - ((enemy.resistance[instance.element] || 0) - ignoreResistance - (enemy.resistanceShred || 0))) / 100, // Ignore Resistance and Corrosion lower the enemy's resistance (more damage)
      multiplicative,
    };
    const damage = Object.values(factors).reduce((product, factor) => product * factor, 1);
    return { damage, factors, tags };
  }

  Object.assign(Endfield, { computeDamage, artsIntensityMultiplier, defenseMultiplier, statusScaling, LINK_BONUS, FINISHER_MULTIPLIER });
})();
