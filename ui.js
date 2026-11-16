// Sequence builder page. All simulation/view-model logic lives in builder.js; this file only draws and edits state.
(function () {
  if (typeof document === 'undefined') return;
  const E = globalThis.Endfield, B = E.builder, D = E.data;
  const STORAGE_KEY = 'endfieldSimState.v1';
  const ACTION_LABEL = Object.fromEntries(B.ACTIONS);
  const DEFAULT_LABEL = { BasicAttack: 'Basic Attack', BattleSkill: 'Battle Skill', ComboSkill: 'Combo Skill', Ultimate: 'Ultimate', Finisher: 'Finisher', DiveAttack: 'Dive Attack', Switch: 'Switch', Tactical: 'Tactical', PerfectDodge: 'Perfect Dodge', TakeDamage: 'Takes damage', EnemyCharge: 'Enemy charge' };
  const CRIT_HELP = { mean: 'Mean: every crit-capable hit deals the expected value, 1 + Crit Rate × Crit Damage. Best when Crit Rate is high.',
    median: 'Median: the most likely outcome. A hit always crits when Crit Rate is 50% or more and never crits below that. Best when Crit Rate is low.' };
  const sortedByTier = (map) => Object.entries(map || {}).sort((a, b) => b[1].tier - a[1].tier || a[1].name.localeCompare(b[1].name)).map(([key, item]) => [key, `${item.name} (${item.tier}★)`]);
  const HIT_LABEL = { FinalStrike: 'Final Strike', Finisher: 'Finisher', Dive: 'Dive Attack', ArtsBurst: 'Arts Burst', ArtsReaction: 'Arts Reaction', PhysicalStatus: 'Physical Status', Shatter: 'Shatter', ExtraHit: 'Extra Hit', DoT: 'DoT',
    BasicAttack: 'Basic Attack', BattleSkill: 'Battle Skill', ComboSkill: 'Combo Skill', Ultimate: 'Ultimate', Status: 'Status' };
  const COLUMN_CLASS = ['', '', '', '', 'team-col', 'enemy-col'];

  const loadState = () => {
    try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (saved && saved.team && saved.team.length === 4 && saved.actions) return saved; } catch (e) { /* ignore */ }
    return B.defaultState();
  };
  let state = loadState();

  const el = (tag, props = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (value === undefined || value === null || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else if (key in node) node[key] = value; else node.setAttribute(key, value);
    }
    for (const child of children.flat()) if (child !== null && child !== undefined && child !== false) node.append(child);
    return node;
  };
  const appendAll = (parent, ...children) => parent.append(...children.flat().filter((child) => child !== null && child !== undefined && child !== false));
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const select = (options, value, onChange, props = {}) => {
    const node = el('select', props);
    for (const [optionValue, label, disabled] of options) node.append(el('option', { value: optionValue, disabled: Boolean(disabled) }, label));
    node.value = value;
    node.addEventListener('change', () => onChange(node.value));
    return node;
  };
  const numberInput = (value, onChange, props = {}) => {
    const node = el('input', { type: 'number', value, step: 'any', ...props });
    node.addEventListener('change', () => onChange(Number(node.value) || 0));
    return node;
  };
  const update = (mutator) => { mutator(); render(); };

  // ---------- effect icons ----------
  const hue = (name) => { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const iconEl = (effect) => {
    const custom = (E.icons || {})[effect.name], customIsImage = custom && /[\/.]/.test(custom);
    const badge = effect.level ? E.roman(effect.level) : effect.count > 1 ? E.roman(effect.count) : ''; // levels and stack counts as Roman numerals
    const title = effect.name + (effect.detail ? ' (' + effect.detail + ')' : '') + (badge ? ' ' + badge : '') + (effect.ended ? ' — ends / consumed on this row' : '');
    const box = el('span', { class: 'icon' + (effect.ended ? ' ended' : ''), title });
    const glyph = el('span', { class: 'glyph' }, (!customIsImage && custom) || effect.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2));
    box.style.background = `hsl(${hue(effect.name)} 45% 32%)`;
    box.append(glyph);
    if (badge) box.append(el('i', { class: 'n' }, badge));
    const source = customIsImage ? custom : effect.icon ? E.ICON_PATH + effect.icon + '.webp' : null;
    if (source) { // the picture keeps its aspect ratio; if the file is missing the coloured square with initials simply stays
      const image = new Image(); image.alt = '';
      image.onload = () => { glyph.replaceChildren(image); box.style.background = 'transparent'; box.classList.add('has-image'); };
      image.src = source;
    }
    return box;
  };
  const statIcon = (key) => { const image = el('img', { class: 'stat-icon', alt: '' }); image.addEventListener('error', () => image.remove()); image.src = E.ICON_PATH + key + '.webp'; return image; };

  // ---------- settings ----------
  const gearOptions = (list) => [['', '—'], ...list.map((piece) => [piece.name, piece.name + (piece.set ? ' · ' + piece.set : '')])];
  const lockBox = (slot, key) => el('input', { type: 'checkbox', checked: Boolean(slot.locks[key]), title: 'Lock (kept fixed by the optimizer)', onchange: (e) => update(() => { slot.locks[key] = e.target.checked; }) });
  const field = (label, control, lock) => el('div', { class: 'field' }, el('label', {}, label), control, lock || null);

  function slotSettings(index) {
    const slot = state.team[index], wrap = el('div', { class: 'cell' });
    const taken = new Set(state.team.filter((other, i) => i !== index && other.op).map((other) => other.op));
    wrap.append(select([['', '— empty slot —'], ...Object.entries(D.operators).map(([key, op]) => [key, `${op.name} (${op.stars || 6}★)`, taken.has(key)])], slot.op,
      (value) => update(() => { slot.op = value; slot.weapon = ''; slot.potential = 0; }), { class: 'opselect' }));
    const operator = D.operators[slot.op];
    if (!operator) return wrap;
    const activeSets = B.slotStats(slot).activeSets;
    const weapons = Object.entries(D.weapons).filter(([, w]) => w.type === operator.weaponType).sort((a, b) => b[1].stars - a[1].stars || a[1].name.localeCompare(b[1].name));
    wrap.append(
      field('Pot.', select([0, 1, 2, 3, 4, 5].map((n) => [String(n), 'P' + n]), String(slot.potential), (v) => update(() => { slot.potential = Number(v); }))),
      field('Weapon', select([['', '—'], ...weapons.map(([key, w]) => [key, `${w.name} (${w.stars}★)`])], slot.weapon, (v) => update(() => { slot.weapon = v; })), lockBox(slot, 'weapon')),
      field('Armor', select(gearOptions(D.gear.armor), slot.gear.armor, (v) => update(() => { slot.gear.armor = v; })), lockBox(slot, 'armor')),
      field('Gloves', select(gearOptions(D.gear.gloves), slot.gear.gloves, (v) => update(() => { slot.gear.gloves = v; })), lockBox(slot, 'gloves')),
      field('Kit 1', select(gearOptions(D.gear.kits), slot.gear.kit1, (v) => update(() => { slot.gear.kit1 = v; })), lockBox(slot, 'kit1')),
      field('Kit 2', select(gearOptions(D.gear.kits), slot.gear.kit2, (v) => update(() => { slot.gear.kit2 = v; })), lockBox(slot, 'kit2')),
      field('Set', el('span', { class: 'dim' }, activeSets.join(', ') || 'none'), lockBox(slot, 'set')),
      field('Rule', select([['', 'none'], ['INT>=WIL', 'INT ≥ WIL'], ['WIL>INT', 'WIL > INT']], slot.rule || '', (v) => update(() => { slot.rule = v; }), { title: 'Optimizer constraint on permanent INT / WIL, e.g. to force Arcane\'s INT or WILL mode' })),
      field('Cons.', select([['', '—'], ...sortedByTier(D.consumables)], slot.consumable || '', (v) => update(() => { slot.consumable = v; })), lockBox(slot, 'consumable')),
      field('Tact.', select([['', '—'], ...sortedByTier(D.tacticals)], slot.tactical || '', (v) => update(() => { slot.tactical = v; }))),
      field('UE', select([['empty', 'starts at 0'], ['full', 'starts full']], slot.ue, (v) => update(() => { slot.ue = v; }))));
    return wrap;
  }
  const teamSettings = () => el('div', { class: 'cell team-col' },
    field('SP', numberInput(state.startSP, (v) => update(() => { state.startSP = v; }), { min: 0, max: 300 })),
    el('div', { class: 'field wrap' }, el('label', {}, 'Crit'), ['mean', 'median'].map((mode) => el('label', { class: 'radio', title: CRIT_HELP[mode] },
      el('input', { type: 'radio', name: 'critMode', checked: state.crit === mode, onchange: () => update(() => { state.crit = mode; }) }), mode))));
  const enemySettings = () => {
    const enemy = D.enemies[state.enemy], cell = el('div', { class: 'cell enemy-col' });
    cell.append(select(Object.entries(D.enemies).map(([key, item]) => [key, item.name]), state.enemy, (v) => update(() => { state.enemy = v; }), { class: 'opselect' }));
    if (enemy) cell.append(el('div', {}, `${enemy.tier} · Lv ${enemy.level}`), el('div', {}, `HP ${fmt(enemy.hp)} · DEF ${enemy.defense}`),
      ...Object.entries(enemy.resistance).map(([name, value]) => el('div', { class: 'dim' }, `${name} ${(1 - value / 100).toFixed(1)}`))); // shown as the wiki does: 1 - resistance / 100 // shown as the wiki does: resistance / 100
    cell.append(field('Stag.', numberInput(state.initialStagger, (v) => update(() => { state.initialStagger = v; }), { min: 0, title: 'Initial stagger meter' })));
    return cell;
  };

  // ---------- stats ----------
  function slotStatsCell(index, view) {
    const stats = view.stats[index], cell = el('div', { class: 'cell' });
    if (!stats) return cell;
    const main = stats.operator.mainAttribute;
    for (const key of ['HP', 'ATK', 'STR', 'AGL', 'INT', 'WIL']) cell.append(el('div', { class: 'stat' + (key === main ? ' main' : '') }, el('span', {}, statIcon(key), key + ' '), el('b', {}, fmt(stats[key]))));
    const ue = (view.finalUE || []).find(([slotIndex]) => slotIndex === index);
    if (ue) {
      cell.append(el('div', { class: 'dim' }, `UE end ${ue[1].toFixed(1)}/${ue[2].toFixed(1)}`));
      if (ue[3] !== null) cell.append(el('div', { class: 'dim' }, `Tactical uses left ${ue[3]}`));
    }
    if (view.initialControlled === index) cell.append(el('div', { class: 'tag' }, '★ controlled at start'));
    return cell;
  }
  function teamStatsCell(view) {
    const cell = el('div', { class: 'cell team-col' });
    if (view.result) cell.append(el('div', {}, el('span', { class: 'dim' }, 'SP end '), el('b', {}, view.result.finalSP.toFixed(0))));
    return cell;
  }
  function enemyStatsCell(view) {
    const cell = el('div', { class: 'cell enemy-col' }), stagger = view.finalStagger;
    if (stagger) appendAll(cell, el('div', {}, el('span', { class: 'dim' }, 'Stagger end '), el('b', {}, `${Math.round(stagger.value)}/${stagger.capacity}`)), stagger.staggered ? el('div', { class: 'bad' }, 'Staggered') : null);
    return cell;
  }

  // ---------- timeline ----------
  const move = (index, delta) => update(() => { const j = index + delta; if (j >= 0 && j < state.actions.length) [state.actions[index], state.actions[j]] = [state.actions[j], state.actions[index]]; });
  function chip(row) {
    const { entry, record } = row, invalid = !record || record.invalid;
    const percent = (m) => Number((m * 100).toFixed(1));
    const tip = row.hits.map((h) => `${h.time.toFixed(2)} s ${HIT_LABEL[h.subtype] || HIT_LABEL[h.category] || h.category} ${percent(h.multiplier)}% = ${fmt(h.damage)} ${h.element || ''}`).join('\n');
    return el('div', { class: 'chip' + (invalid ? ' invalid' : ''), title: tip },
      el('b', {}, row.label || DEFAULT_LABEL[entry.action] || entry.action),
      row.damage > 0 ? el('span', { class: 'dmg' }, fmt(row.damage)) : null,
      invalid ? el('span', { class: 'reason' }, record ? record.invalid : 'empty slot') : null,
      el('span', { class: 'ctl' },
        entry.action === 'TakeDamage' ? numberInput(entry.hp === undefined ? 100 : entry.hp, (v) => update(() => { entry.hp = Math.max(0, Math.min(100, v)); }), { min: 0, max: 100, title: 'HP % after the hit' }) : null,
        numberInput(entry.extraDelay || 0, (v) => update(() => { entry.extraDelay = Math.max(0, v); }), { min: 0, step: 0.1, title: 'Extra delay (s)' }),
        el('button', { title: 'Move up', onclick: () => move(row.index, -1) }, '↑'), el('button', { title: 'Move down', onclick: () => move(row.index, 1) }, '↓'),
        el('button', { title: 'Remove', onclick: () => update(() => { state.actions.splice(row.index, 1); }) }, '✕')));
  }
  function timelineRow(row) {
    const cells = [el('div', { class: 'cell' }, row.record && !row.record.invalid ? row.record.start.toFixed(2) : '–')];
    for (let column = 0; column < B.COLUMNS; column++) {
      const cell = el('div', { class: 'cell ' + COLUMN_CLASS[column] + (column === row.controlled ? ' ctl' : '') });
      if (column === row.entry.slot) cell.append(chip(row));
      if (row.effects[column].length) cell.append(el('div', { class: 'icons' }, row.effects[column].map(iconEl)));
      cells.push(cell);
    }
    return el('div', { class: 'row' + (row.record && row.record.invalid ? ' invalid' : '') }, cells);
  }
  function addBar() {
    const cells = [el('div', { class: 'cell gut' }, 'add')];
    for (let column = 0; column < B.COLUMNS; column++) {
      const cell = el('div', { class: 'cell ' + COLUMN_CLASS[column] });
      if (column < 4) {
        const bar = el('div', { class: 'adds' });
        for (const [action, label] of B.ACTIONS) bar.append(el('button', { disabled: !state.team[column].op, title: action, onclick: () => update(() => { state.actions.push({ slot: column, action, extraDelay: 0 }); }) }, label));
        cell.append(bar);
      } else if (column === 5) { // scenario events of the enemy
        const bar = el('div', { class: 'adds' });
        for (const [action, label] of B.ENEMY_ACTIONS) bar.append(el('button', { disabled: !state.team.some((slot) => slot.op), title: 'Enemy starts charging a skill', onclick: () => update(() => { state.actions.push({ slot: 5, action, extraDelay: 0 }); }) }, label));
        cell.append(bar);
      }
      cells.push(cell);
    }
    return el('div', { class: 'row' }, cells);
  }

  // ---------- page ----------
  function summary(view) {
    const box = el('div', { class: 'summary' });
    if (view.error) return box.append(el('div', { class: 'err' }, 'Simulation error: ' + (view.error.stack || view.error))) || box;
    if (view.empty) return box.append(el('span', { class: 'dim' }, 'Pick an operator to start.')) || box;
    const r = view.result;
    box.append(el('h2', {}, 'Result'), el('span', {}, 'Total ', el('b', {}, fmt(r.totalDamage))), el('span', {}, 'DPS ', el('b', {}, fmt(r.dps))),
      el('span', { class: 'dim' }, `${r.horizon.toFixed(2)}s`),
      el('span', { class: 'dim' }, Object.entries(r.damageByOperator).map(([name, dmg]) => `${name} ${fmt(dmg)}`).join(' · ')));
    if (r.enemyDeathTime !== null) box.append(el('span', { class: 'bad' }, `enemy dies at ${r.enemyDeathTime.toFixed(2)}s, ${r.wastedPercent.toFixed(1)}% damage wasted`));
    if (r.warnings.length) box.append(el('details', {}, el('summary', { class: 'bad' }, `${r.warnings.length} warning(s)`), r.warnings.map((w) => el('div', {}, `${w.time.toFixed(2)}s  ${w.text}`))));
    return box;
  }
  // ---------- optimizer panel ----------
  const opt = { config: { population: 60, generations: 80, seed: 1, allowWarnings: true }, running: false, stop: false, progress: null, results: null, error: null, open: {} };
  const refreshSidebar = () => { const old = document.querySelector('aside'); if (old) old.replaceWith(sidebar()); };
  async function runOptimizer() {
    Object.assign(opt, { running: true, stop: false, results: null, error: null, progress: null, open: {} });
    refreshSidebar();
    try {
      const problem = E.optimizer.createProblem(state, opt.config);
      opt.results = await E.optimizer.run(problem, opt.config, { onProgress: (p) => { opt.progress = p; refreshSidebar(); }, shouldStop: () => opt.stop });
    } catch (error) { opt.error = error; }
    opt.running = false;
    refreshSidebar();
  }
  const buildLines = (genome) => Object.entries(genome).map(([index, g]) =>
    el('div', { class: 'dim' }, `${D.operators[state.team[index].op].name}: ${[g.armor, g.gloves, g.kit1, g.kit2].join(' · ')}${g.consumable ? ' · ' + D.consumables[g.consumable].name : ''}`));
  function resultsBlock() {
    const r = opt.results, box = el('div', { class: 'opt-results' });
    if (opt.error) return el('div', { class: 'err' }, String(opt.error.message || opt.error));
    if (opt.progress && opt.running) box.append(el('div', { class: 'dim' }, `${opt.progress.phase} ${opt.progress.generation}/${opt.progress.generations} · best ${fmt(opt.progress.best)} · ${opt.progress.evaluations} sims · ${opt.progress.seconds.toFixed(1)}s`));
    if (!r) return box;
    appendAll(box, el('div', {}, 'Current ', el('b', {}, fmt(r.baseline.damage)), r.baseline.warnings ? el('span', { class: 'bad' }, ` (${r.baseline.warnings} warnings)`) : null),
      el('div', { class: 'dim' }, `${r.evaluations} sims in ${r.seconds.toFixed(1)}s${r.stopped ? ' (stopped)' : ''}`),
      !r.feasible && !opt.config.allowWarnings ? el('div', { class: 'bad' }, 'No warning-free build exists; showing the fewest warnings.') : null);
    r.builds.slice(0, 6).forEach((build, i) => box.append(el('details', { open: opt.open[i] !== undefined ? opt.open[i] : i === 0, ontoggle: (e) => { opt.open[i] = e.target.open; } }, // remembers which results are open across re-renders
      el('summary', {}, `#${i + 1} `, el('b', {}, fmt(build.damage)), el('span', { class: build.gain >= 0 ? 'good' : 'bad' }, ` ${build.gain >= 0 ? '+' : ''}${(build.gain * 100).toFixed(1)}%`), build.warnings ? el('span', { class: 'bad' }, ` ${build.warnings}⚠`) : null),
      buildLines(build.genome), el('button', { onclick: () => { E.optimizer.applyBuild(state, build.genome); render(); } }, 'Apply'))));
    return box;
  }
  const sidebar = () => el('aside', {}, el('h2', {}, 'Optimizer'),
    el('p', {}, 'Optimizes armor, gloves, kits and consumable of every operator for the team damage of this sequence. Locked parts, weapons, tacticals and potentials stay.'),
    field('Pop.', numberInput(opt.config.population, (v) => { opt.config.population = Math.max(6, Math.round(v)); }, { min: 6 })),
    field('Gen.', numberInput(opt.config.generations, (v) => { opt.config.generations = Math.max(0, Math.round(v)); }, { min: 0 })),
    field('Seed', numberInput(opt.config.seed, (v) => { opt.config.seed = Math.round(v); })),
    el('label', { class: 'radio', title: 'Off: builds that produce warnings (negative SP, missing UE, closed combo window...) rank below every warning-free build.' },
      el('input', { type: 'checkbox', checked: opt.config.allowWarnings, onchange: (e) => { opt.config.allowWarnings = e.target.checked; } }), 'Allow warnings'),
    el('div', {}, el('button', { disabled: opt.running, onclick: runOptimizer }, 'Optimize'), ' ', el('button', { disabled: !opt.running, onclick: () => { opt.stop = true; } }, 'Stop')),
    resultsBlock(), el('hr'),
    el('button', { onclick: () => update(() => { state.actions = []; }) }, 'Clear sequence'), ' ',
    el('button', { onclick: () => { state = B.defaultState(); render(); } }, 'Reset all'));

  function render() {
    const view = B.simulate(state), grid = el('div', { class: 'grid' });
    const settings = [el('div', { class: 'cell gut' }, 'setup'), ...[0, 1, 2, 3].map(slotSettings), teamSettings(), enemySettings()];
    const stats = [el('div', { class: 'cell gut' }, 'stats'), ...[0, 1, 2, 3].map((i) => slotStatsCell(i, view)), teamStatsCell(view), enemyStatsCell(view)];
    grid.append(el('div', { class: 'row settings' }, settings), el('div', { class: 'row stats' }, stats), addBar(), el('div', { class: 'rows', style: 'display: contents' }, view.rows.map(timelineRow)));
    document.getElementById('app').replaceChildren(sidebar(), el('main', {}, summary(view), grid));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }
  render();
})();
