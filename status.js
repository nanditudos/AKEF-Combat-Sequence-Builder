// Enemy status system: Arts Inflictions/Reactions/Burst, Vulnerable, Physical Statuses, Shatter.
// Every apply* method takes the `source` AbilityContext (the operator whose action caused it).
(function () {
  const E = globalThis.Endfield;
  const REACTION_OF = { Heat: 'Combustion', Electric: 'Electrification', Cryo: 'Solidification', Nature: 'Corrosion' };
  const INFLICTION_DURATION = 20, VULNERABLE_DURATION = 20, MAX_STACKS = 4;

  class StatusEngine {
    constructor(simulation) {
      this.sim = simulation; this.infliction = null; this.reactions = {};
      this.vulnerable = { stacks: 0, expires: -Infinity }; this.breach = null;
      this.liftedUntil = -Infinity; this.knockedDownUntil = -Infinity;
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
      const electrification = this.reaction('Electrification', time);
      if (electrification) list.push({ stat: 'DamageTaken', value: (0.08 + 0.04 * electrification.level) * electrification.artsIntensityMultiplier, tags: ['Arts'] });
      if (this.breach && this.breach.expires > time) list.push({ stat: 'DamageTaken', value: this.breach.value, tags: ['Physical'] });
      return list;
    }
    resistanceShred(time) {
      const c = this.reaction('Corrosion', time);
      if (!c) return 0;
      const m = c.artsIntensityMultiplier, L = c.level;
      return Math.min((8 + 4 * L) * m, (2.4 + 1.2 * L) * m + (0.56 + 0.28 * L) * m * (time - c.appliedAt));
    }

    // ---- Arts ----
    applyInfliction(source, element) { // one stack per call; N stacks = N calls
      const now = this.sim.now, current = this.activeInfliction();
      if (!current) { this.infliction = { element, stacks: 1, expires: now + INFLICTION_DURATION }; this.sim.emit('InflictionApplied', { source, element }); return; }
      if (current.element === element) {
        if (current.stacks < MAX_STACKS) {
          current.stacks++; current.expires = now + INFLICTION_DURATION;
          this.sim.emit('InflictionApplied', { source, element });
          this.applyArtsBurst(source, element);
        }
        return;
      }
      this.infliction = null; // mutually exclusive: converts into a reaction of the NEW element
      this.sim.emit('InflictionConsumed', { source, element: current.element, stacks: current.stacks });
      this.applyReaction(source, element, current.stacks);
    }
    applyArtsBurst(source, element) {
      source.hit({ element, category: 'Status', subtype: 'ArtsBurst', statusKind: 'ArtsStatus', multiplier: 1.6 });
      this.sim.emit('ArtsBurst', { source, element });
    }
    applyReaction(source, element, level) { // always overwrites, resets everything, redeals the initial hit
      const now = this.sim.now, name = REACTION_OF[element];
      level = Math.min(MAX_STACKS, level);
      if (this.reactions[name]) this.reactions[name].cancelled = true;
      const snapshot = source.snapshotAttacker();
      const duration = { Combustion: 10, Electrification: 6 + 6 * level, Solidification: 4.75 + level, Corrosion: 15 }[name];
      const reaction = { name, element, level, appliedAt: now, expires: now + duration, cancelled: false, artsIntensityMultiplier: E.artsIntensityMultiplier(snapshot.artsIntensity) };
      this.reactions[name] = reaction;
      source.hit({ element, category: 'Status', subtype: 'ArtsReaction', statusKind: 'ArtsStatus', multiplier: 0.8 + 0.8 * level });
      if (name === 'Combustion') { // hits at t=0 and every second through the duration (11 hits for 10s)
        for (let second = 0; second <= duration; second++) {
          const tick = () => { if (!reaction.cancelled) this.sim.dealDamage(source.operator, snapshot, { element: 'Heat', category: 'Status', subtype: 'DoT', statusKind: 'ArtsStatus', multiplier: 0.12 + 0.12 * level }, source); };
          if (second === 0) tick(); else this.sim.schedule(now + second, tick);
        }
      }
      this.sim.emit('ReactionApplied', { source, name, level });
    }
    consumeReaction(name, source) {
      const r = this.reaction(name);
      if (!r) return 0;
      r.cancelled = true; r.expires = -Infinity;
      this.sim.emit('ReactionConsumed', { source, name, level: r.level });
      return r.level;
    }
    consumeInfliction(element, source) { // element optional: any
      const current = this.activeInfliction();
      if (!current || (element && current.element !== element)) return 0;
      this.infliction = null;
      this.sim.emit('InflictionConsumed', { source, element: current.element, stacks: current.stacks });
      return current.stacks;
    }

    // ---- Vulnerable and Physical Statuses ----
    addVulnerableStacks(count, source) {
      const stacksBefore = this.vulnerableStacks();
      this.vulnerable = { stacks: Math.min(MAX_STACKS, stacksBefore + count), expires: this.sim.now + VULNERABLE_DURATION };
      this.sim.emit('VulnerableApplied', { source, count, stacksBefore });
    }
    applyVulnerable(source, count = 1) { this.addVulnerableStacks(count, source); this.shatter(source); }
    shatter(source) { // any Vulnerable/Physical Status application pops Solidification
      const solidification = this.reaction('Solidification');
      if (!solidification) return;
      solidification.cancelled = true; solidification.expires = -Infinity;
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
          if (kind === 'Lift' && this.sim.enemy.data.canBeLifted !== false) this.liftedUntil = now + liftDuration;
          if (kind === 'KnockDown') this.knockedDownUntil = now + 1;
        }
        this.addVulnerableStacks(1, source);
      } else if (stacks === 0 && !forced) {
        this.addVulnerableStacks(1, source);
      } else {
        effective = true;
        this.vulnerable.expires = -Infinity; // consume all
        this.sim.emit('VulnerableConsumed', { source, stacks });
        if (kind === 'Crush') physicalHit((1.5 + 1.5 * stacks) * (1 + crushBonus));
        if (kind === 'Breach') {
          physicalHit(0.5 + 0.5 * stacks);
          const aim = E.artsIntensityMultiplier(source.snapshotAttacker().artsIntensity);
          this.breach = { expires: now + 6 + 6 * stacks, value: (0.08 + 0.04 * stacks) * aim };
        }
      }
      if (effective) this.sim.emit('PhysicalStatusApplied', { source, kind });
      this.shatter(source);
    }
  }
  E.StatusEngine = StatusEngine;
})();
