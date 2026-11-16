# Converts Consumables.csv into consumables.js.  Usage: python3 consumables_csv_to_js.py Consumables.csv > consumables.js
import csv, json, re, sys
ATTRS = ['STR', 'AGL', 'INT', 'WIL']
def pct(text): return round(float(text) / 100, 6)
RULES = [  # (regex, function(match) -> list of JS mod() calls)
    (r'All Attributes \+([\d.]+)', lambda m: [f"mod('{a}', {float(m[1]):g})" for a in ATTRS]),
    (r'(?:All DMG Dealt|All Damage|(?<!All )(?<!Physical )DMG Dealt) \+([\d.]+)%', lambda m: [f"mod('DamageBonus', {pct(m[1])})"]),
    (r'Physical DMG Dealt \+([\d.]+)%', lambda m: [f"mod('DamageBonus', {pct(m[1])}, ['Physical'])"]),
    (r'ATK \+([\d.]+)%', lambda m: [f"mod('ATKBonus', {pct(m[1])})"]),
    (r'ATK \+(\d+)(?![\d.%])', lambda m: [f"mod('ATK', {m[1]})"]),
    (r'Critical Rate \+([\d.]+)%', lambda m: [f"mod('CriticalRate', {pct(m[1])})"]),
    (r'Ultimate Gain Efficiency \+([\d.]+)%', lambda m: [f"mod('UltimateEfficiency', {pct(m[1])})"]),
    (r'Treatment Received Bonus \+([\d.]+)%', lambda m: [f"mod('TreatmentReceivedBonus', {pct(m[1])})"]),
    (r'(?<!Received )Treatment Bonus \+([\d.]+)%', lambda m: [f"mod('TreatmentBonus', {pct(m[1])})"]),
    (r'DMG Reduction \+([\d.]+)%', lambda m: [f"mod('FinalDamageReduction', {pct(m[1])})"]),
    (r'([\d.]+)% DMG Reduction', lambda m: [f"mod('FinalDamageReduction', {pct(m[1])})"]),
    (r'shorten Combo Skill CD by ([\d.]+)%', lambda m: [f"mod('ComboSkillCooldownReduction', {pct(m[1])})"]),
    (r'DEF \+([\d.]+)%', lambda m: [f"mod('DEFBonus', {pct(m[1])})"]),
    (r'DEF -([\d.]+)%', lambda m: [f"mod('DEFBonus', {-pct(m[1])})"]),
    (r'grant ([\d.]+)% DEF', lambda m: [f"mod('DEFBonus', {pct(m[1])})"]),
    (r'DEF \+(\d+(?:\.\d+)?)(?![\d.%])', lambda m: [f"mod('DEF', {m[1]})"]),   # no % sign in the source -> flat DEF
]
rows = list(csv.DictReader(open(sys.argv[1], encoding='utf-8-sig', newline='')))
print("// GENERATED from Consumables.csv by consumables_csv_to_js.py. Consumables are used outside combat: they activate once at the start of the battle and expire.\n(function () {\n  const { mod } = globalThis.Endfield;\n  const consumables = (Endfield.data.consumables = Endfield.data.consumables || {});")
print("  const consumable = (name, tier, duration, modifiers, text) => (consumables[name.replace(/[^A-Za-z0-9]/g, '')] = { name, tier, duration, modifiers, text });")
for row in rows:
    text = ' '.join(row['Effect'].split()); mods = []
    for pattern, build in RULES:
        for match in re.finditer(pattern, text): mods += build(match)
    duration = float(re.search(r'Duration: (\d+)s', text)[1])
    if not mods: raise SystemExit('No modifiers parsed for ' + row['Name'])
    print(f"  consumable({json.dumps(row['Name'], ensure_ascii=False)}, {int(row['Tier'])}, {duration:g}, [{', '.join(mods)}], {json.dumps(text, ensure_ascii=False)});")
print("})();")
