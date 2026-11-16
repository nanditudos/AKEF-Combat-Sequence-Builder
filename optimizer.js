// Equipment optimizer (no DOM). Evolutionary search over Armor, Gloves, Kit 1, Kit 2 and Consumable of EVERY operator at once, maximizing team damage
// of the current sequence. Weapons, tacticals, potentials and the sequence are never touched; locked parts keep the user's choice.
//   Set lock  : the operator's current set bonus stays fixed (>= 3 pieces of that set, or no set bonus at all if it has none). Unlocked = free.
//   Rule      : optional INT >= WIL / WIL > INT constraint per operator (permanent stats only), e.g. to force Arcane's INT or WILL mode.
//   Warnings  : "allowWarnings: false" ranks warning-free builds above any build that produces warnings.
// Pipeline: deduplicated per-operator catalogs -> population (current build + random builds) -> tournament selection, uniform crossover, mutation,
// elitism, immigrants (all repaired to satisfy the set lock) -> coordinate-descent polish (every single-part swap) -> top distinct builds.
(function () {
  const E = globalThis.Endfield, D = E.data, B = E.builder;
  const GENES = ['armor', 'gloves', 'kit1', 'kit2', 'consumable'];
  const GEAR_SLOTS = ['armor', 'gloves', 'kit1', 'kit2'];
  const GEAR_TYPE = { armor: 'armor', gloves: 'gloves', kit1: 'kits', kit2: 'kits' };
  const ATTRIBUTES = ['STR', 'AGL', 'INT', 'WIL'];
  // Stats that cannot change the simulated damage or warnings (survivability, healing, ignored cooldowns): used only to merge identical pieces.
  const IRRELEVANT = new Set(['HP', 'HPBonus', 'DEF', 'DEFBonus', 'TreatmentBonus', 'TreatmentReceivedBonus', 'ShieldAppliedBonus', 'FinalDamageReduction', 'ComboSkillCooldownReduction', 'Resistance']);
  const RULES = { 'INT>=WIL': (sheet) => sheet.attribute('INT', true) >= sheet.attribute('WIL', true), 'WIL>INT': (sheet) => sheet.attribute('WIL', true) > sheet.attribute('INT', true) };

  const mulberry32 = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
  const pick = (list, rnd) => list[Math.floor(rnd() * list.length)];
  const pieceSet = (name) => (name ? (D.gear.byName(name) || {}).set || '' : '');

  // ---------- catalogs ----------
  function signature(modifiers, operator) {
    const kept = modifiers.filter((m) => {
      if (IRRELEVANT.has(m.stat)) return false;
      const attribute = ATTRIBUTES.find((a) => m.stat === a || m.stat === a + 'Bonus');
      return attribute ? attribute === operator.mainAttribute || attribute === operator.secondaryAttribute : true; // other attributes cannot matter
    });
    return JSON.stringify(kept.map((m) => [m.stat, Math.round(m.value * 1e6) / 1e6, (m.tags || []).slice().sort().join('+')]).sort());
  }
  function buildCatalog(operator) {
    const catalog = { armor: [], gloves: [], kits: [], consumable: [''], bySet: { armor: {}, gloves: {}, kits: {} } };
    for (const type of ['armor', 'gloves', 'kits']) {
      const seen = new Set();
      for (const piece of D.gear[type]) {
        const key = piece.set + '|' + signature(piece.modifiers, operator);
        if (seen.has(key)) continue;
        seen.add(key); catalog[type].push(piece.name);
        (catalog.bySet[type][piece.set] = catalog.bySet[type][piece.set] || []).push(piece.name);
      }
    }
    const seenConsumables = new Set(['[]']); // a consumable with no relevant stat equals "none"
    for (const [key, consumable] of Object.entries(D.consumables || {})) {
      const sig = signature(consumable.modifiers, operator);
      if (!seenConsumables.has(sig)) { seenConsumables.add(sig); catalog.consumable.push(key); }
    }
    return catalog;
  }

  // ---------- problem ----------
  function createProblem(state, config = {}) {
    const base = JSON.parse(JSON.stringify(state));
    const ops = [];
    base.team.forEach((slot, index) => {
      const operator = D.operators[slot.op];
      if (!operator) return;
      const locks = slot.locks || {};
      ops.push({ index, operator, catalog: buildCatalog(operator),
        free: { armor: !locks.armor, gloves: !locks.gloves, kit1: !locks.kit1, kit2: !locks.kit2, consumable: !locks.consumable },
        requiredSet: locks.set ? B.slotStats(slot).activeSets[0] || '' : null, // null = free, '' = no set bonus, name = that set
        rule: slot.rule || '' });
    });
    return { base, ops, allowWarnings: config.allowWarnings !== false, cache: new Map(), evaluations: 0 };
  }
  const baseGenome = (problem) => Object.fromEntries(problem.ops.map((op) => { const s = problem.base.team[op.index]; return [op.index, { ...s.gear, consumable: s.consumable || '' }]; }));
  const cloneGenome = (genome) => Object.fromEntries(Object.entries(genome).map(([index, genes]) => [index, { ...genes }]));
  const genomeKey = (problem, genome) => problem.ops.map((op) => { const g = genome[op.index]; return [g.armor, g.gloves, [g.kit1, g.kit2].sort().join('+'), g.consumable].join('|'); }).join('||');
  function genomeToState(problem, genome) {
    const state = JSON.parse(JSON.stringify(problem.base));
    for (const op of problem.ops) { const g = genome[op.index]; Object.assign(state.team[op.index].gear, { armor: g.armor, gloves: g.gloves, kit1: g.kit1, kit2: g.kit2 }); state.team[op.index].consumable = g.consumable; }
    return state;
  }
  function applyBuild(state, genome) { // writes a build into the UI state (only genes the optimizer may change differ from the user's)
    for (const [index, g] of Object.entries(genome)) { Object.assign(state.team[index].gear, { armor: g.armor, gloves: g.gloves, kit1: g.kit1, kit2: g.kit2 }); state.team[index].consumable = g.consumable; }
  }

  // ---------- set constraint repair ----------
  function repairOperator(op, genes, rnd) {
    if (op.requiredSet === null) return true;
    const counts = () => { const c = {}; for (const k of GEAR_SLOTS) { const s = pieceSet(genes[k]); if (s) c[s] = (c[s] || 0) + 1; } return c; };
    if (op.requiredSet) {
      let count = GEAR_SLOTS.filter((k) => pieceSet(genes[k]) === op.requiredSet).length;
      const swappable = GEAR_SLOTS.filter((k) => op.free[k] && pieceSet(genes[k]) !== op.requiredSet && (op.catalog.bySet[GEAR_TYPE[k]][op.requiredSet] || []).length);
      while (count < 3 && swappable.length) { const k = swappable.splice(Math.floor(rnd() * swappable.length), 1)[0]; genes[k] = pick(op.catalog.bySet[GEAR_TYPE[k]][op.requiredSet], rnd); count++; }
      return count >= 3;
    }
    for (let guard = 0; guard < 8; guard++) { // "no set bonus": no set may reach 3 pieces
      const c = counts(), over = Object.keys(c).find((s) => c[s] >= 3);
      if (!over) return true;
      const slots = GEAR_SLOTS.filter((k) => op.free[k] && pieceSet(genes[k]) === over);
      if (!slots.length) return false;
      const k = pick(slots, rnd), options = op.catalog[GEAR_TYPE[k]].filter((n) => { const s = pieceSet(n); return s !== over && (!s || (c[s] || 0) < 2); });
      if (!options.length) return false;
      genes[k] = pick(options, rnd);
    }
    return false;
  }
  const repair = (problem, genome, rnd) => problem.ops.every((op) => repairOperator(op, genome[op.index], rnd));
  function setViolations(op, genes) {
    if (op.requiredSet === null) return 0;
    const counts = {};
    for (const k of GEAR_SLOTS) { const s = pieceSet(genes[k]); if (s) counts[s] = (counts[s] || 0) + 1; }
    return op.requiredSet ? ((counts[op.requiredSet] || 0) >= 3 ? 0 : 1) : (Object.values(counts).some((c) => c >= 3) ? 1 : 0);
  }

  // ---------- evaluation and ranking ----------
  function evaluate(problem, genome) {
    const key = genomeKey(problem, genome), cached = problem.cache.get(key);
    if (cached) return cached;
    const state = genomeToState(problem, genome);
    let violations = 0;
    for (const op of problem.ops) {
      violations += setViolations(op, genome[op.index]);
      if (op.rule) violations += RULES[op.rule](B.slotStats(state.team[op.index]).sheet) ? 0 : 1;
    }
    let result;
    if (violations) result = { valid: false, violations, damage: 0, warnings: 0 };
    else { problem.evaluations++; result = { valid: true, violations: 0, ...B.quickRun(state) }; }
    result = { ...result, genome: cloneGenome(genome), key };
    problem.cache.set(key, result);
    return result;
  }
  const rank = (problem, r) => (!r.valid ? 0 : problem.allowWarnings || r.warnings === 0 ? 2 : 1);
  // > 0 when a is better than b: valid + warning-free (or warnings allowed) first, then valid-with-warnings (fewer first), then invalid; ties by damage
  function compare(problem, a, b) {
    const ra = rank(problem, a), rb = rank(problem, b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return b.violations - a.violations;
    if (ra === 1 && a.warnings !== b.warnings) return b.warnings - a.warnings;
    return a.damage - b.damage;
  }

  // ---------- search ----------
  function randomGenome(problem, rnd) {
    for (let attempt = 0; attempt < 50; attempt++) {
      const genome = cloneGenome(baseGenome(problem));
      for (const op of problem.ops) for (const gene of GENES) if (op.free[gene]) genome[op.index][gene] = pick(gene === 'consumable' ? op.catalog.consumable : op.catalog[GEAR_TYPE[gene]], rnd);
      if (repair(problem, genome, rnd)) return genome;
    }
    return null;
  }
  const tournament = (problem, scored, rnd, size = 3) => { let best = pick(scored, rnd); for (let i = 1; i < size; i++) { const c = pick(scored, rnd); if (compare(problem, c, best) > 0) best = c; } return best; };
  function breed(problem, a, b, rnd, mutation) {
    const child = cloneGenome(a.genome);
    for (const op of problem.ops) for (const gene of GENES) {
      if (!op.free[gene]) continue;
      if (rnd() < 0.5) child[op.index][gene] = b.genome[op.index][gene];
      if (rnd() < mutation) child[op.index][gene] = pick(gene === 'consumable' ? op.catalog.consumable : op.catalog[GEAR_TYPE[gene]], rnd);
    }
    return repair(problem, child, rnd) ? child : null;
  }

  async function run(problem, config = {}, hooks = {}) {
    const started = Date.now(), rnd = mulberry32(config.seed === undefined ? 1 : config.seed);
    const populationSize = Math.max(6, config.population || 60), generations = config.generations === undefined ? 80 : config.generations;
    let lastYield = Date.now(), stopped = false;
    const progress = (phase, generation, best) => hooks.onProgress && hooks.onProgress({ phase, generation, generations, best: best.damage, evaluations: problem.evaluations, seconds: (Date.now() - started) / 1000 });
    const slice = async (phase, generation, best) => {
      if (Date.now() - lastYield < 40) return;
      progress(phase, generation, best); await new Promise((resolve) => setTimeout(resolve, 0)); lastYield = Date.now();
      if (hooks.shouldStop && hooks.shouldStop()) stopped = true;
    };

    const baseline = evaluate(problem, baseGenome(problem));
    if (!problem.ops.some((op) => GENES.some((gene) => op.free[gene]))) return finish(problem, baseline, started, false);
    let scored = [baseline];
    while (scored.length < populationSize) {
      const genome = randomGenome(problem, rnd);
      if (!genome) throw new Error('The set lock cannot be satisfied with the current locks and catalog.');
      scored.push(evaluate(problem, genome));
    }
    for (let generation = 1; generation <= generations && !stopped; generation++) {
      scored.sort((x, y) => compare(problem, y, x));
      const elites = scored.slice(0, 2), next = [...elites], immigrants = Math.max(1, Math.round(populationSize * 0.1));
      while (next.length < populationSize - immigrants) {
        const child = breed(problem, tournament(problem, scored, rnd), tournament(problem, scored, rnd), rnd, 0.12);
        if (child) next.push(evaluate(problem, child));
      }
      while (next.length < populationSize) { const genome = randomGenome(problem, rnd); if (genome) next.push(evaluate(problem, genome)); else break; }
      scored = next;
      await slice('evolving', generation, scored.reduce((best, r) => (compare(problem, r, best) > 0 ? r : best)));
    }
    scored.sort((x, y) => compare(problem, y, x));
    let best = scored[0];
    for (let pass = 0, improved = true; improved && pass < 4 && !stopped; pass++) { // polish: try every single-part swap of every operator
      improved = false;
      for (const op of problem.ops) for (const gene of GENES) {
        if (!op.free[gene] || stopped) continue;
        for (const name of gene === 'consumable' ? op.catalog.consumable : op.catalog[GEAR_TYPE[gene]]) {
          if (best.genome[op.index][gene] === name) continue;
          const candidate = cloneGenome(best.genome); candidate[op.index][gene] = name;
          const result = evaluate(problem, candidate);
          if (compare(problem, result, best) > 0) { best = result; improved = true; }
        }
        await slice('polishing', pass + 1, best);
      }
    }
    progress('done', generations, best);
    return finish(problem, baseline, started, stopped);
  }

  function finish(problem, baseline, started, stopped, count = 8) {
    const all = [...problem.cache.values()].filter((r) => r.valid).sort((x, y) => compare(problem, y, x));
    const builds = all.slice(0, count).map((r) => ({ ...r, gain: baseline.damage > 0 ? r.damage / baseline.damage - 1 : 0 }));
    return { baseline, builds, best: builds[0] || baseline, evaluations: problem.evaluations, seconds: (Date.now() - started) / 1000, stopped, feasible: builds.length > 0 && rank(problem, builds[0]) === 2 };
  }

  E.optimizer = { createProblem, run, evaluate, compare, applyBuild, buildCatalog, baseGenome, RULES };
})();
