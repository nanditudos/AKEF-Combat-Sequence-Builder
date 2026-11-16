// Sequence builder page. All simulation/view-model logic lives in builder.js; this file only draws and edits state.
(function () {
  if (typeof document === 'undefined') return;
  const E = globalThis.Endfield, B = E.builder, D = E.data;
  const STORAGE_KEY = 'endfieldSimState.v1';
  const ACTION_LABEL = Object.fromEntries(B.ACTIONS);
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
    const custom = (E.icons || {})[effect.name];
    const title = effect.name + (effect.detail ? ' ' + effect.detail : '') + (effect.count > 1 ? ' ×' + effect.count : '');
    const box = el('span', { class: 'icon', title });
    box.style.background = `hsl(${hue(effect.name)} 45% 32%)`;
    if (custom && /[\/.]/.test(custom)) box.append(el('img', { src: custom, alt: effect.name }));
    else box.textContent = custom || effect.name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2);
    return box;
  };

  // ---------- settings ----------
  const gearOptions = (list) => [['', '—'], ...list.map((piece) => [piece.name, piece.name + (piece.set ? ' · ' + piece.set : '')])];
  const lockBox = (slot, key) => el('input', { type: 'checkbox', checked: Boolean(slot.locks[key]), title: 'Lock (kept fixed by the optimizer)', onchange: (e) => update(() => { slot.locks[key] = e.target.checked; }) });
  const field = (label, control, lock) => el('div', { class: 'field' }, el('label', {}, label), control, lock || null);

  function slotSettings(index) {
    const slot = state.team[index], wrap = el('div', { class: 'cell' });
    const taken = new Set(state.team.filter((other, i) => i !== index && other.op).map((other) => other.op));
    wrap.append(select([['', '— empty slot —'], ...Object.entries(D.operators).map(([key, op]) => [key, op.name, taken.has(key)])], slot.op,
      (value) => update(() => { slot.op = value; slot.weapon = ''; slot.potential = 0; }), { class: 'opselect' }));
    const operator = D.operators[slot.op];
    if (!operator) return wrap;
    const weapons = Object.entries(D.weapons).filter(([, w]) => w.type === operator.weaponType).sort((a, b) => b[1].stars - a[1].stars || a[1].name.localeCompare(b[1].name));
    wrap.append(
      field('Pot.', select([0, 1, 2, 3, 4, 5].map((n) => [String(n), 'P' + n]), String(slot.potential), (v) => update(() => { slot.potential = Number(v); }))),
      field('Weapon', select([['', '—'], ...weapons.map(([key, w]) => [key, `${w.name} (${w.stars}★)`])], slot.weapon, (v) => update(() => { slot.weapon = v; })), lockBox(slot, 'weapon')),
      field('Armor', select(gearOptions(D.gear.armor), slot.gear.armor, (v) => update(() => { slot.gear.armor = v; })), lockBox(slot, 'armor')),
      field('Gloves', select(gearOptions(D.gear.gloves), slot.gear.gloves, (v) => update(() => { slot.gear.gloves = v; })), lockBox(slot, 'gloves')),
      field('Kit 1', select(gearOptions(D.gear.kits), slot.gear.kit1, (v) => update(() => { slot.gear.kit1 = v; })), lockBox(slot, 'kit1')),
      field('Kit 2', select(gearOptions(D.gear.kits), slot.gear.kit2, (v) => update(() => { slot.gear.kit2 = v; })), lockBox(slot, 'kit2')),
      field('Tact.', select([['', 'None']], slot.tactical, () => {})),
      field('UE', select([['empty', 'starts at 0'], ['full', 'starts full']], slot.ue, (v) => update(() => { slot.ue = v; }))));
    return wrap;
  }
  const teamSettings = () => el('div', { class: 'cell team-col' },
    field('SP', numberInput(state.startSP, (v) => update(() => { state.startSP = v; }), { min: 0, max: 300 })),
    field('Crit', select([['mean', 'mean'], ['median', 'median']], state.crit, (v) => update(() => { state.crit = v; }))));
  const enemySettings = () => el('div', { class: 'cell enemy-col' },
    select(Object.entries(D.enemies).map(([key, enemy]) => [key, enemy.name]), state.enemy, (v) => update(() => { state.enemy = v; }), { class: 'opselect' }),
    field('Stag.', numberInput(state.initialStagger, (v) => update(() => { state.initialStagger = v; }), { min: 0 })),
    field('Stag.t', numberInput(state.startStaggeredFor, (v) => update(() => { state.startStaggeredFor = v; }), { min: 0, title: 'Enemy starts Staggered until this time (s)' })));

  // ---------- stats ----------
  function slotStatsCell(index, view) {
    const stats = view.stats[index], cell = el('div', { class: 'cell' });
    if (!stats) return cell;
    const main = stats.operator.mainAttribute;
    for (const key of ['HP', 'ATK', 'STR', 'AGL', 'INT', 'WIL']) cell.append(el('div', { class: 'stat' + (key === main ? ' main' : '') }, el('span', {}, key + ' '), el('b', {}, fmt(stats[key]))));
    const ue = (view.finalUE || []).find(([slotIndex]) => slotIndex === index);
    if (ue) cell.append(el('div', { class: 'dim' }, `UE end ${ue[1].toFixed(1)}`));
    return cell;
  }
  function teamStatsCell(view) {
    const cell = el('div', { class: 'cell team-col' });
    if (view.result) cell.append(el('div', {}, el('span', { class: 'dim' }, 'SP end '), el('b', {}, view.result.finalSP.toFixed(0))));
    return cell;
  }
  function enemyStatsCell() {
    const enemy = D.enemies[state.enemy], cell = el('div', { class: 'cell enemy-col' });
    if (!enemy) return cell;
    cell.append(el('div', {}, `${enemy.tier} · Lv ${enemy.level}`), el('div', {}, `HP ${fmt(enemy.hp)} · DEF ${enemy.defense}`),
      el('div', { class: 'dim' }, Object.entries(enemy.resistance).map(([k, v]) => `${k.slice(0, 3)} ${v}`).join(' ')), el('div', { class: 'dim' }, `Stagger ${enemy.staggerCapacity}`));
    return cell;
  }

  // ---------- timeline ----------
  const move = (index, delta) => update(() => { const j = index + delta; if (j >= 0 && j < state.actions.length) [state.actions[index], state.actions[j]] = [state.actions[j], state.actions[index]]; });
  function chip(row) {
    const { entry, record } = row, invalid = !record || record.invalid;
    const tip = row.hits.map((h) => `${h.time.toFixed(2)}s ${h.category}${h.subtype ? '/' + h.subtype : ''} ×${h.multiplier.toFixed(2)} = ${fmt(h.damage)}`).join('\n');
    return el('div', { class: 'chip' + (invalid ? ' invalid' : ''), title: tip },
      el('b', {}, ACTION_LABEL[entry.action] || entry.action),
      row.damage > 0 ? el('span', { class: 'dmg' }, fmt(row.damage)) : null,
      invalid ? el('span', { class: 'reason' }, record ? record.invalid : 'empty slot') : null,
      el('span', { class: 'ctl' },
        numberInput(entry.extraDelay || 0, (v) => update(() => { entry.extraDelay = Math.max(0, v); }), { min: 0, step: 0.1, title: 'Extra delay (s)' }),
        el('button', { title: 'Move up', onclick: () => move(row.index, -1) }, '↑'), el('button', { title: 'Move down', onclick: () => move(row.index, 1) }, '↓'),
        el('button', { title: 'Remove', onclick: () => update(() => { state.actions.splice(row.index, 1); }) }, '✕')));
  }
  function timelineRow(row) {
    const cells = [el('div', { class: 'cell' }, row.record && !row.record.invalid ? row.record.start.toFixed(2) : '–')];
    for (let column = 0; column < B.COLUMNS; column++) {
      const cell = el('div', { class: 'cell ' + COLUMN_CLASS[column] });
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
    if (r.enemyDeathTime !== null) box.append(el('span', { class: 'bad' }, `enemy dies at ${r.enemyDeathTime.toFixed(2)}s, ${r.wastedPercent.toFixed(1)}% overkill`));
    if (r.warnings.length) box.append(el('details', {}, el('summary', { class: 'bad' }, `${r.warnings.length} warning(s)`), r.warnings.map((w) => el('div', {}, `${w.time.toFixed(2)}s  ${w.text}`))));
    return box;
  }
  const sidebar = () => el('aside', {}, el('h2', {}, 'Optimizer'), el('p', {}, 'Reserved for optimizer settings and results.'),
    el('button', { onclick: () => update(() => { state.actions = []; }) }, 'Clear sequence'), ' ',
    el('button', { onclick: () => { state = B.defaultState(); render(); } }, 'Reset all'));

  function render() {
    const view = B.simulate(state), grid = el('div', { class: 'grid' });
    const settings = [el('div', { class: 'cell gut' }, 'setup'), ...[0, 1, 2, 3].map(slotSettings), teamSettings(), enemySettings()];
    const stats = [el('div', { class: 'cell gut' }, 'stats'), ...[0, 1, 2, 3].map((i) => slotStatsCell(i, view)), teamStatsCell(view), enemyStatsCell()];
    grid.append(el('div', { class: 'row settings' }, settings), el('div', { class: 'row stats' }, stats), addBar(), el('div', { class: 'rows', style: 'display: contents' }, view.rows.map(timelineRow)));
    document.getElementById('app').replaceChildren(sidebar(), el('main', {}, summary(view), grid));
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* storage unavailable */ }
  }
  render();
})();
