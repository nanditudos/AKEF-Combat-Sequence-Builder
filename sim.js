// Simulation core: action list -> timed events -> damage log. Time unit: seconds of combat time.
// Not built yet: Combo/Ultimate/Finisher/Dive, time freeze, inflictions/reactions, triggers, crit counters.
(function () {
  const E = globalThis.Endfield;
  const MAX_SP = 300, SP_REGEN_PER_SECOND = 8, SWITCH_BACK_LOCK = 1, BASIC_ATTACK_RESET_GAP = 1, UE_PER_100_SP = 6.5;

  class Team {
    constructor(startingSP) { this.sp = startingSP; this.spSyncedAt = 0; this.spRegenPausedUntil = 0; this.stacks = {}; }
    syncSP(time) {
      const regenFrom = Math.max(this.spSyncedAt, this.spRegenPausedUntil);
      if (time > regenFrom) this.sp = Math.min(MAX_SP, this.sp + SP_REGEN_PER_SECOND * (time - regenFrom));
      this.spSyncedAt = Math.max(this.spSyncedAt, time);
    }
    addSP(amount, time) { this.syncSP(time); this.sp = amount > 0 ? Math.min(MAX_SP, this.sp + amount) : this.sp + amount; }
    // Stacks expire individually; at the cap the oldest is replaced.
    addStacks(name, count, duration, cap, now) {
      const list = (this.stacks[name] = (this.stacks[name] || []).filter((stack) => stack.expires > now));
      for (let i = 0; i < count; i++) { list.push({ expires: now + duration }); if (list.length > cap) list.shift(); }
    }
    countStacks(name, now) { return (this.stacks[name] || []).filter((stack) => stack.expires > now).length; }
  }

  class EnemyState {
    constructor(data) { this.data = data; this.stagger = 0; this.staggeredUntil = -Infinity; }
    isStaggered(time) { return time < this.staggeredUntil; }
    addStagger(amount, time) {
      if (this.isStaggered(time)) return;
      this.stagger += amount;
      if (this.stagger >= this.data.staggerCapacity) { this.stagger = 0; this.staggeredUntil = time + this.data.staggeredRecovery; }
    }
    forDamage(time) {
      return { tier: this.data.tier, defense: this.data.defense, resistance: this.data.resistance, staggered: this.isStaggered(time), resistanceShred: this.status.resistanceShred(time), modifiers: this.status.modifiers(time) };
    }
  }

  class OperatorState {
    constructor(member, setBonuses) {
      this.definition = member.operator; this.name = member.operator.name; this.potential = member.potential || 0;
      this.sheet = E.buildStatSheet({ ...member, setBonuses });
      this.ultimateEnergy = member.startUltimateEnergy || 0;
      this.lockEnd = 0; this.basicAttackIndex = 0; this.lastAttackEnd = -Infinity; this.switchedAwayAt = -Infinity;
      this.effects = {}; this.flags = {};
      this.stacks = {}; this.stackCounter = 0; this.critCounters = { overall: 0, skill: 0 };
      const piecesPerSet = {};
      for (const piece of member.gearPieces || []) if (piece.set) piecesPerSet[piece.set] = (piecesPerSet[piece.set] || 0) + 1;
      const setTriggers = Object.entries(piecesPerSet).filter(([name, count]) => count >= 3 && setBonuses[name]).flatMap(([name]) => setBonuses[name].triggers || []);
      this.triggers = [...(this.definition.triggers || []), ...((member.weapon && member.weapon.triggers) || []), ...setTriggers].map((trigger) => ({ ...trigger, lastFired: -Infinity }));
    }
    // Stackable effect: every stack has its own timer; at the cap the oldest stack is replaced.
    addStacks(name, count, { modifiers, duration, maxStacks }, now) {
      const stacks = (this.stacks[name] = (this.stacks[name] || []).filter((stack) => {
        if (stack.expires > now) return true;
        this.sheet.removeModifiersFrom(stack.source); return false;
      }));
      for (let i = 0; i < count; i++) {
        if (stacks.length >= maxStacks) this.sheet.removeModifiersFrom(stacks.shift().source);
        const source = `stack:${name}:${this.stackCounter++}`;
        stacks.push({ expires: now + duration, source });
        this.sheet.addModifiers(modifiers.map((m) => ({ ...m, expires: now + duration })), source);
      }
    }
    stackCount(name, now) { return (this.stacks[name] || []).filter((stack) => stack.expires > now).length; }
    // Same-named effect: replaced and refreshed. `state` carries values such as stack amounts.
    setEffect(name, modifiers, duration, now, state) {
      this.sheet.removeModifiersFrom('effect:' + name);
      this.sheet.addModifiers(modifiers.map((m) => ({ ...m, expires: now + duration })), 'effect:' + name);
      this.effects[name] = { state, expires: now + duration };
    }
  }

  class AbilityContext { // what ability scripts see
    constructor(simulation, operator) { Object.assign(this, { simulation, operator, team: simulation.team, enemy: simulation.enemy, potential: operator.potential }); }
    get now() { return this.simulation.now; }
    wait(seconds) { return { seconds }; }
    lockFor(seconds) { this.operator.lockEnd = this.now + seconds; }
    spendSkillPoints(cost) {
      this.team.addSP(-cost, this.now);
      this.shareUltimateEnergyFromSkillPoints(cost);
      if (this.team.sp < 0) this.simulation.warn(`SP negative (${this.team.sp.toFixed(1)}) after ${this.operator.name} cast`);
    }
    returnSkillPoints(amount) { this.team.addSP(amount, this.now); this.shareUltimateEnergyFromSkillPoints(-amount); this.simulation.emit('SkillSPReturned', { source: this, amount }); }
    shareUltimateEnergyFromSkillPoints(netSkillPoints) { // every operator, unless its definition opts out
      for (const op of this.simulation.operators) {
        if (!op.definition.cannotGainUltimateEnergyFromSkillPoints) op.ultimateEnergy += (UE_PER_100_SP * netSkillPoints / 100) * (1 + op.sheet.sum('UltimateEfficiency'));
      }
    }
    snapshotAttacker() { this.operator.sheet.currentTime = this.now; return this.operator.sheet.snapshot(); }
    applyInfliction(element, stacks = 1) { for (let i = 0; i < stacks; i++) this.enemy.status.applyInfliction(this, element); this.simulation.emit('InflictionBatch', { source: this, element, stacks }); }
    applyReaction(element, level) { this.enemy.status.applyReaction(this, element, level); }
    applyArtsBurst(element) { this.enemy.status.applyArtsBurst(this, element); }
    applyVulnerable(stacks = 1) { this.enemy.status.applyVulnerable(this, stacks); }
    applyPhysicalStatus(kind, options) { this.enemy.status.applyPhysicalStatus(this, kind, options); }
    consumeReaction(name) { return this.enemy.status.consumeReaction(name, this); }
    consumeInfliction(element) { return this.enemy.status.consumeInfliction(element, this); }
    gainUltimateEnergy(amount) { this.operator.ultimateEnergy += amount * (1 + this.operator.sheet.sum('UltimateEfficiency')); }
    dealStagger(amount) { this.enemy.addStagger(amount * (1 + this.operator.sheet.sum('StaggerEfficiency')), this.now); }
    hit(instance) { this.simulation.dealDamage(this.operator, this.snapshotAttacker(), instance, this); }
  }

  class Simulation {
    // team: [{ operator, potential, weapon, gearPieces, startUltimateEnergy }]; first member starts controlled.
    constructor({ team, enemy, setBonuses = {}, criticalMode = 'mean', startingSP = 200, initialStagger = 0, startStaggeredFor = 0 }) {
      this.operators = team.map((member) => new OperatorState(member, setBonuses));
      this.team = new Team(startingSP); this.enemy = new EnemyState(enemy); this.criticalMode = criticalMode;
      this.controlled = this.operators[0]; this.now = 0; this.events = []; this.sequenceNumber = 0;
      this.damageLog = []; this.warnings = []; this.timeline = []; this.listeners = []; this.eventLog = [];
      this.enemy.status = new E.StatusEngine(this); this.triggerDepth = 0;
      this.enemy.stagger = initialStagger; // e.g. a boss phase that starts Staggered:
      if (startStaggeredFor > 0) this.enemy.staggeredUntil = startStaggeredFor;
    }
    emit(type, details) { this.eventLog.push({ time: this.now, type, ...details, source: details.source && details.source.operator.name }); for (const listener of this.listeners) listener(type, details); this.dispatchTriggers(type, details); }
    // trigger: { on, by: 'self' | 'any', cooldown, when({event, owner, simulation, now}), apply({event, owner, simulation, now}) }
    dispatchTriggers(type, event) {
      if (this.triggerDepth > 8) return;
      this.triggerDepth++;
      for (const owner of this.operators) {
        for (const trigger of owner.triggers) {
          if (trigger.on !== type) continue;
          if ((trigger.by || 'self') === 'self' && (!event.source || event.source.operator !== owner)) continue;
          if (this.now - trigger.lastFired < (trigger.cooldown || 0)) continue;
          const context = { event, owner, simulation: this, now: this.now };
          if (trigger.when && !trigger.when(context)) continue;
          trigger.lastFired = this.now;
          trigger.apply(context);
        }
      }
      this.triggerDepth--;
    }
    applyToTeam(name, modifiers, duration) { for (const operator of this.operators) operator.setEffect(name, modifiers, duration, this.now, {}); }
    dealDamage(operator, snapshot, instance, source = { operator }) {
      const result = E.computeDamage(instance, snapshot, this.enemy.forDamage(this.now), { criticalMode: this.criticalMode });
      this.damageLog.push({ time: this.now, operator: operator.name, category: instance.category, subtype: instance.subtype, multiplier: instance.multiplier, damage: result.damage, factors: result.factors });
      if (instance.subtype !== 'DoT') { // expected-value crit counters: +crit rate per hit, event at 1
        const counters = operator.critCounters, rate = snapshot.criticalRate;
        const advance = (key, scope) => { counters[key] += rate; if (counters[key] >= 1 - 1e-9) { counters[key] -= 1; this.emit('CriticalHit', { source, scope }); } };
        advance('overall', 'overall');
        if (instance.category === 'BattleSkill' || instance.category === 'ComboSkill') advance('skill', 'skill');
      }
      return result.damage;
    }
    warn(text) { this.warnings.push({ time: this.now, text }); }
    schedule(time, callback) { this.events.push({ time, order: this.sequenceNumber++, callback }); this.events.sort((a, b) => a.time - b.time || a.order - b.order); }
    runUntil(time) {
      while (this.events.length && this.events[0].time <= time) { const event = this.events.shift(); this.now = event.time; event.callback(); }
      this.now = time;
    }
    runAbility(generator) {
      const step = () => { const next = generator.next(); if (!next.done) this.schedule(this.now + next.value.seconds, step); };
      step();
    }

    // actionList: [{ operator: index, action: 'BasicAttack' | 'BattleSkill' | 'Switch', extraDelay? }]
    run(actionList) {
      let previousStart = 0;
      actionList.forEach((entry, index) => {
        const operator = this.operators[entry.operator];
        let start = Math.max(operator.lockEnd, previousStart) + (entry.extraDelay || 0);
        if (entry.action === 'Switch') start = Math.max(start, operator.switchedAwayAt + SWITCH_BACK_LOCK);
        this.runUntil(start);
        previousStart = start;
        const record = { index, operator: operator.name, action: entry.action, start };
        this.timeline.push(record);
        this.perform(entry, operator, start);
        record.end = Math.max(start, operator.lockEnd);
      });
      this.horizon = Math.max(0, ...this.operators.map((operator) => operator.lockEnd));
      this.runUntil(this.horizon);
      this.team.syncSP(this.horizon);
      return this.summary();
    }

    perform(entry, operator, start) {
      const ability = new AbilityContext(this, operator);
      ability.category = entry.action;
      if (entry.action === 'Switch') {
        if (this.controlled !== operator) { this.controlled.switchedAwayAt = start; this.controlled.basicAttackIndex = 0; operator.basicAttackIndex = 0; this.controlled = operator; }
      } else if (entry.action === 'BattleSkill') {
        this.emit('SkillCast', { source: ability, category: 'BattleSkill' });
        this.runAbility(operator.definition.kit.battleSkill.run(ability));
      } else if (entry.action === 'BasicAttack') {
        const sequence = operator.definition.kit.basicAttackSequence;
        if (start - operator.lastAttackEnd > BASIC_ATTACK_RESET_GAP || operator.basicAttackIndex >= sequence.length) operator.basicAttackIndex = 0;
        const attack = sequence[operator.basicAttackIndex];
        const isControlled = this.controlled === operator; // non-controlled Final Strikes deal damage only
        operator.basicAttackIndex = attack.finalStrike ? 0 : operator.basicAttackIndex + 1;
        operator.lastAttackEnd = start + attack.duration;
        ability.lockFor(attack.duration);
        this.runAbility((function* () {
          yield ability.wait(attack.duration);
          ability.hit({ element: operator.definition.kit.basicAttackElement, category: 'BasicAttack', subtype: attack.finalStrike ? 'FinalStrike' : undefined, multiplier: attack.multiplier });
          if (attack.finalStrike && isControlled) { ability.team.addSP(attack.skillPointsRestored, ability.now); ability.dealStagger(attack.stagger); }
        })());
      } else if (entry.action === 'Custom') { // scenario/test scripts: { script: function* (ability) {...}, lock?: seconds }
        ability.lockFor(entry.lock || 0);
        this.runAbility(entry.script(ability));
      } else {
        this.warn(`Unsupported action: ${entry.action}`);
      }
    }

    summary() {
      const totalDamage = this.damageLog.reduce((sum, hit) => sum + hit.damage, 0);
      const damageByOperator = {};
      let cumulative = 0, enemyDeathTime = null;
      for (const hit of this.damageLog) {
        damageByOperator[hit.operator] = (damageByOperator[hit.operator] || 0) + hit.damage;
        cumulative += hit.damage;
        if (enemyDeathTime === null && cumulative >= this.enemy.data.hp) enemyDeathTime = hit.time;
      }
      const wastedDamage = Math.max(0, totalDamage - this.enemy.data.hp);
      return { totalDamage, damageByOperator, horizon: this.horizon, dps: totalDamage / (this.horizon || 1), enemyDeathTime, wastedDamage,
        wastedPercent: totalDamage ? (100 * wastedDamage) / totalDamage : 0, finalSP: this.team.sp, warnings: this.warnings,
        timeline: this.timeline, damageLog: this.damageLog };
    }
  }

  E.Simulation = Simulation;
})();
