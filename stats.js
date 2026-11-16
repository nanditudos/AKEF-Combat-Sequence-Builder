// Stat engine: modifiers -> attributes -> ATK. No combat logic here.
(function () {
  const Endfield = (globalThis.Endfield = globalThis.Endfield || {});
  Endfield.data = Endfield.data || {};

  // mod('WIL', 75)  |  mod('DamageBonus', 0.149, ['Cryo'])
  // A tagged modifier applies only if ALL its tags are present on the damage instance.
  const mod = (stat, value, tags) => (tags ? { stat, value, tags } : { stat, value });

  function sumModifiers(modifiers, statName, damageTags) {
    let total = 0;
    for (const modifier of modifiers) {
      if (modifier.stat !== statName) continue;
      if (modifier.tags && !modifier.tags.every((tag) => damageTags && damageTags.includes(tag))) continue;
      total += modifier.value;
    }
    return total;
  }

  class StatSheet {
    constructor({ baseStats, mainAttribute, secondaryAttribute, weaponAttack = 0, level = 90 }) {
      Object.assign(this, { baseStats, mainAttribute, secondaryAttribute, weaponAttack, level });
      this.modifiers = [];
    }
    addModifiers(modifierList, source) { for (const m of modifierList) this.modifiers.push({ ...m, source }); }
    removeModifiersFrom(source) { this.modifiers = this.modifiers.filter((m) => m.source !== source); }
    sum(statName, damageTags) { return sumModifiers(this.modifiers, statName, damageTags); }

    // (base + flat incl. Main/Secondary Attribute) * (1 + Main/Secondary Attribute Bonus)
    attribute(attributeName) {
      const isMain = attributeName === this.mainAttribute;
      const isSecondary = attributeName === this.secondaryAttribute;
      let flat = this.baseStats[attributeName] + this.sum(attributeName);
      let bonus = 0;
      if (isMain) { flat += this.sum('MainAttribute'); bonus += this.sum('MainAttributeBonus'); }
      if (isSecondary) { flat += this.sum('SecondaryAttribute'); bonus += this.sum('SecondaryAttributeBonus'); }
      return flat * (1 + bonus);
    }
    // ((operator ATK + weapon ATK) * (1 + sum ATK Bonus) + flat ATK) * (1 + 0.005*Main + 0.002*Secondary)
    attack() {
      const attributeBonus = 1 + 0.005 * this.attribute(this.mainAttribute) + 0.002 * this.attribute(this.secondaryAttribute);
      return ((this.baseStats.ATK + this.weaponAttack) * (1 + this.sum('ATKBonus')) + this.sum('ATK')) * attributeBonus;
    }
    criticalRate() { return Math.min(1, Math.max(0, 0.05 + this.sum('CriticalRate'))); }
    criticalDamage() { return 0.5 + this.sum('CriticalDamage'); }
    artsIntensity() { return this.sum('ArtsIntensity'); }
    ultimateEnergyCost(baseCost) { return baseCost * (1 + this.sum('UltimateEnergyCost')); }

    // Frozen copy of everything damage needs (used for "snapshot at application").
    snapshot() {
      return {
        attack: this.attack(), criticalRate: this.criticalRate(), criticalDamage: this.criticalDamage(),
        artsIntensity: this.artsIntensity(), level: this.level, modifiers: this.modifiers.map((m) => ({ ...m })),
      };
    }
  }

  // Builds a StatSheet from data. Only stat modifiers here; triggers/abilities come later.
  // Passives with a `condition` are runtime effects and are skipped here.
  function buildStatSheet({ operator, potential = 0, weapon, gearPieces = [], setBonuses = {} }) {
    const sheet = new StatSheet({
      baseStats: operator.baseStats, mainAttribute: operator.mainAttribute,
      secondaryAttribute: operator.secondaryAttribute, weaponAttack: weapon ? weapon.baseAttack : 0,
    });
    for (const passive of operator.passives || []) {
      if (passive.condition || (passive.minPotential || 0) > potential) continue;
      sheet.addModifiers(passive.modifiers, 'passive:' + passive.name);
    }
    if (weapon) sheet.addModifiers(weapon.modifiers, 'weapon:' + weapon.name);
    const piecesPerSet = {};
    for (const piece of gearPieces) {
      sheet.addModifiers(piece.modifiers, 'gear:' + piece.name);
      if (piece.set) piecesPerSet[piece.set] = (piecesPerSet[piece.set] || 0) + 1;
    }
    for (const [setName, count] of Object.entries(piecesPerSet)) {
      if (count >= 3 && setBonuses[setName]) sheet.addModifiers(setBonuses[setName].modifiers, 'set:' + setName);
    }
    return sheet;
  }

  Endfield.mod = mod;
  Endfield.sumModifiers = sumModifiers;
  Endfield.StatSheet = StatSheet;
  Endfield.buildStatSheet = buildStatSheet;
})();
