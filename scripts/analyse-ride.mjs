#!/usr/bin/env node
/**
 * Turns an exported event log into the ride summary.
 *
 *   node scripts/analyse-ride.mjs ~/Downloads/light-cycle-current-123.json
 *
 * The log stores raw observations, not conclusions — fix rate, smoothing shift
 * and accuracy percentiles all have to be computed from it. This does that, so
 * the numbers on the field-test checklist come out of the file rather than
 * being copied off the debug panel by hand at the roadside.
 *
 * Zero dependencies on purpose: it should run on any machine with node and
 * nothing else installed.
 */

import { readFileSync } from 'node:fs';

const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;

function haversine(a, b) {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

const percentile = (sorted, p) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] : NaN;

const fmt = (n, digits = 1) => (Number.isFinite(n) ? n.toFixed(digits) : '—');

function duration(ms) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, '0')}s`;
}

// --- load --------------------------------------------------------------------

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/analyse-ride.mjs <exported-log.json>');
  process.exit(1);
}

const payload = JSON.parse(readFileSync(path, 'utf8'));
const rows = payload.events ?? payload;
if (!Array.isArray(rows) || rows.length === 0) {
  console.error('No events in that file.');
  process.exit(1);
}

const of = (type) => rows.filter((r) => r.event.type === type);
const first = (type) => of(type)[0]?.event;

// --- fixes -------------------------------------------------------------------

const fixes = of('fix');
const accepted = fixes.filter((f) => !f.event.rejected);
const rejected = fixes.filter((f) => f.event.rejected);

const gaps = fixes.map((f) => f.event.dt).filter((d) => typeof d === 'number' && d > 0);
const meanGap = gaps.reduce((a, b) => a + b, 0) / (gaps.length || 1);
const sortedGaps = [...gaps].sort((a, b) => a - b);

const accuracies = [...fixes.map((f) => f.event.raw.accuracy)].sort((a, b) => a - b);

const shifts = accepted
  .filter((f) => f.event.smoothed)
  .map((f) => haversine(f.event.raw, f.event.smoothed));
const sortedShifts = [...shifts].sort((a, b) => a - b);

const rejectionCounts = rejected.reduce((acc, f) => {
  acc[f.event.rejected] = (acc[f.event.rejected] ?? 0) + 1;
  return acc;
}, {});

// --- report ------------------------------------------------------------------

const started = rows[0].t;
const ended = rows[rows.length - 1].t;
const session = first('session');

const line = (label, value) => console.log(`  ${label.padEnd(26)} ${value}`);
const head = (t) => console.log(`\n${t}\n${'─'.repeat(t.length)}`);

console.log(`\nLIGHT CYCLE — ride analysis`);
console.log(`${path}`);

head('Session');
line('Wall clock', duration(ended - started));
line('Events', String(rows.length));
if (session) {
  line('Screen', session.screen);
  const mob = /iPhone|iPad|Android/.exec(session.ua);
  line('Device', mob ? mob[0] : 'desktop / other');
}

head('GPS');
line('Fixes (total)', String(fixes.length));
line('Accepted / rejected', `${accepted.length} / ${rejected.length}`);
line('Fix rate (mean)', `${fmt(meanGap ? 1000 / meanGap : NaN, 2)} Hz`);
line('Fix gap median', `${fmt(percentile(sortedGaps, 0.5) / 1000, 2)} s`);
line('Fix gap worst', `${fmt(Math.max(...gaps, 0) / 1000, 1)} s`);
line('Accuracy median', `${fmt(percentile(accuracies, 0.5))} m`);
line('Accuracy p90', `${fmt(percentile(accuracies, 0.9))} m`);
line('Accuracy worst', `${fmt(accuracies[accuracies.length - 1])} m`);

head('Smoothing');
line('Shift mean', `${fmt(shifts.reduce((a, b) => a + b, 0) / (shifts.length || 1))} m`);
line('Shift median', `${fmt(percentile(sortedShifts, 0.5))} m`);
line('Shift worst', `${fmt(sortedShifts[sortedShifts.length - 1])} m`);
console.log('  (high mean shift on a straight road = lag; try smoothingWindow down)');

head('Rejections');
if (rejected.length === 0) line('None', '—');
for (const [reason, count] of Object.entries(rejectionCounts)) {
  line(reason, `${count}  (${fmt((count / fixes.length) * 100)}% of fixes)`);
}

head('Tail');
const tails = of('tail');
line('Vertices (max)', String(Math.max(0, ...tails.map((t) => t.event.points))));
line('Length (max)', `${Math.max(0, ...tails.map((t) => t.event.lengthMeters))} m`);
line('Budget (max)', `${Math.max(0, ...tails.map((t) => t.event.maxLengthMeters ?? 0))} m`);
// Logs from before the length-limited tail recorded TTL expiry as `expired`.
line('Trimmed vertices', String(tails.reduce((a, t) => a + (t.event.trimmed ?? t.event.expired ?? 0), 0)));

head('Power-ups');
const placed = first('powerups_placed');
if (placed) {
  line('Requested / placed', `${placed.requested} / ${placed.placed}`);
  line('Placement time', `${placed.elapsedMs} ms`);
  line('Road classes', placed.roadClasses.join(', '));
} else {
  line('Placement', 'never completed');
}
line('Collected', String(of('powerup_collected').length));

head('Play zone');
const zone = of('zone');
if (zone.length === 0) line('No boundary events', '—');
for (const z of zone) {
  const at = new Date(z.t).toLocaleTimeString();
  line(`${z.event.state} @ ${at}`, `${z.event.distanceToEdgeMeters} m from edge`);
}

head('Collisions');
const collisions = of('collision');
if (collisions.length === 0) line('None', '—');
for (const c of collisions) {
  // Position comes from the fix immediately before it — the log stores the
  // decision and the location separately.
  const prior = fixes.filter((f) => f.seq < c.seq).pop();
  const where = prior?.event.smoothed ?? prior?.event.raw;
  line(
    `${c.event.crossingAngleDegrees}° crossing`,
    `${c.event.distanceMeters} m away, ${c.event.tailDistanceMeters} m back` +
      (where ? `  @ ${where.lat.toFixed(5)},${where.lng.toFixed(5)}` : ''),
  );
}

head('Wake lock');
const locks = of('wakelock');
if (locks.length === 0) line('No events', '— (never requested?)');
for (const w of locks) {
  line(new Date(w.t).toLocaleTimeString(), w.event.state + (w.event.message ? ` — ${w.event.message}` : ''));
}
const releases = locks.filter((w) => w.event.state === 'released').length;
if (releases > 0) console.log(`  ⚠ ${releases} release(s) — screen may have slept mid-ride`);

head('Outcome');
for (const e of of('eliminated')) {
  line(e.event.reason, `after ${e.event.elapsedSeconds}s, score ${e.event.score}`);
}
for (const g of of('geo_error')) line('geo error', g.event.message);
if (of('eliminated').length === 0) line('No elimination', 'log ends mid-ride');

console.log('\nStatus transitions');
for (const s of of('status')) console.log(`  ${s.event.from} → ${s.event.to}`);
console.log('');
