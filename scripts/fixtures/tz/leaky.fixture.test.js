// Fixture for scripts/tz-matrix.test.js: output depends on the phone zone (the bug the tool must catch).
it('prints a zone dependent value', () => {
  console.log(String(new Date(Date.UTC(2026, 10, 19, 12)).getHours()));
});
