// Fill in by hand. resistance values are percentage points (negative allowed, no clamp).
// tier: Common | Advanced | Elite | Alpha | Boss. Stagger fields are used by the simulation core.
(function () {
  Endfield.data.enemies = Endfield.data.enemies || {};
  Endfield.data.enemies.TestDummy = { // placeholder for tests, not a real enemy
    name: 'Test Dummy', tier: 'Common', level: 90, hp: 100000, defense: 100, canBeLifted: true,
    resistance: { Physical: 0, Heat: 0, Electric: 0, Cryo: 0, Nature: 0 },
    staggerCapacity: 100, staggerNodes: [], staggeredRecovery: 5, finisherSP: 20,
  };
})();
