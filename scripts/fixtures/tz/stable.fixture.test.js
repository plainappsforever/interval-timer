// Fixture for scripts/tz-matrix.test.js: output does not depend on the phone zone.
it('prints a zone independent value', () => {
  console.log(JSON.stringify({ day: new Date(Date.UTC(2026, 10, 19, 12)).toISOString() }));
});
