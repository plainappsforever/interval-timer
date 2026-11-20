-- Store frame 6 (R5 fix round): a believable week of finished workouts instead of two runs the capture flow ended early.
-- Applied by scripts/store-captures.sh to the capture simulator's own database (UPDATE + INSERT only, nothing removed).
UPDATE sessions SET completed = 1, skipped_intervals = 0, interrupted = 0, actual_s = planned_s, ended_at = started_at + planned_s * 1000;
INSERT INTO sessions (timer_id, timer_name, started_at, ended_at, planned_s, actual_s, completed, skipped_intervals, pauses, interrupted, note)
SELECT (SELECT id FROM timers WHERE name = n LIMIT 1), n, (CAST(strftime('%s','now') AS INTEGER) - d * 86400 - h * 3600) * 1000,
       (CAST(strftime('%s','now') AS INTEGER) - d * 86400 - h * 3600 + p) * 1000, p, p, 1, 0, 0, 0, ''
FROM (SELECT 'Tabata' AS n, 1 AS d, 3 AS h, 250 AS p UNION ALL SELECT 'Morning circuit', 1, 15, 835
      UNION ALL SELECT 'Tabata', 2, 4, 250 UNION ALL SELECT 'Morning circuit', 3, 2, 835
      UNION ALL SELECT 'Tabata', 4, 20, 250 UNION ALL SELECT 'Morning circuit', 5, 3, 835);

-- Frame 3 (R6 part 2): every template gets its own work colour so the strips on the tiles visibly differ
-- (template ids 1..n cycle red, amber, green, blue, violet; the first template stays the app's red).
UPDATE intervals SET color = (SELECT substr('#C62828#E08A00#2E7D32#1565C0#6A1B9A', 1 + 7 * ((t.id - 1) % 5), 7)
                              FROM blocks b JOIN timers t ON t.id = b.timer_id WHERE b.id = intervals.block_id)
WHERE type = 'work' AND block_id IN (SELECT b.id FROM blocks b JOIN timers t ON t.id = b.timer_id WHERE t.kind = 'template');
