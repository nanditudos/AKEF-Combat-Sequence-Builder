# Converts Weapons.csv into weapons.js (stats only). Usage: python3 weapons_csv_to_js.py Weapons.csv > weapons.js
# Triggers live in weapon-effects.js, keyed by weapon name.
import csv, sys, json
EXACT = {43.33: 130/3, 34.67: 104/3, 46.43: 325/7, 37.14: 260/7}   # the game does not round; the wiki does
ELEMENTS = ['Physical', 'Electric', 'Heat', 'Cryo', 'Nature']
PLAIN = {'Main Attribute': 'MainAttribute', 'Main Attribute Bonus': 'MainAttributeBonus', 'Secondary Attribute Bonus': 'SecondaryAttributeBonus',
         'ATK Bonus': 'ATKBonus', 'Critical Rate': 'CriticalRate', 'HP Bonus': 'HPBonus', 'Arts Intensity': 'ArtsIntensity',
         'Ultimate Gain Efficiency': 'UltimateEfficiency', 'Treatment Efficiency Bonus': 'TreatmentBonus', 'Shield applied': 'ShieldAppliedBonus',
         'STR': 'STR', 'AGL': 'AGL', 'INT': 'INT', 'WIL': 'WIL'}
TAGGED = {'Combo Skill Damage Bonus': [['ComboSkill']], 'Battle Skill Damage Bonus': [['BattleSkill']], 'Ultimate Damage Bonus': [['Ultimate']],
          'Arts Damage Bonus': [['Arts']], 'Battle Skill and Ultimate Physical Damage Bonus': [['Physical', 'BattleSkill'], ['Physical', 'Ultimate']],
          'Battle Skill and Ultimate Damage Bonus vs Staggered': [['Staggered', 'BattleSkill'], ['Staggered', 'Ultimate']],
          'Damage Bonus against Vulnerable enemies': [['Vulnerable']],
          'Damage Bonus against enemies with Cryo Infliction or Solidification': [['CryoInflictionOrSolidification']]}
def modifiers(name, raw):
    name = name.strip().replace('Damange', 'Damage').replace('Ultimage', 'Ultimate')
    raw = raw.strip(); pct = raw.endswith('%'); v = float(raw.rstrip('%'))
    v = (EXACT.get(v, v) / 100) if pct else v
    v = round(v, 8); v = int(v) if v == int(v) else v
    if name in PLAIN: return [f"mod('{PLAIN[name]}', {v})"]
    if name == 'Skill Damage Dealt': return [f"...mods.skillDamage({v})"]
    if name == 'Combo Skill HP Treatment Bonus': return [f"mod('TreatmentBonus', {v}, ['ComboSkill'])"]
    for e in ELEMENTS:
        if name == f'{e} Damage Bonus': return [f"mod('DamageBonus', {v}, ['{e}'])"]
    if name in TAGGED: return [f"mod('DamageBonus', {v}, {json.dumps(t)})".replace('"', "'") for t in TAGGED[name]]
    raise SystemExit(f'Unknown weapon stat: {name!r}')
rows = list(csv.reader(open(sys.argv[1], encoding='cp1252', newline='')))[1:]
print("// GENERATED from Weapons.csv by weapons_csv_to_js.py. Stats only; triggers are in weapon-effects.js.\n(function () {\n  const { mod, mods } = globalThis.Endfield;")
print("  const weapons = (Endfield.data.weapons = Endfield.data.weapons || {});")
print("  const weapon = (name, stars, type, baseAttack, modifiers, specialName, specialText) =>\n    (weapons[name.replace(/[^A-Za-z0-9]/g, '')] = { name, stars, type, baseAttack, modifiers: modifiers.flat(), specialName, specialText, triggers: [], verified: false });")
for r in rows:
    r = [c.replace('â€™', "'").replace('’', "'") for c in r]  # file is mixed UTF-8 / cp1252
    mods = []
    for i in (4, 6, 8, 10):
        if r[i].strip(): mods += modifiers(r[i], r[i + 1])
    print(f"  weapon({json.dumps(r[0])}, {int(r[1][0])}, {json.dumps(r[2])}, {int(float(r[3]))}, [{', '.join(mods)}], {json.dumps(r[12].strip())}, {json.dumps(' '.join(r[13].split()))});")
print("})();")
