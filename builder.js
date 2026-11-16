// Sequence-builder logic (no DOM): UI state -> simulation -> view model. Used by ui.js and unit tests.
(function () {
  const E = globalThis.Endfield, D = E.data;
  const SLOT_KEYS = ['armor', 'gloves', 'kit1', 'kit2'];
  const ACTIONS = [['BasicAttack', 'BATK'], ['BattleSkill', 'Battle'], ['ComboSkill', 'Combo'], ['Ultimate', 'Ult'], ['Finisher', 'Finish'], ['DiveAttack', 'Dive'], ['Switch', 'Switch'], ['PerfectDodge', 'Dodge'], ['TakeDamage', 'Hit']]
  const ENEMY_ACTIONS = [['EnemyCharge', 'Charge']];
  const COLUMNS = 6; // 4 operators, Team (+ battlefield), Enemy

  const newSlot = (op = '', weapon = '', gear = []) => ({
    op, potential: 0, weapon, consumable: '', tactical: '', ue: 'empty', rule: '',
    gear: { armor: gear[0] || '', gloves: gear[1] || '', kit1: gear[2] || '', kit2: gear[3] || '' },
    locks: { armor: false, gloves: false, kit1: false, kit2: false, weapon: false, consumable: false, set: false },
  });
  const defaultState = () => ({
    team: [newSlot('ZhuangFangyi', 'LoneBarge', ['Xiranflow Light Armor', 'Xiranflow Gloves', 'Xiranflow Baton', 'LYNX Slab']), newSlot(), newSlot(), newSlot()],
    enemy: Object.keys(D.enemies)[0], crit: 'mean', startSP: 200, initialStagger: 0, startStaggeredFor: 0,
    actions: ['BattleSkill', 'BasicAttack', 'BasicAttack', 'BasicAttack', 'BasicAttack', 'BasicAttack'].map((action) => ({ slot: 0, action, extraDelay: 0 })),
  });

  function slotStats(slot) {
    const operator = D.operators[slot.op];
    if (!operator) return null;
    const gearPieces = SLOT_KEYS.map((key) => slot.gear[key]).filter(Boolean).map((name) => D.gear.byName(name)).filter(Boolean);
    const weapon = D.weapons[slot.weapon];
    const sheet = E.buildStatSheet({ operator, potential: slot.potential, weapon, gearPieces, setBonuses: D.gear.setBonuses });
    const consumable = D.consumables && D.consumables[slot.consumable], tactical = D.tacticals && D.tacticals[slot.tactical];
    if (consumable) sheet.addModifiers(consumable.modifiers, 'effect:' + consumable.name); // shown stats include the active consumable
    const strength = sheet.attribute('STR');
    const perSet = {};
    for (const piece of gearPieces) if (piece.set) perSet[piece.set] = (perSet[piece.set] || 0) + 1;
    const activeSets = Object.keys(perSet).filter((name) => perSet[name] >= 3);
    return { operator, weapon, gearPieces, sheet, activeSets, consumable, tactical, ATK: sheet.attack(), STR: strength, AGL: sheet.attribute('AGL'), INT: sheet.attribute('INT'), WIL: sheet.attribute('WIL'),
      HP: (operator.baseStats.HP + sheet.sum('HP') + 5 * strength) * (1 + sheet.sum('HPBonus')) };
  }

  // Shared set-up for simulate() and the optimizer's quickRun(): stats, simulation options and the action list.
  function prepare(state) {
    const stats = state.team.map(slotStats);
    const filled = state.team.map((slot, index) => index).filter((index) => stats[index]);
    const enemy = D.enemies[state.enemy];
    if (!filled.length || !enemy) return { stats, filled, empty: true };
    const toSim = new Map(filled.map((slotIndex, simIndex) => [slotIndex, simIndex]));
    const members = filled.map((slotIndex) => {
      const slot = state.team[slotIndex], st = stats[slotIndex];
      return { operator: st.operator, potential: slot.potential, weapon: st.weapon, gearPieces: st.gearPieces, consumable: st.consumable, tactical: st.tactical,
        startUltimateEnergy: slot.ue === 'full' ? st.sheet.ultimateEnergyCost(st.operator.ultimateEnergyCost || 0) : 0 };
    });
    const options = { team: members, enemy, setBonuses: D.gear.setBonuses, criticalMode: state.crit, startingSP: state.startSP,
      initialStagger: state.initialStagger, startStaggeredFor: state.startStaggeredFor };
    const simEntries = [], uiToSim = [], simToUi = [];
    state.actions.forEach((action, uiIndex) => {
      const operatorSlot = action.slot === 5 ? filled[0] : action.slot; // scenario events of the Enemy column run on the first operator's lane
      if (!toSim.has(operatorSlot)) return;
      uiToSim[uiIndex] = simEntries.length; simToUi[simEntries.length] = uiIndex;
      simEntries.push({ operator: toSim.get(operatorSlot), action: action.action, extraDelay: action.extraDelay || 0, hp: action.hp });
    });
    return { stats, filled, enemy, options, simEntries, uiToSim, simToUi };
  }

  // Fast path for the optimizer: total damage and warning count only.
  function quickRun(state) {
    const prepared = prepare(state);
    if (prepared.empty) return { damage: 0, warnings: 0 };
    const result = new E.Simulation(prepared.options).run(prepared.simEntries);
    return { damage: result.totalDamage, warnings: result.warnings.length };
  }

  function simulate(state) {
    const prepared = prepare(state), { stats, filled } = prepared;
    const view = { stats, rows: [], filled, error: null };
    if (prepared.empty) return Object.assign(view, { empty: true });
    try {
      const { enemy, uiToSim, simToUi, simEntries } = prepared;
      const sim = new E.Simulation(prepared.options);
      const result = sim.run(simEntries);
      const nameToColumn = new Map(filled.map((slotIndex) => [stats[slotIndex].operator.name, slotIndex]));
      const rows = state.actions.map((entry, index) => {
        const record = uiToSim[index] === undefined ? null : sim.timeline[uiToSim[index]];
        return { index, entry, record, label: record && record.label ? record.label : null, damage: 0, hits: [], effects: Array.from({ length: COLUMNS }, () => []),
          controlled: record ? nameToColumn.get(record.controlled) : undefined };
      });
      const rowForTime = (time) => {
        let found = null;
        for (const row of rows) if (row.record && !row.record.invalid && row.record.start <= time + 1e-9) found = row;
        return found || rows.find((row) => row.record && !row.record.invalid) || null;
      };
      for (const hit of sim.damageLog) {
        const row = hit.entry !== undefined && simToUi[hit.entry] !== undefined ? rows[simToUi[hit.entry]] : rowForTime(hit.time);
        if (row) { row.damage += hit.damage; row.hits.push(hit); }
      }
      // Effects persist: a row lists every effect that is active when it executes, plus effects created or ended by the row itself.
      for (const row of rows) {
        if (!row.record) continue;
        const simIndex = uiToSim[row.index], start = row.record.start, after = row.record.afterOrder;
        for (const effect of sim.effectTimeline) {
          const column = effect.target === 'Team' ? 4 : effect.target === 'Enemy' ? 5 : nameToColumn.get(effect.target);
          if (column === undefined) continue;
          if (effect.entry !== simIndex && !(effect.start <= start + 1e-9 && effect.order <= after)) continue;
          const alive = effect.end > start + 1e-9 || (Math.abs(effect.end - start) <= 1e-9 && effect.endOrder > after);
          if (!alive && effect.endEntry !== simIndex) continue;
          const list = row.effects[column];
          let item = list.find((candidate) => candidate.name === effect.name);
          if (!item) { item = { name: effect.name, count: 0, ended: true, detail: effect.detail, icon: effect.icon, level: 0, alive: 0, endedCount: 0 }; list.push(item); }
          if (effect.level) item.level = Math.max(item.level, effect.level);
          if (!item.icon) item.icon = effect.icon;
          if (alive) { item.alive++; item.ended = false; } else item.endedCount++; // a badge counts live stacks only (stacks replaced at the cap are not shown)
          item.count = item.alive || item.endedCount;
          if (effect.detail) item.detail = effect.detail;
        }
      }
      Object.assign(view, { sim, result, rows, initialControlled: filled[0], finalUE: filled.map((slotIndex, simIndex) => { const op = sim.operators[simIndex]; return [slotIndex, op.ultimateEnergy, op.ultimateEnergyMax(result.horizon), op.tactical ? op.tacticalUses : null]; }),
        finalStagger: { value: sim.enemy.stagger, capacity: enemy.staggerCapacity, staggered: sim.enemy.isStaggered(result.horizon) } });
    } catch (error) { view.error = error; }
    return view;
  }

  E.builder = { SLOT_KEYS, ACTIONS, ENEMY_ACTIONS, COLUMNS, newSlot, defaultState, slotStats, prepare, quickRun, simulate };
})();
