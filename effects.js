// Generic effect delivery used by trigger `give` specs, plus "armed" effects (buffs for the NEXT cast of some skill).
//   give: { to: 'self'|'team'|'others'|'selfAndOthers'|'otherElements'|'targets'|'enemy', name, mods (array or fn(context)),
//           duration, maxStacks?, count? (number or fn), othersScale? (selfAndOthers), armedFor?: ['BattleSkill',...] }
//   Without maxStacks the effect refreshes ("effects of the same name cannot stack"); with maxStacks every stack has its own timer.
(function () {
  const E = globalThis.Endfield;
  const operatorMethods = E.OperatorState.prototype, simulationMethods = E.Simulation.prototype;

  // Armed stacks are held (inactive) until a matching skill is cast; active for that cast only.
  operatorMethods.addArmedStacks = function (name, count, { modifiers, duration, maxStacks, armedFor }, now) {
    this.armed = this.armed || {};
    if (this.simulation) this.simulation.logEffect(this.name, name, 'armed');
    const group = (this.armed[name] = this.armed[name] || { armedFor, modifiers, stacks: [] });
    group.modifiers = modifiers; group.stacks = group.stacks.filter((stack) => stack.expires > now);
    for (let i = 0; i < count; i++) { if (group.stacks.length >= maxStacks) group.stacks.shift(); group.stacks.push({ expires: now + duration }); }
  };
  operatorMethods.consumeStacks = function (name, count, now) {
    const stacks = (this.stacks[name] || []).filter((stack) => stack.expires > now);
    const taken = Math.min(count, stacks.length);
    for (let i = 0; i < taken; i++) this.sheet.removeModifiersFrom(stacks.shift().source);
    this.stacks[name] = stacks;
    return taken;
  };
  simulationMethods.activateArmedEffects = function (event) {
    const caster = event.source.operator;
    for (const [name, group] of Object.entries(caster.armed || {})) {
      if (!group.armedFor.includes(event.category)) continue;
      const live = group.stacks.filter((stack) => stack.expires > this.now);
      group.stacks = [];
      live.forEach((stack, index) => {
        const source = `armed:${name}:${index}`;
        caster.sheet.addModifiers(group.modifiers, source);
        (event.source.armedSources = event.source.armedSources || []).push(source);
      });
    }
  };
  simulationMethods.releaseArmedEffects = function (ability) {
    for (const source of (ability && ability.armedSources) || []) ability.operator.sheet.removeModifiersFrom(source);
    if (ability) ability.armedSources = [];
  };

  simulationMethods.giveEffect = function (spec, context) {
    const { owner, now } = context;
    const modifiers = typeof spec.mods === 'function' ? spec.mods(context) : spec.mods;
    const count = typeof spec.count === 'function' ? spec.count(context) : spec.count || 1;
    const applyTo = (operator, scale = 1) => {
      const scaled = scale === 1 ? modifiers : modifiers.map((m) => ({ ...m, value: m.value * scale }));
      if (spec.armedFor) operator.addArmedStacks(spec.name, count, { modifiers: scaled, duration: spec.duration, maxStacks: spec.maxStacks || 1, armedFor: spec.armedFor }, now);
      else if (spec.maxStacks) operator.addStacks(spec.name, count, { modifiers: scaled, duration: spec.duration, maxStacks: spec.maxStacks }, now);
      else operator.setEffect(spec.name, scaled, spec.duration, now, {});
    };
    const others = this.operators.filter((operator) => operator !== owner);
    switch (spec.to) {
      case 'enemy': this.enemy.status.setEffect(spec.name, modifiers, spec.duration, now); break;
      case 'team': this.operators.forEach((operator) => applyTo(operator)); break;
      case 'others': others.forEach((operator) => applyTo(operator)); break;
      case 'selfAndOthers': applyTo(owner); others.forEach((operator) => applyTo(operator, spec.othersScale)); break;
      case 'otherElements': this.operators.filter((operator) => operator.definition.element !== owner.definition.element).forEach((operator) => applyTo(operator)); break;
      case 'targets': (context.event.targets || []).forEach((operator) => applyTo(operator)); break;
      default: applyTo(owner);
    }
  };

  E.dsl = { // helpers for operator/weapon/set definitions
    dmg: (value, ...tags) => E.mod('DamageBonus', value, tags.length ? tags : undefined),
    atk: (value) => E.mod('ATKBonus', value),
    intensity: (value) => E.mod('ArtsIntensity', value),
    give: (to, name, mods, duration, extra = {}) => ({ to, name, mods, duration, ...extra }),
  };
})();
