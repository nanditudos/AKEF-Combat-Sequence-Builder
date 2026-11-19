# Writing operator definitions

Everything an operator does is data plus small scripts in `operators.js` / `operators2.js`. You never touch the engine (`sim.js`, `status.js`, `effects.js`, `damage.js`).
Run `node run-node.js` after every change: it loads all files and runs the tests. Open `index.html` to try the operator (it appears in the operator dropdown by itself).

Load order matters only for new files: add `<script src="yourfile.js">` after `operators.js` in `index.html` and `tests.html`, and the file name to the list in `run-node.js`.

## 1. Skeleton

```js
(function () {
  const E = globalThis.Endfield, { mod } = E, K = E.opkit, { batk, P } = K;
  const hit = (a, element, category, multiplier, extra = {}) => a.hit({ element, category, multiplier, ...extra }); // your own shortcut

  E.data.operators.Estella = {
    stars: 4,                       // omit for 6 stars
    ultimateEnergyCost: 70,         // base cost; modifiers (P2 -10%) are applied by the engine
    name: 'Estella', class: 'Guard', element: 'Cryo', weaponType: 'Polearm',
    mainAttribute: 'WIL', secondaryAttribute: 'STR', verified: false,
    baseStats: { HP: 5495, ATK: 312, STR: 104, AGL: 97, INT: 110, WIL: 151 },   // DEF is optional (baseStats.DEF)
    passives: [ ... ],              // section 2
    triggers: [ ... ],              // section 4 (talents that react to events)
    kit: { basicAttackElement, basicAttackSequence, battleSkill, comboSkill, ultimate, forms, finisher, dive, dodge },
  };
})();
```

`class` is one of Guard, Caster, Supporter, Striker, Vanguard, Defender (team talents filter by it). The key you use in `operators.X` is the id.

## 2. Passives: stats from talents and potentials

```js
passives: [
  { name: 'Talent: WIL +60', modifiers: [mod('WIL', 60)] },
  P(2, mod('UltimateEnergyCost', -0.1)),                                  // P(n, ...mods): active from potential n up
  P(4, mod('WIL', 10), mod('STR', 10)),
  P(3, mod('DamageBonus', 0.15, ['BattleSkill'])),
],
```
`mod(stat, value, tags?)` is explained in `nomenclature.js` (valid stats and tags, percent as fractions). A passive that only works in some state is NOT a passive: use a trigger or a form (sections 4 and 6). Skill multiplier changes from potentials are written inside the skill (`ability.potential >= 3 ? 1.4 : 1`).

## 3. Kit

### Basic attacks
```js
basicAttackElement: 'Physical',
basicAttackSequence: batk([0.56, 0.68, 0.79, 0.90], 17),   // multipliers as fractions; the LAST one is the Final Strike, 17 = its stagger
```
Final Strike restores 20 SP, deals the stagger and fires the `FinalStrike` event only for the controlled operator. Finisher (900%, 2s) and Dive (180%, 1s) are automatic; override with `kit.finisher = { multiplier, duration }` / `kit.dive`. `kit.dodge = { duration }` sets the Perfect Dodge time (default 0.5s).

### Skills
A skill is a generator function. Everything in it resolves at the cast START (this is a rule of the sequence builder); the cast takes 1s of lock by default.

```js
battleSkill: { *run(ability) {
  ability.spendSkillPoints(100);
  hit(ability, 'Cryo', 'BattleSkill', 3.5);
  ability.applyInfliction('Cryo', 1);
  ability.dealStagger(10);
} },
comboSkill: {
  windowTriggers: [{ on: 'ReactionApplied', when: ({ event }) => event.name === 'Solidification' }],   // opens the 10s window
  *run(ability) { ... ability.gainUltimateEnergy(10); },
},
ultimate: { *run(ability) { ability.spendUltimateEnergy(70); ... } },
```
Order inside a script is the order things happen. Measured rules you must respect:
- A forced Arts Reaction (`applyReaction`) deals NO initial hit; reactions that come from infliction conversion do.
- Triggers resolve immediately: an effect applied before `hit` already boosts that hit, one applied after does not.
- Apply Susceptibility/forced reactions BEFORE the hit if the hit should benefit.
- Categories for `hit`: `'BasicAttack' | 'BattleSkill' | 'ComboSkill' | 'Ultimate' | 'Status'`. Bonuses like "Battle Skill DMG" key off this.
- Optional hit fields: `subtype`, `statusKind`, `extraCriticalRate`, `linkStacks` (set automatically).

