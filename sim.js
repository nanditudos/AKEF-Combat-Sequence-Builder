// Simulation core: action list -> timed events -> damage log. Time unit: seconds of combat time.
// Not built yet: Combo/Ultimate/Finisher/Dive, time freeze, inflictions/reactions, triggers, crit counters.
(function () {
  const E = globalThis.Endfield;
  const MAX_SP = 300, SP_REGEN_PER_SECOND = 8, SWITCH_BACK_LOCK = 1, BASIC_ATTACK_RESET_GAP = 1, UE_PER_100_SP = 6.5, COMBO_WINDOW = 10, DEFAULT_ACTION_DURATION = 1;

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
      for (let i = 0; i < count; i++) {
        list.push({ expires: now + duration, record: this.simulation && this.simulation.logEffect('Team', name, { end: now + duration, stack: true }) });
        if (list.length > cap) { const removed = list.shift(); if (this.simulation) this.simulation.endEffect(removed.record); }
      }
    }
    countStacks(name, now) { return (this.stacks[name] || []).filter((stack) => stack.expires > now).length; }
  }

  class EnemyState {
    constructor(data) { this.data = data; this.stagger = 0; this.staggeredUntil = -Infinity; this.finisherUsed = false; }
    finisherPending(time) { return this.isStaggered(time) && !this.finisherUsed; } // one Finisher per Staggered window
    isStaggered(time) { return time < this.staggeredUntil; }
    addStagger(amount, time) {
      if (this.isStaggered(time)) return;
      this.stagger += amount;
      if (this.stagger >= this.data.staggerCapacity) { this.stagger = 0; this.staggeredUntil = time + this.data.staggeredRecovery; this.finisherUsed = false; if (this.simulation) this.simulation.logEffect('Enemy', 'Staggered', { end: this.staggeredUntil }); }
    }
    forDamage(time) {
      return { tier: this.data.tier, defense: this.data.defense, resistance: this.data.resistance, staggered: this.isStaggered(time), resistanceShred: this.status.resistanceShred(time), modifiers: this.status.modifiers(time), tags: this.status.tags(time) };
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
      this.form = null; this.formUntil = -Infinity; this.sequenceKey = 'base'; this.comboWindowUntil = -Infinity;
      const combo = this.definition.kit && this.definition.kit.comboSkill; // combo skill trigger conditions open a 10s window
      for (const windowTrigger of (combo && combo.windowTriggers) || []) this.triggers.push({ on: windowTrigger.on, by: 'any', when: windowTrigger.when, apply: ({ now }) => { this.comboWindowUntil = now + COMBO_WINDOW; }, lastFired: -Infinity });
    }
    inForm(name, now) { return this.form === name && this.formUntil > now; }
    currentForm(now) { return this.form && this.formUntil > now ? ((this.definition.kit.forms || {})[this.form] || {}) : null; }
    activeSequence(now) { const form = this.currentForm(now); return form && form.basicAttackSequence ? { key: this.form, sequence: form.basicAttackSequence } : { key: 'base', sequence: this.definition.kit.basicAttackSequence }; }
    receiveUltimateEnergy(amount, now) { // blocked while e.g. a form forbids gaining UE; efficiency scales gains
      this.sheet.currentTime = now;
      if (amount > 0 && (this.flags.blockUltimateEnergyUntil || 0) > now) return;
      this.ultimateEnergy += amount * (1 + this.sheet.sum('UltimateEfficiency'));
    }
    // Stackable effect: every stack has its own timer; at the cap the oldest stack is replaced.
    addStacks(name, count, { modifiers, duration, maxStacks }, now) {
      const stacks = (this.stacks[name] = (this.stacks[name] || []).filter((stack) => {
        if (stack.expires > now) return true;
        this.sheet.removeModifiersFrom(stack.source); return false;
      }));
      for (let i = 0; i < count; i++) {
        if (stacks.length >= maxStacks) { const removed = stacks.shift(); this.sheet.removeModifiersFrom(removed.source); if (this.simulation) this.simulation.endEffect(removed.record); }
        const source = `stack:${name}:${this.stackCounter++}`;
        const record = this.simulation && !this.simulation.suppressOperatorLog ? this.simulation.logEffect(this.name, name, { end: now + duration, stack: true }) : null;
        stacks.push({ expires: now + duration, source, record });
        this.sheet.addModifiers(modifiers.map((m) => ({ ...m, expires: now + duration })), source);
      }
    }
    stackCount(name, now) { return (this.stacks[name] || []).filter((stack) => stack.expires > now).length; }
    // Same-named effect: replaced and refreshed. `state` carries values such as stack amounts.
    setEffect(name, modifiers, duration, now, state) {
      if (this.simulation && !this.simulation.suppressOperatorLog) this.simulation.logEffect(this.name, name, { end: now + duration });
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
    restoreSkillPoints(amount) { this.team.addSP(amount, this.now); this.simulation.emit('SPRestored', { source: this, amount }); } // fires 'restored' triggers; returns do not
    returnSkillPoints(amount) { this.team.addSP(amount, this.now); this.shareUltimateEnergyFromSkillPoints(-amount); this.simulation.emit('SkillSPReturned', { source: this, amount }); }
    shareUltimateEnergyFromSkillPoints(netSkillPoints) { // every operator, unless its definition opts out
      for (const op of this.simulation.operators) {
        if (!op.definition.cannotGainUltimateEnergyFromSkillPoints) op.receiveUltimateEnergy((UE_PER_100_SP * netSkillPoints) / 100, this.now);
      }
    }
    snapshotAttacker() { this.operator.sheet.currentTime = this.now; return this.operator.sheet.snapshot(); }
    applyInfliction(element, stacks = 1) { for (let i = 0; i < stacks; i++) this.enemy.status.applyInfliction(this, element); this.simulation.emit('InflictionBatch', { source: this, element, stacks }); }
    applyReaction(element, level, options) { this.enemy.status.applyReaction(this, element, level, options); }
    applyArtsBurst(element) { this.enemy.status.applyArtsBurst(this, element); }
    applyVulnerable(stacks = 1) { this.enemy.status.applyVulnerable(this, stacks); }
    applyPhysicalStatus(kind, options) { return this.enemy.status.applyPhysicalStatus(this, kind, options); } // -> { effective, stacksConsumed }
    consumeReaction(name) { return this.enemy.status.consumeReaction(name, this); }
    consumeInfliction(element) { return this.enemy.status.consumeInfliction(element, this); }
    gainUltimateEnergy(amount) { this.operator.receiveUltimateEnergy(amount, this.now); }
    dealStagger(amount) { this.enemy.addStagger(amount * (1 + this.operator.sheet.sum('StaggerEfficiency')), this.now); }
    applyEffect(name, modifiers, duration, state) { // operator effect; announces Amp gains
      this.operator.setEffect(name, modifiers, duration, this.now, state);
      if (modifiers.some((m) => m.stat === 'Amp')) this.simulation.emit('AmpGained', { source: this, element: (modifiers.find((m) => m.stat === 'Amp').tags || [])[0] });
    }
    applySusceptibility(element, value, duration) { // element: 'Physical' | 'Arts' | 'Heat' ...
      this.enemy.status.setEffect('Susceptibility:' + element, [{ stat: 'Susceptibility', value, tags: [element] }], duration, this.now);
      this.simulation.logEffect('Enemy', element + ' Susceptibility', { end: this.now + duration });
      this.simulation.emit('SusceptibilityApplied', { source: this, element });
    }
    // Event-only statuses (no mechanics yet): OriginiumCrystalsApplied, ImmobilizationApplied, WeaknessApplied, LinkGranted, AmpGranted
    applyDynamicSusceptibility(element, duration, valueAt) { // value re-evaluated at every hit while active
      this.enemy.status.setDynamicEffect('Susceptibility:' + element, duration, (time) => [{ stat: 'Susceptibility', value: valueAt(time), tags: [element] }]);
      this.simulation.logEffect('Enemy', element + ' Susceptibility', { end: this.now + duration });
      this.simulation.emit('SusceptibilityApplied', { source: this, element });
    }
    announce(type, details = {}) { this.simulation.emit(type, { source: this, ...details }); }
    grantTreatment(targets) { this.simulation.emit('TreatmentGranted', { source: this, targets: targets || this.simulation.operators }); }
    spendUltimateEnergy(baseCost) { // cost includes Ultimate Energy Cost modifiers; shortfall only warns
      this.operator.sheet.currentTime = this.now;
      const cost = this.operator.sheet.ultimateEnergyCost(baseCost);
      if (this.operator.ultimateEnergy < cost - 1e-9) this.simulation.warn(`${this.operator.name}: ultimate cast with ${this.operator.ultimateEnergy.toFixed(1)}/${cost.toFixed(1)} UE`);
      this.operator.ultimateEnergy -= cost;
    }
    enterForm(name, duration) { this.simulation.logEffect(this.operator.name, 'Form: ' + name, { end: this.now + duration }); Object.assign(this.operator, { form: name, formUntil: this.now + duration, basicAttackIndex: 0 }); }
    setLabel(text) { if (this.record) this.record.label = text; } // action name shown in the sequence
    trackState(name, duration) { return this.simulation.logEffect(this.operator.name, name, { end: this.now + duration, stack: true }); } // UI-only state (stances, arrays)
    endState(record) { this.simulation.endEffect(record); }
    background(generator) { this.simulation.runAbility(generator, this, true); } // keeps running after the ability's lock ends
    applyImprisonment(duration, onNaturalEnd) { this.enemy.status.applyImprisonment(this, duration, onNaturalEnd); }
    endImprisonment() { this.enemy.status.endImprisonment(); }
    extendLift(until) { this.enemy.status.extendLift(until); }
    hit(instance) { this.simulation.dealDamage(this.operator, this.snapshotAttacker(), instance, this); }
  }

  class Simulation {
    // team: [{ operator, potential, weapon, gearPieces, startUltimateEnergy }]; first member starts controlled.
    constructor({ team, enemy, setBonuses = {}, criticalMode = 'mean', startingSP = 200, initialStagger = 0, startStaggeredFor = 0 }) {
      this.operators = team.map((member) => new OperatorState(member, setBonuses));
      this.team = new Team(startingSP); this.enemy = new EnemyState(enemy); this.criticalMode = criticalMode;
      this.controlled = this.operators[0]; this.now = 0; this.events = []; this.sequenceNumber = 0;
      this.damageLog = []; this.warnings = []; this.timeline = []; this.listeners = []; this.eventLog = [];
      this.enemy.status = new E.StatusEngine(this); this.triggerDepth = 0; this.flags = {}; this.effectTimeline = []; this.orderCounter = 0; this.currentEntryIndex = undefined; this.suppressOperatorLog = false;
      for (const operator of this.operators) operator.simulation = this;
      this.team.simulation = this; this.enemy.simulation = this;
      this.enemy.stagger = initialStagger; // e.g. a boss phase that starts Staggered:
      if (startStaggeredFor > 0) this.enemy.staggeredUntil = startStaggeredFor;
    }
    emit(type, details) { this.eventLog.push({ time: this.now, type, ...details, source: details.source && details.source.operator.name }); for (const listener of this.listeners) listener(type, details); if (type === 'SkillCast') this.activateArmedEffects(details);
      this.dispatchTriggers(type, details); }
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
          if (trigger.give) this.giveEffect(trigger.give, context);
          if (trigger.apply) trigger.apply(context);
        }
      }
      this.triggerDepth--;
    }
    applyToTeam(name, modifiers, duration) { this.giveEffect({ to: 'team', name, mods: modifiers, duration }, { owner: this.operators[0], now: this.now, event: {} }); }
    dealDamage(operator, snapshot, instance, source = { operator }) {
      const result = E.computeDamage(instance, snapshot, this.enemy.forDamage(this.now), { criticalMode: this.criticalMode });
      this.damageLog.push({ time: this.now, entry: this.currentEntryIndex !== undefined ? this.currentEntryIndex : source.entryIndex, operator: operator.name, element: instance.element, category: instance.category, subtype: instance.subtype, multiplier: instance.multiplier, damage: result.damage, factors: result.factors });
      if (instance.subtype !== 'DoT') { // expected-value crit counters: +crit rate per hit, event at 1
        const counters = operator.critCounters, rate = Math.min(1, snapshot.criticalRate + (instance.extraCriticalRate || 0));
        const advance = (key, scope) => { counters[key] += rate; if (counters[key] >= 1 - 1e-9) { counters[key] -= 1; this.emit('CriticalHit', { source, scope }); } };
        advance('overall', 'overall');
        if (instance.category === 'BattleSkill' || instance.category === 'ComboSkill') advance('skill', 'skill');
      }
      this.emit('DamageDealt', { source, category: instance.category, subtype: instance.subtype, element: instance.element });
      return result.damage;
    }
    // Effect timeline for the UI. target: operator name | 'Team' | 'Enemy'. Same-named non-stack effects refresh instead of duplicating.
    logEffect(target, name, { detail = '', end = Infinity, stack = false } = {}) {
      if (!stack) {
        const open = this.effectTimeline.find((r) => r.target === target && r.name === name && !r.stack && r.end > this.now);
        if (open) { open.end = end; open.detail = detail || open.detail; return open; }
      }
      const record = { target, name, detail, stack, start: this.now, end, entry: this.currentEntryIndex, order: ++this.orderCounter, endOrder: Infinity, endEntry: undefined };
      this.effectTimeline.push(record);
      return record;
    }
    logInstant(target, name, detail = '') { const record = this.logEffect(target, name, { detail, stack: true }); this.endEffect(record); return record; }
    endEffect(record, time = this.now) { if (record && record.end > time) { record.end = time; record.endOrder = ++this.orderCounter; record.endEntry = this.currentEntryIndex; } }
    endEffectsNamed(target, name) { for (const record of this.effectTimeline) if (record.target === target && record.name === name && record.end > this.now) this.endEffect(record); }
    contextFor(operator, category) { const ability = new AbilityContext(this, operator); ability.category = category; return ability; }
    warn(text) { this.warnings.push({ time: this.now, text }); }
    schedule(time, callback) {
      const entryIndex = this.currentEntryIndex; // scheduled work stays attributed to the action that started it
      const wrapped = () => { const previous = this.currentEntryIndex; this.currentEntryIndex = entryIndex; try { callback(); } finally { this.currentEntryIndex = previous; } };
      this.events.push({ time, order: this.sequenceNumber++, callback: wrapped }); this.events.sort((a, b) => a.time - b.time || a.order - b.order); }
    runUntil(time) {
      while (this.events.length && this.events[0].time <= time) { const event = this.events.shift(); this.now = event.time; event.callback(); }
      this.now = time;
    }
    runAbility(generator, ability, background = false) {
      const step = () => {
        const next = generator.next();
        if (!next.done) this.schedule(this.now + next.value.seconds, step);
        else if (!background) { this.emit('SkillEnd', { source: ability }); this.releaseArmedEffects(ability); }
      };
      step();
    }

    // actionList: [{ operator: index, action: 'BasicAttack'|'BattleSkill'|'ComboSkill'|'Ultimate'|'Finisher'|'DiveAttack'|'Switch'|'Custom', extraDelay? }]
    run(actionList) {
      let previousStart = 0;
      for (const operator of this.operators) this.emit('BattleStart', { source: { operator } });
      actionList.forEach((entry, index) => {
        const operator = this.operators[entry.operator];
        let start = Math.max(operator.lockEnd, previousStart) + (entry.extraDelay || 0);
        if (entry.action === 'Switch') start = Math.max(start, operator.switchedAwayAt + SWITCH_BACK_LOCK);
        this.runUntil(start);
        const record = { index, operator: operator.name, action: entry.action, start };
        this.timeline.push(record);
        const problem = this.invalidReason(entry, operator, start);
        if (problem) { record.invalid = problem; record.end = start; record.controlled = this.controlled.name; record.afterOrder = this.orderCounter; this.warn(`Entry ${index} (${operator.name} ${entry.action}) skipped: ${problem}`); return; }
        previousStart = start;
        this.currentEntryIndex = index;
        this.perform(entry, operator, start, index);
        this.currentEntryIndex = undefined;
        record.end = Math.max(start, operator.lockEnd); record.controlled = this.controlled.name; record.afterOrder = this.orderCounter;
      });
      this.horizon = Math.max(0, ...this.operators.map((operator) => operator.lockEnd));
      this.runUntil(this.horizon);
      this.team.syncSP(this.horizon);
      return this.summary();
    }

    // Structural rules (not resource shortfalls): invalid entries are skipped and reported.
    invalidReason(entry, operator, start) {
      const kit = operator.definition.kit || {}, controlled = this.controlled === operator;
      const finisherBlocked = Boolean((operator.currentForm(start) || {}).disablesFinisher);
      switch (entry.action) {
        case 'Finisher':
          if (!controlled) return 'only the controlled operator can perform a Finisher';
          if (finisherBlocked) return 'Finisher is disabled in this form';
          return this.enemy.finisherPending(start) ? null : 'no Finisher available';
        case 'DiveAttack': return controlled ? null : 'only the controlled operator can perform a Dive Attack';
        case 'BasicAttack': return controlled && !finisherBlocked && this.enemy.finisherPending(start) ? 'a Finisher is pending (use Finisher)' : null;
        case 'BattleSkill': return kit.battleSkill ? null : 'operator has no battle skill';
        case 'ComboSkill': return kit.comboSkill ? null : 'operator has no combo skill';
        case 'Ultimate': return kit.ultimate ? null : 'operator has no ultimate';
        default: return null;
      }
    }

    perform(entry, operator, start, index) {
      const ability = new AbilityContext(this, operator), kit = operator.definition.kit || {};
      ability.category = entry.category || entry.action; ability.entryIndex = index; ability.record = this.timeline[this.timeline.length - 1];
      const castSkill = (category, run) => { // default 1s lock; the skill script may override with lockFor()
        ability.category = category;
        ability.lockFor(DEFAULT_ACTION_DURATION);
        this.emit('SkillCast', { source: ability, category });
        this.runAbility(run(ability), ability);
      };
      if (entry.action === 'Switch') {
        ability.setLabel(this.controlled === operator ? 'Switch (already controlled)' : 'Switch → ' + operator.name);
        if (this.controlled !== operator) { this.controlled.switchedAwayAt = start; this.controlled.basicAttackIndex = 0; operator.basicAttackIndex = 0; this.controlled = operator; }
      } else if (entry.action === 'BattleSkill') {
        castSkill('BattleSkill', kit.battleSkill.run);
      } else if (entry.action === 'ComboSkill') {
        if (operator.comboWindowUntil <= start) this.warn(`${operator.name}: combo skill cast without an open trigger window`);
        operator.comboWindowUntil = -Infinity;
        castSkill('ComboSkill', kit.comboSkill.run);
      } else if (entry.action === 'Ultimate') {
        castSkill('Ultimate', kit.ultimate.run);
      } else if (entry.action === 'Finisher' || entry.action === 'DiveAttack') {
        const isFinisher = entry.action === 'Finisher', spec = (isFinisher ? kit.finisher : kit.dive) || {};
        const duration = spec.duration || (isFinisher ? 2 : 1);
        ability.lockFor(duration); operator.basicAttackIndex = 0; ability.setLabel(isFinisher ? 'Finisher' : 'Dive Attack');
        if (isFinisher) this.enemy.finisherUsed = true;
        this.runAbility((function* () {
          ability.hit({ element: kit.basicAttackElement, category: 'BasicAttack', subtype: isFinisher ? 'Finisher' : 'Dive', multiplier: spec.multiplier || (isFinisher ? 9 : 1.8) });
          if (isFinisher) ability.restoreSkillPoints(ability.enemy.data.finisherSP || 0);
          ability.simulation.emit(isFinisher ? 'Finisher' : 'DiveAttack', { source: ability });
        })(), ability);
      } else if (entry.action === 'BasicAttack') {
        const { key, sequence } = operator.activeSequence(start);
        if (operator.sequenceKey !== key) { operator.sequenceKey = key; operator.basicAttackIndex = 0; }
        if (start - operator.lastAttackEnd > BASIC_ATTACK_RESET_GAP || operator.basicAttackIndex >= sequence.length) operator.basicAttackIndex = 0;
        const attack = sequence[operator.basicAttackIndex];
        ability.setLabel((key === 'base' ? '' : ((kit.forms[key] || {}).label || key) + ' ') + `BATK ${operator.basicAttackIndex + 1}` + (attack.finalStrike ? ' (Final Strike)' : ''));
        const isControlled = this.controlled === operator; // non-controlled Final Strikes deal damage only
        operator.basicAttackIndex = attack.finalStrike ? 0 : operator.basicAttackIndex + 1;
        operator.lastAttackEnd = start + attack.duration;
        ability.lockFor(attack.duration);
        this.runAbility((function* () {
          ability.hit({ element: kit.basicAttackElement, category: 'BasicAttack', subtype: attack.finalStrike ? 'FinalStrike' : undefined, multiplier: attack.multiplier });
          if (attack.finalStrike && isControlled) {
            const finalStrike = { source: ability, staggerBonus: 0 }; // triggers may add stagger bonus
            ability.simulation.emit('FinalStrike', finalStrike);
            ability.restoreSkillPoints(attack.skillPointsRestored);
            ability.dealStagger(attack.stagger * (1 + finalStrike.staggerBonus));
          }
        })(), ability);
      } else if (entry.action === 'Custom') { // scenario/test scripts: { script: function* (ability) {...}, lock?: seconds, category? }
        ability.lockFor(entry.lock || 0);
        if (['BattleSkill', 'ComboSkill', 'Ultimate'].includes(ability.category)) this.emit('SkillCast', { source: ability, category: ability.category });
        this.runAbility(entry.script(ability), ability);
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

  E.Simulation = Simulation; E.OperatorState = OperatorState; E.AbilityContext = AbilityContext;
})();
