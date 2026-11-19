// Stat engine: modifiers -> attributes -> ATK. No combat logic here.
(function () {
  const Endfield = (globalThis.Endfield = globalThis.Endfield || {});
  Endfield.data = Endfield.data || {};

  // mod('WIL', 75)  |  mod('DamageBonus', 0.149, ['Cryo'])
  // A tagged modifier applies only if ALL its tags are present on the damage instance.
  const mod = (stat, value, tags) => {
    if (!Endfield.STAT_NAMES[stat]) throw new Error(`Unknown stat "${stat}". See nomenclature.js for valid names.`);
    if (tags) {
      if (!Endfield.TAGGED_STATS.includes(stat)) throw new Error(`Stat "${stat}" does not accept tags.`);
      for (const tag of tags) if (!Endfield.VALID_TAGS.includes(tag)) throw new Error(`Unknown tag "${tag}" on ${stat}.`);
    }
    return tags ? { stat, value, tags } : { stat, value };
  };

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
    constructor({ baseStats, mainAttribute, secondaryAttribute, weaponAttack = 0, level = 90, derived = {} }) {
      Object.assign(this, { baseStats, mainAttribute, secondaryAttribute, weaponAttack, level, derived }); // derived: { DEF: (sheet) => extra value from live stats }
      this.modifiers = [];
      this.currentTime = 0; // modifiers with `expires` <= currentTime are inactive
    }
    activeModifiers() { return this.modifiers.filter((m) => m.expires === undefined || m.expires > this.currentTime); }
    addModifiers(modifierList, source) { for (const m of modifierList) this.modifiers.push({ ...m, source }); }
    removeModifiersFrom(source) { this.modifiers = this.modifiers.filter((m) => m.source !== source); }
    // permanentOnly: only passives/weapon/gear/set modifiers (no temporary buffs), e.g. for Type 42's INT vs WIL check
    sum(statName, damageTags, permanentOnly = false) {
      const list = permanentOnly ? this.modifiers.filter((m) => /^(passive|weapon|gear|set):/.test(m.source)) : this.activeModifiers();
      return sumModifiers(list, statName, damageTags);
    }

    // (base + flat incl. Main/Secondary Attribute) * (1 + Main/Secondary Attribute Bonus)
    attribute(attributeName, permanentOnly = false) {
      const isMain = attributeName === this.mainAttribute;
      const isSecondary = attributeName === this.secondaryAttribute;
      const total = (stat) => this.sum(stat, undefined, permanentOnly);
      let flat = this.baseStats[attributeName] + total(attributeName);
      let bonus = total(attributeName + 'Bonus');
      if (isMain) { flat += total('MainAttribute'); bonus += total('MainAttributeBonus'); }
      if (isSecondary) { flat += total('SecondaryAttribute'); bonus += total('SecondaryAttributeBonus'); }
      return flat * (1 + bonus);
    }
    // ((operator ATK + weapon ATK) * (1 + sum ATK Bonus) + flat ATK) * (1 + 0.005*Main + 0.002*Secondary)
    attack() {
      const attributeBonus = 1 + 0.005 * this.attribute(this.mainAttribute) + 0.002 * this.attribute(this.secondaryAttribute);
      return ((this.baseStats.ATK + this.weaponAttack) * (1 + this.sum('ATKBonus')) + this.sum('ATK')) * attributeBonus;
    }
    // Every intermediate value of attack(), for comparing with the in-game character screen.
    attackBreakdown() {
      const main = this.attribute(this.mainAttribute), secondary = this.attribute(this.secondaryAttribute);
      const attributeMultiplier = 1 + 0.005 * main + 0.002 * secondary;
      const atkBonusSum = this.sum('ATKBonus'), flatAtk = this.sum('ATK');
      const baseAttack = this.baseStats.ATK + this.weaponAttack;
      return {
        operatorATK: this.baseStats.ATK, weaponATK: this.weaponAttack, atkBonusSum, flatAtk,
        mainAttribute: this.mainAttribute, mainValue: main, secondaryAttribute: this.secondaryAttribute, secondaryValue: secondary,
        mainContribution: 0.005 * main, secondaryContribution: 0.002 * secondary, attributeMultiplier,
        attackBeforeAttributes: baseAttack * (1 + atkBonusSum) + flatAtk, attack: this.attack(),
      };
    }
    defense() { return ((this.baseStats.DEF || 0) + this.sum('DEF') + (this.derived.DEF ? this.derived.DEF(this) : 0)) * (1 + this.sum('DEFBonus')); }
    criticalRate() { return Math.min(1, Math.max(0, 0.05 + this.sum('CriticalRate'))); }
    criticalDamage() { return 0.5 + this.sum('CriticalDamage'); }
    artsIntensity() { return this.sum('ArtsIntensity'); }
    ultimateEnergyCost(baseCost) { return baseCost * (1 + this.sum('UltimateEnergyCost')); }

    // Frozen copy of everything damage needs (used for "snapshot at application").
    snapshot() {
      return {
        attack: this.attack(), criticalRate: this.criticalRate(), criticalDamage: this.criticalDamage(),
        artsIntensity: this.artsIntensity(), level: this.level, modifiers: this.activeModifiers().map((m) => ({ ...m })),
      };
    }
  }

  // Builds a StatSheet from data. Only stat modifiers here; triggers/abilities come later.
  // Passives with a `condition` are runtime effects and are skipped here.
  function buildStatSheet({ operator, potential = 0, weapon, gearPieces = [], setBonuses = {} }) {
    const sheet = new StatSheet({
      baseStats: operator.baseStats, mainAttribute: operator.mainAttribute,
      secondaryAttribute: operator.secondaryAttribute, weaponAttack: weapon ? weapon.baseAttack : 0, derived: operator.derived,
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
