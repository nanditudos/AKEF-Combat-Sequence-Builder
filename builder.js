// Sequence-builder logic (no DOM): UI state -> simulation -> view model. Used by ui.js and unit tests.
(function () {
  const E = globalThis.Endfield, D = E.data;
  const SLOT_KEYS = ['armor', 'gloves', 'kit1', 'kit2'];
  const ACTIONS = [['BasicAttack', 'BATK'], ['BattleSkill', 'Battle'], ['ComboSkill', 'Combo'], ['Ultimate', 'Ult'], ['Finisher', 'Finish'], ['DiveAttack', 'Dive'], ['Switch', 'Switch']];
  const COLUMNS = 6; // 4 operators, Team (+ battlefield), Enemy

  const newSlot = (op = '', weapon = '', gear = []) => ({
    op, potential: 0, weapon, tactical: '', ue: 'empty',
    gear: { armor: gear[0] || '', gloves: gear[1] || '', kit1: gear[2] || '', kit2: gear[3] || '' },
    locks: { armor: false, gloves: false, kit1: false, kit2: false, weapon: false },
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
    const strength = sheet.attribute('STR');
    return { operator, weapon, gearPieces, sheet, ATK: sheet.attack(), STR: strength, AGL: sheet.attribute('AGL'), INT: sheet.attribute('INT'), WIL: sheet.attribute('WIL'),
      HP: (operator.baseStats.HP + sheet.sum('HP') + 5 * strength) * (1 + sheet.sum('HPBonus')) };
  }

  function simulate(state) {
    const stats = state.team.map(slotStats);
    const filled = state.team.map((slot, index) => index).filter((index) => stats[index]);
    const view = { stats, rows: [], filled, error: null };
    const enemy = D.enemies[state.enemy];
    if (!filled.length || !enemy) return Object.assign(view, { empty: true });
    try {
      const toSim = new Map(filled.map((slotIndex, simIndex) => [slotIndex, simIndex]));
      const members = filled.map((slotIndex) => {
        const slot = state.team[slotIndex], st = stats[slotIndex];
        return { operator: st.operator, potential: slot.potential, weapon: st.weapon, gearPieces: st.gearPieces,
          startUltimateEnergy: slot.ue === 'full' ? st.sheet.ultimateEnergyCost(st.operator.ultimateEnergyCost || 0) : 0 };
      });
      const sim = new E.Simulation({ team: members, enemy, setBonuses: D.gear.setBonuses, criticalMode: state.crit, startingSP: state.startSP,
        initialStagger: state.initialStagger, startStaggeredFor: state.startStaggeredFor });
      const simEntries = [], uiToSim = [], simToUi = [];
      state.actions.forEach((action, uiIndex) => {
        if (!toSim.has(action.slot)) return;
        uiToSim[uiIndex] = simEntries.length; simToUi[simEntries.length] = uiIndex;
        simEntries.push({ operator: toSim.get(action.slot), action: action.action, extraDelay: action.extraDelay || 0 });
      });
      const result = sim.run(simEntries);
      const rows = state.actions.map((entry, index) => ({ index, entry, record: uiToSim[index] === undefined ? null : sim.timeline[uiToSim[index]],
        damage: 0, hits: [], effects: Array.from({ length: COLUMNS }, () => []) }));
      const rowForTime = (time) => {
        let found = null;
        for (const row of rows) if (row.record && !row.record.invalid && row.record.start <= time + 1e-9) found = row;
        return found || rows.find((row) => row.record && !row.record.invalid) || null;
      };
      for (const hit of sim.damageLog) {
        const row = hit.entry !== undefined && simToUi[hit.entry] !== undefined ? rows[simToUi[hit.entry]] : rowForTime(hit.time);
        if (row) { row.damage += hit.damage; row.hits.push(hit); }
      }
      const nameToColumn = new Map(filled.map((slotIndex) => [stats[slotIndex].operator.name, slotIndex]));
      for (const effect of sim.effectLog) {
        const column = effect.target === 'Team' ? 4 : effect.target === 'Enemy' ? 5 : nameToColumn.get(effect.target);
        const row = rowForTime(effect.time);
        if (column === undefined || !row) continue;
        const list = row.effects[column], same = list.find((item) => item.name === effect.name);
        if (same) same.count++; else list.push({ name: effect.name, count: 1, detail: effect.detail });
      }
      Object.assign(view, { sim, result, rows, finalUE: filled.map((slotIndex, simIndex) => [slotIndex, sim.operators[simIndex].ultimateEnergy]) });
    } catch (error) { view.error = error; }
    return view;
  }

  E.builder = { SLOT_KEYS, ACTIONS, COLUMNS, newSlot, defaultState, slotStats, simulate };
})();