### Timing helpers
- `ability.lockFor(s)`: blocks this operator for s seconds (default 1; Fangyi's BS and CS override it).
- `ability.advance(s)`: moves the timestamp of the NEXT hits by s without delaying the script (multi-hit skills; `if (i > 1) ability.advance(0.1)`).
- `yield ability.wait(s)`: a real delay. Only use it inside `ability.background(function* () { ... }())` for things that really happen later (periodic stance hits, DoT-like ticks).

### Ability calls (everything on `ability`)
| Call | What it does |
|---|---|
| `hit({ element, category, multiplier, ... })` | deals damage |
| `dealStagger(n)` | stagger (Stagger Efficiency applied) |
| `spendSkillPoints(n)`, `returnSkillPoints(n)`, `restoreSkillPoints(n)` | SP: returned SP lowers the cost (no triggers); restored SP fires "restored" triggers |
| `gainUltimateEnergy(n)`, `spendUltimateEnergy(baseCost)` | UE (cost modifiers, shortfall only warns) |
| `applyInfliction(element, stacks)`, `consumeInfliction(element?)` | returns consumed stacks |
| `applyReaction(element, level, { duration, debuffScale, shredScale })`, `consumeReaction(name)` | returns consumed level (0 = none) |
| `applyArtsBurst(element)` | forced Burst |
| `applyVulnerable(n)`, `applyPhysicalStatus('Lift'|'KnockDown'|'Crush'|'Breach', { forced, liftDuration, crushBonus })` | returns `{ effective, stacksConsumed }` |
| `applySusceptibility(element, value, duration)`, `applyDynamicSusceptibility(element, duration, valueAt)` | enemy susceptibility (`element` may be `'Arts'`, `'Physical'`...) |
| `applySlow(s)`, `applyWeakness(s)`, `applyImprisonment(s, onEnd)`, `applyCrystals(s, { shatter, effectName })`, `consumeCrystals()` | enemy states |
| `applyEffect(name, modifiers, duration, state)` | buff on the caster (refreshes; shows as an icon) |
| `grantLink(count, duration)`, `grantTreatment(targets?)`, `announce(type, details)` | team Link stacks / events for weapons and sets |
| `enterForm(name, duration)` | see section 6 |
| `setLabel(text)` | the name shown in the sequence (e.g. `'Battle Skill 2: Trail and Mangle'`) |
| `trackState(name, duration)` / `endState(record)` | an icon-only state (stance, array) that you end yourself |
| `resolveRandom(outcomes, averageable)` | section 5 |

Reading state: `ability.operator` (`.flags` is yours to store things in, `.sheet` has the stats: `ability.operator.sheet.attribute('WIL')`), `ability.potential`, `ability.now`, `ability.enemy.status` (`activeInfliction()`, `reactionLevel(name)`, `vulnerableStacks()`, `hasSusceptibility(el)`, `isLifted()`, `hasCrystals()`), `ability.enemy.isStaggered(ability.now)`, `ability.team`, `ability.simulation.controlled`.

Team buffs from inside a skill:
```js
ability.simulation.giveEffect(give('team', 'MyBuff', [mod('Amp', 0.2, ['Electric'])], 12), { owner: ability.operator, now: ability.now, event: {} });
```
(`give` comes from `E.dsl`.) Targets: `'self' | 'team' | 'others' | 'selfAndOthers' | 'otherElements' | 'classes' | 'enemy'`.

## 4. Triggers (talents, potentials that react to events)

```js
triggers: [
  { on: 'Shatter', apply: ({ owner }) => { owner.flags.commiseration = true; } },
  { on: 'ReactionApplied', cooldown: 1,
    when: ({ event, owner }) => owner.potential >= 5 && event.name === 'Solidification',
    apply: ({ event }) => event.source.gainUltimateEnergy(5) },
  { on: 'VulnerableConsumed', give: give('self', 'Buff', ({ event }) => [mod('ATKBonus', 0.1 * event.stacks)], 20, { maxStacks: 3 }) },
]
```
- `on`: an event name (list below). `by`: `'self'` (default: the event was caused by this operator) or `'any'`.
- `when({ event, owner, simulation, now })`, `cooldown` in seconds, then either `apply(context)` or `give: { to, name, mods, duration, maxStacks?, armedFor? }`. `mods` may be a function of the context. A name without `maxStacks` refreshes, with `maxStacks` every stack has its own timer, `armedFor: ['BattleSkill']` holds the buff for the next such cast.
- `event.source` is the ability that caused the event: it has `.hit(...)`, `.gainUltimateEnergy(...)`, `.category`, `.operator`. To act as the owner when someone else caused the event use `simulation.contextFor(owner, 'BattleSkill')`.
- Combo triggers go in `kit.comboSkill.windowTriggers` (same `on`/`when`, optional `capture(context)` whose result is stored in `operator.comboCapture`).

Events: `BattleStart SkillCast SkillEnd FinalStrike Finisher DiveAttack DamageDealt CriticalHit AmpGained AmpGranted InflictionApplied InflictionBatch InflictionConsumed ReactionApplied ReactionConsumed ArtsBurst PhysicalStatusApplied VulnerableApplied VulnerableConsumed Shatter SusceptibilityApplied SlowApplied WeaknessApplied OriginiumCrystalsApplied OriginiumCrystalsConsumed ImprisonmentApplied EnemyStaggered StaggerNode EnemyChargeStart OperatorAttacked PerfectDodge SPRestored SkillSPReturned LinkGranted TreatmentGranted`.
Useful event fields: `ReactionApplied/Consumed` `{ name, level, element }`, `InflictionBatch` `{ element, stacks }`, `VulnerableApplied` `{ count, stacksBefore }`, `PhysicalStatusApplied` `{ kind, stacksConsumed }`, `SkillCast` `{ category }`, `DamageDealt` `{ category, subtype, element }`, `OperatorAttacked` `{ target, hpBefore, hpAfter, controlled }`.

## 5. Random outcomes

```js
const outcomes = [{ p: 0.1, kind: 'damage', multiplier: 4.8 }, { p: 0.9, kind: 'damage', multiplier: 3.0 }];
const total = ability.resolveRandom(outcomes).reduce((sum, { outcome, weight }) => sum + outcome.multiplier * weight, 0);
hit(ability, 'Physical', 'BattleSkill', total);
```
Mean mode weights outcomes by chance; median mode takes the most likely one (equal chances are still averaged). For outcomes that cannot be averaged (different effects) call `resolveRandom(outcomes, false)`: it returns a single outcome, ties prefer `'effect'` > `'damage'` > `'heal'`.

## 6. Forms, stances, field objects

- **Form with its own basic attacks** (Fangyi): `kit.forms = { Empyrean: { label: 'ULT', basicAttackSequence: batk([...], 18), disablesFinisher: true } }`, then `ability.enterForm('Empyrean', 25)` in the ultimate; test with `operator.inForm('Empyrean', ability.now)`. A form can also stop the operator from gaining UE: `operator.flags.blockUltimateEnergyUntil = ability.now + 25`.
- **Stance / array** (Liino, Arcane): keep a state object on `operator` (see `startStance` in `operators.js`), show it with `trackState`, end it with `endState`.
- **Objects on the field** (Sunderblades): `ability.team.addStacks('Name', count, duration, cap, ability.now)` and `ability.team.countStacks('Name', ability.now)`.
- **Next-cast switching** (Mi Fu): store the next move in `operator.flags` and `setLabel` the move name.

## 7. Worked example

`operators2.js` contains Estella: stats, `P()` passives, two triggers (`Shatter`, `ReactionApplied`), a Battle Skill with a conditional SP return, a combo with a window trigger and a condition on the enemy, and an ultimate with a conditional forced Lift. `operators.js` has the complicated ones: Fangyi (form, free first cast, field objects), Liino (stances, background hits), Arcane (mode from permanent INT/WIL, imprisonment, array), Mi Fu (move cycle).

## 8. Testing your operator

Add checks to `tests.js` (search for "Estella" to see the pattern). The helpers there: `crew([me('Estella')], enemy?, options?)` builds a simulation, `step(0, 'BattleSkill')` is an action, `script(0, function* (a) { ... })` runs setup code (apply a reaction, a Vulnerable stack...), `basicAttacks(0, 5)` is five basic attacks, `warned(sim, /text/)` counts warnings. After `sim.run([...])`: `sim.damageLog` (each hit: `multiplier`, `damage`, `category`, `time`, `factors`), `sim.operators[0].ultimateEnergy`, `sim.team.sp`, `sim.enemy.status`, `sim.effectTimeline`.

## 9. Known assumptions and things the engine does not model
- No HP: use the Take Damage action (`OperatorAttacked`) for "when attacked" talents; healing and shields are ignored (but `grantTreatment` fires the event weapons need).
- Combo cooldowns are informational. One enemy only: "per enemy" effects count one.
- Tell me when you need something the list above does not cover (a new status, an event, a stat): that is an engine change, which I will make.


## 10. Addendum: answers to common operator problems
- **Flat damage** (not scaling with ATK): `ability.hit({ element: 'Physical', category: 'BattleSkill', flatDamage: 300 + 5 * def })`. Bonuses, crit, DEF and resistance still apply; ATK and `multiplier` do not.
- **Stats derived from other stats** (Catcher: DEF = 0.12 x live WIL): add `derived: { DEF: (sheet) => sheet.attribute('WIL') * 0.12 }` to the operator, then use `ability.operator.sheet.defense()` (it includes base DEF, gear DEF, DEF%, and the derived part).
- **Effects on the controlled operator**: `give('controlled', ...)` in `giveEffect`/triggers (also `'nonControlled'`), or from a script `ability.applyEffectTo(ability.controlledOperator(), name, modifiers, duration, state)`. Any other operator: `ability.applyEffectTo(operatorObject, ...)`; end early with `ability.removeEffect(operatorObject, name)`.
- **Protected / Shield**: `ability.applyProtection(target, 0.9, 3)` applies 'Protected' and fires `ProtectionApplied`; `ability.grantShield(target, amount, duration)` applies 'Shield' and fires `ShieldApplied` `{ target, amount }`. Nothing is absorbed (no HP model).
- **Enemy dies**: the event `EnemyDefeated` (once, when the damage dealt reaches the enemy HP). `{ on: 'EnemyDefeated', apply: ... }`; `simulation.enemy.hpFraction()` gives the remaining fraction.
- **Named enemy effects** (Focus): create with `ability.applyEnemyEffect(name, modifiers, duration, ['Heat'])` or the value-over-time form `ability.applyDynamicEnemyEffect(name, duration, (time) => [...modifiers], ['Heat'])` (the last argument lists the susceptibility elements to announce). Check with `simulation.enemy.status.hasEffect('Focus', now)` in `when`. Antal P5 pattern: `const started = ability.now; ... (time) => [{ stat: 'Susceptibility', value: 0.1 + (ability.potential >= 5 && time - started >= 20 ? 0.04 : 0), tags: ['Heat'] }, ...]`.
- **Which effect opened the combo** (Antal): put a `capture` on each window trigger, read it in the combo:
  `windowTriggers: [{ on: 'InflictionBatch', when: focused, capture: ({ event }) => ({ element: event.element }) }, { on: 'PhysicalStatusApplied', when: focused, capture: ({ event }) => ({ kind: event.kind }) }]` and in `run`: `const c = ability.operator.comboCapture;`.
- **Per-operator cooldowns** in triggers: add `cooldownKey: ({ event }) => event.source.operator.name` next to `cooldown`. Antal's healing talent: `{ on: 'DamageDealt', by: 'any', cooldown: 30, cooldownKey: ({ event }) => event.source.operator.name, when: ({ event, now }) => { const o = event.source.operator; o.sheet.currentTime = now; return o.sheet.sum('Amp') > 0; }, apply: ({ event }) => event.source.operator ... simulation.contextFor(owner, 'BattleSkill').grantTreatment([event.source.operator]) }`.
- **Combo cooldown reductions** (Fluorite P5): cooldowns are not simulated, so nothing has to be written (leave a comment).

## 11. Timing: what happens when
- A skill script runs from the cast start. Statements run immediately until the first `yield ability.wait(s)`; after the wait they run s seconds later, at that real time, and their effects are applied at that time. `yield ability.wait()` in the main script is fine; `ability.background(...)` is only needed for work that must outlive the skill's own end (periodic ticks).
- `ability.advance(s)` is different: it does NOT wait. It only stamps the following hits with a later time while everything still resolves at the cast start. Use it only if you want that (the damage log shows the later time, effects are not delayed).
- Link stacks are read at the cast start and consumed when the first synchronous part of the script ends, so an ability with waits consumes them at cast start.
- A row shows an effect only if the effect exists at the row's time.
