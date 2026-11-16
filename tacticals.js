// Tacticals: consumable items usable during combat (max uses each). Only the Ultimate-Energy ones affect the simulation.
// They trigger automatically at ANY moment the condition holds (not only when it becomes true), or manually with the Tactical action (no time, no lock).
// gainFraction is a fraction of the recipient's maximum Ultimate Energy (not scaled by Ultimate Efficiency; blocked while a form forbids UE gain).
(function () {
  const tacticals = (Endfield.data.tacticals = Endfield.data.tacticals || {});
  const tactical = (name, tier, maxUses, gainFraction, targets) => (tacticals[name.replace(/[^A-Za-z0-9]/g, '')] = { name, tier, maxUses, threshold: 0.5, gainFraction, targets, text: `When the operator's Ultimate Energy is below 50%: gain ${gainFraction * 100}% Ultimate Energy (${targets}), ${maxUses} uses` });
  tactical('Stew Meeting', 2, 4, 0.20, 'holder');
  tactical('Mini Honey Slugpudding', 2, 4, 0.08, 'team');
  tactical('Herbal Tisane', 4, 3, 0.40, 'holder');
  tactical('Rhodes Island Special Ration', 5, 3, 0.40, 'holder');
})();
