// Enemy status system: Arts Inflictions/Reactions/Burst, Vulnerable, Physical Statuses, Shatter.
// Every apply* method takes the `source` AbilityContext (the operator whose action caused it).
(function () {
  const E = globalThis.Endfield;
  const REACTION_OF = { Heat: 'Combustion', Electric: 'Electrification', Cryo: 'Solidification', Nature: 'Corrosion' };
  const INFLICTION_DURATION = 20, VULNERABLE_DURATION = 20, MAX_STACKS = 4;

  class StatusEngine {
    constructor(simulation) {
      this.sim = simulation; this.infliction = null; this.reactions = {};
      this.vulnerable = { stacks: 0, expires: -Infinity, records: [] }; this.breach = null;
      this.liftedUntil = -Infinity; this.knockedDownUntil = -Infinity;
      this.effects = {}; // enemy debuffs from weapons/sets/abilities: name -> { modifiers, expires }
      this.dynamicEffects = {}; // name -> { expires, compute(time) -> modifiers }
    }
    setEffect(name, modifiers, duration, now) { this.effects[name] = { modifiers, expires: now + duration }; if (!name.startsWith('Susceptibility:')) this.sim.logEffect('Enemy', name, { end: now + duration }); }
    setDynamicEffect(name, duration, compute) { if (!name.startsWith('Susceptibility:')) this.sim.logEffect('Enemy', name, { end: this.sim.now + duration }); this.dynamicEffects[name] = { expires: this.sim.now + duration, compute }; }
    tags(time) { // enemy-state tags usable by damage bonuses
      const tags = [];
      if (this.vulnerableStacks(time) > 0) tags.push('Vulnerable');
      const infliction = this.activeInfliction(time);
      if ((infliction && infliction.element === 'Cryo') || this.reaction('Solidification', time)) tags.push('CryoInflictionOrSolidification');
      return tags;
    }
    // ---- queries (time defaults to now) ----
    activeInfliction(time = this.sim.now) { return this.infliction && this.infliction.expires > time ? this.infliction : null; }
    reaction(name, time = this.sim.now) { const r = this.reactions[name]; return r && r.expires > time ? r : null; }
    reactionLevel(name, time = this.sim.now) { const r = this.reaction(name, time); return r ? r.level : 0; }
    vulnerableStacks(time = this.sim.now) { return this.vulnerable.expires > time ? this.vulnerable.stacks : 0; }
    isLifted(time = this.sim.now) { return time < this.liftedUntil; }
    isKnockedDown(time = this.sim.now) { return time < this.knockedDownUntil; }

    // ---- values read by the damage engine (frozen at application, as agreed) ----
    modifiers(time) {
      const list = [];
      for (const effect of Object.values(this.effects)) if (effect.expires > time) list.push(...effect.modifiers);
      for (const effect of Object.values(this.dynamicEffects)) if (effect.expires > time) list.push(...effect.compute(time));
      const electrification = this.reaction('Electrification', time);
      if (electrification) list.push({ stat: 'DamageTaken', value: (0.08 + 0.04 * electrification.level) * electrification.artsIntensityMultiplier * electrification.debuffScale, tags: ['Arts'] });
      if (this.breach && this.breach.expires > time) list.push({ stat: 'DamageTaken', value: this.breach.value, tags: ['Physical'] });
      return list;
    }
    resistanceShred(time) {
      const c = this.reaction('Corrosion', time);
      if (!c) return 0;
      const m = c.artsIntensityMultiplier, L = c.level;
      return Math.min((8 + 4 * L) * m * c.shredScale, (2.4 + 1.2 * L) * m + (0.56 + 0.28 * L) * m * (time - c.appliedAt));
    }

    // ---- Arts ----
    applyInfliction(source, element) { // one stack per call; N stacks = N calls
      const now = this.sim.now, current = this.activeInfliction();
      if (!current) { this.infliction = { element, stacks: 1, expires: now + INFLICTION_DURATION, records: [this.sim.logEffect('Enemy', element + ' Infliction', { end: now + INFLICTION_DURATION, stack: true })] }; this.sim.emit('InflictionApplied', { source, element }); return; }
      if (current.element === element) {
        if (current.stacks < MAX_STACKS) {
          current.stacks++; current.expires = now + INFLICTION_DURATION;
          current.records.push(this.sim.logEffect('Enemy', element + ' Infliction', { end: current.expires, stack: true }));
          for (const record of current.records) record.end = current.expires; // shared, refreshed duration
          this.sim.emit('InflictionApplied', { source, element });
          this.applyArtsBurst(source, element);
        }
        return;
      }
      for (const record of current.records) this.sim.endEffect(record);
      this.infliction = null; // mutually exclusive: converts into a reaction of the NEW element
      this.sim.emit('InflictionConsumed', { source, element: current.element, stacks: current.stacks });
      this.applyReaction(source, element, current.stacks, { natural: true });
    }
    applyArtsBurst(source, element) {
      this.sim.logInstant('Enemy', element + ' Burst');
      this.sim.emit('ArtsBurst', { source, element }); // weapon/set triggers apply before the Burst's own damage (measured)
      source.hit({ element, category: 'Status', subtype: 'ArtsBurst', statusKind: 'ArtsStatus', multiplier: 1.6 });
    }
    // options: { duration, debuffScale (Electrification), shredScale (Corrosion max) }; default from definition.reactionOptions(source, element)
    applyReaction(source, element, level, options) { // always overwrites, resets everything, redeals the initial hit
      options = { ...((source.operator.definition.reactionOptions && source.operator.definition.reactionOptions(source, element)) || {}), ...(options || {}) }; // options.natural = came from an infliction conversion
      const now = this.sim.now, name = REACTION_OF[element];
      level = Math.min(MAX_STACKS, level);
      if (this.reactions[name]) { this.reactions[name].cancelled = true; this.sim.endEffect(this.reactions[name].record); }
      const snapshot = source.snapshotAttacker();
      const duration = options.duration || { Combustion: 10, Electrification: 6 + 6 * level, Solidification: 4.75 + level, Corrosion: 15 }[name];
      const reaction = { name, element, level, appliedAt: now, expires: now + duration, cancelled: false, debuffScale: options.debuffScale || 1, shredScale: options.shredScale || 1, artsIntensityMultiplier: E.artsIntensityMultiplier(snapshot.artsIntensity) };
      this.reactions[name] = reaction;
      reaction.record = this.sim.logEffect('Enemy', `${name} L${level}`, { end: now + duration });
      this.sim.emit('ReactionApplied', { source, name, level }); // triggers resolve before any damage (measured)
      if (options.natural) source.hit({ element, category: 'Status', subtype: 'ArtsReaction', statusKind: 'ArtsStatus', multiplier: 0.8 + 0.8 * level }); // forced reactions deal no initial hit
      if (name === 'Combustion') { // hits at t=0 and every second through the duration (11 hits for 10s)
        for (let second = 0; second <= duration; second++) {
          const tick = () => { if (!reaction.cancelled) this.sim.dealDamage(source.operator, snapshot, { element: 'Heat', category: 'Status', subtype: 'DoT', statusKind: 'ArtsStatus', multiplier: 0.12 + 0.12 * level }, source); };
          if (second === 0) tick(); else this.sim.schedule(now + second, tick);
        }
      }
    }
    consumeReaction(name, source) {
      const r = this.reaction(name);
      if (!r) return 0;
      r.cancelled = true; r.expires = -Infinity; this.sim.endEffect(r.record);
      this.sim.emit('ReactionConsumed', { source, name, level: r.level, element: r.element });
      return r.level;
    }
    consumeInfliction(element, source) { // element optional: any
      const current = this.activeInfliction();
      if (!current || (element && current.element !== element)) return 0;
      for (const record of current.records) this.sim.endEffect(record);
      this.infliction = null;
      this.sim.emit('InflictionConsumed', { source, element: current.element, stacks: current.stacks });
      return current.stacks;
    }

    // ---- Imprisonment / Lift extension / susceptibility lookup ----
    isImprisoned(time = this.sim.now) { return Boolean(this.imprisonment && this.imprisonment.until > time); }
    applyImprisonment(source, duration, onNaturalEnd) {
      const now = this.sim.now, token = { until: now + duration, cancelled: false };
      if (this.imprisonment) this.imprisonment.cancelled = true;
      token.record = this.sim.logEffect('Enemy', 'Imprisonment', { end: now + duration });
      this.imprisonment = token;
      this.sim.schedule(now + duration - 1e-6, () => { if (!token.cancelled && onNaturalEnd) onNaturalEnd(); }); // tie-break: the Explosion lands just before same-duration effects (e.g. Susceptibility) expire (measured)
      this.sim.emit('ImprisonmentApplied', { source });
    }
    endImprisonment() { if (this.imprisonment) { this.sim.endEffect(this.imprisonment.record); this.imprisonment.cancelled = true; this.imprisonment.until = -Infinity; } }
    extendLift(until) { if (this.isLifted()) this.liftedUntil = Math.max(this.liftedUntil, until); }
    hasSusceptibility(element, time = this.sim.now) { const effect = this.effects['Susceptibility:' + element]; return Boolean(effect && effect.expires > time); }

    // ---- Vulnerable and Physical Statuses ----
    addVulnerableStacks(count, source) {
      const stacksBefore = this.vulnerableStacks(), expires = this.sim.now + VULNERABLE_DURATION;
      const records = stacksBefore > 0 ? [...this.vulnerable.records] : [];
      for (let i = 0; i < count && records.length < MAX_STACKS; i++) records.push(this.sim.logEffect('Enemy', 'Vulnerable', { end: expires, stack: true }));
      for (const record of records) record.end = expires; // shared, refreshed duration
      this.vulnerable = { stacks: Math.min(MAX_STACKS, stacksBefore + count), expires, records };
      this.sim.emit('VulnerableApplied', { source, count, stacksBefore });
    }
    applyVulnerable(source, count = 1) { this.addVulnerableStacks(count, source); this.shatter(source); }
    shatter(source) { // any Vulnerable/Physical Status application pops Solidification
      const solidification = this.reaction('Solidification');
      if (!solidification) return;
      solidification.cancelled = true; solidification.expires = -Infinity; this.sim.endEffect(solidification.record); this.sim.logInstant('Enemy', 'Shatter');
      source.hit({ element: 'Physical', category: 'Status', subtype: 'Shatter', statusKind: 'ArtsStatus', multiplier: 1.2 + 1.2 * solidification.level });
      this.sim.emit('Shatter', { source, level: solidification.level });
    }
    // kind: 'Lift' | 'KnockDown' | 'Crush' | 'Breach'; options: { forced, liftDuration, crushBonus }
    applyPhysicalStatus(source, kind, { forced = false, liftDuration = 1, crushBonus = 0 } = {}) {
      const now = this.sim.now, stacks = this.vulnerableStacks();
      let effective = false; // did the status do its real effect (not just add Vulnerable)?
      const physicalHit = (multiplier) => source.hit({ element: 'Physical', category: 'Status', subtype: 'PhysicalStatus', statusKind: 'PhysicalStatus', multiplier });
      if (kind === 'Lift' || kind === 'KnockDown') {
        if (stacks > 0 || forced) {
          effective = true;
          physicalHit(1.2);
          source.dealStagger((10 * (200 + source.snapshotAttacker().artsIntensity)) / 200);
          if (kind === 'Lift' && this.sim.enemy.data.canBeLifted !== false) { this.liftedUntil = now + liftDuration; this.sim.logEffect('Enemy', 'Lifted', { end: this.liftedUntil }); }
          if (kind === 'KnockDown') { this.knockedDownUntil = now + 1; this.sim.logEffect('Enemy', 'Knocked Down', { end: this.knockedDownUntil }); }
        }
        this.addVulnerableStacks(1, source);
      } else if (stacks === 0 && !forced) {
        this.addVulnerableStacks(1, source);
      } else {
        effective = true;
        for (const record of this.vulnerable.records || []) this.sim.endEffect(record);
        this.vulnerable.expires = -Infinity; // consume all
        this.sim.emit('VulnerableConsumed', { source, stacks });
        if (kind === 'Crush') this.sim.logInstant('Enemy', 'Crush');
        if (kind === 'Crush') physicalHit((1.5 + 1.5 * stacks) * (1 + crushBonus));
        if (kind === 'Breach') {
          physicalHit(0.5 + 0.5 * stacks);
          const aim = E.artsIntensityMultiplier(source.snapshotAttacker().artsIntensity);
          this.breach = { expires: now + 6 + 6 * stacks, value: (0.08 + 0.04 * stacks) * aim };
          this.sim.logEffect('Enemy', 'Breach', { end: this.breach.expires });
        }
      }
      if (effective) this.sim.emit('PhysicalStatusApplied', { source, kind, stacksConsumed: stacks });
      this.shatter(source);
      return { effective, stacksConsumed: stacks };
    }
  }
  E.StatusEngine = StatusEngine;
})();
