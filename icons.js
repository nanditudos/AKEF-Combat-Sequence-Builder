// Effect icons. Files live in icons/ next to index.html (see icons.txt for the names). If a file is missing the UI falls back to a coloured square with initials.
//   Endfield.icons['Effect name'] = 'path/or/url.webp'  -> your own image for one effect name (e.g. an operator talent), or a short text/emoji.
//   Effects that carry an `icon` key (statuses, and buffs classified from their stats below) use icons/<key>.webp automatically.
(function () {
  const E = (globalThis.Endfield = globalThis.Endfield || {});
  E.icons = E.icons || {};
  E.ICON_PATH = 'icons/';
  const ELEMENTS = ['Electric', 'Heat', 'Cryo', 'Nature'];

  E.roman = (n) => { // stack counts and levels are shown as Roman numerals, like in game
    let rest = Math.max(0, Math.round(n)), out = '';
    for (const [value, symbol] of [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]) while (rest >= value) { out += symbol; rest -= value; }
    return out || '0';
  };
  E.susceptibilityIcon = (element) => (ELEMENTS.includes(element) ? element + '_Susceptibility' : element === 'Physical' ? 'Physical_Susceptibility' : element === 'Arts' ? 'Arts_Susceptibility' : 'Generic_Susceptibility');

  const DEFENSIVE = new Set(['DEF', 'DEFBonus', 'HP', 'HPBonus', 'FinalDamageReduction', 'TreatmentBonus', 'TreatmentReceivedBonus', 'ShieldAppliedBonus', 'Resistance']);
  const tagsOf = (modifiers, stat) => [...new Set(modifiers.filter((m) => m.stat === stat).flatMap((m) => m.tags || []))];
  // Picks the generic icon of an effect from the stats it grants (used for effects that have no dedicated icon).
  E.iconForModifiers = (modifiers) => {
    const stats = new Set(modifiers.map((m) => m.stat));
    if (stats.has('Amp')) {
      const tags = tagsOf(modifiers, 'Amp');
      return tags.length === 1 && ELEMENTS.includes(tags[0]) ? tags[0] + '_Amp' : tags.length === 1 && tags[0] === 'Arts' ? 'Arts_Amp' : 'Generic_Amp';
    }
    if (stats.has('Susceptibility')) { const tags = tagsOf(modifiers, 'Susceptibility'); return tags.length === 1 ? E.susceptibilityIcon(tags[0]) : 'Generic_Susceptibility'; }
    for (const stat of ['DamageBonus', 'DamageTaken']) {
      if (!stats.has(stat)) continue;
      const tags = tagsOf(modifiers, stat), elements = tags.filter((t) => [...ELEMENTS, 'Physical'].includes(t));
      if (elements.length === 1) return 'Generic_' + elements[0];
      if (!elements.length && tags.includes('Arts')) return 'Generic_Physical'; // Aether is an unused artefact icon; Arts-only effects fall back to Generic_Physical
    }
    if (stats.has('CriticalRate') || stats.has('CriticalDamage')) return 'Critical';
    if (stats.has('StaggerEfficiency')) return 'Generic_Stagger';
    if (modifiers.length && [...stats].every((stat) => DEFENSIVE.has(stat))) return 'Generic_Defense';
    return 'Generic_Attack';
  };
})();
