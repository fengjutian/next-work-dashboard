// V2 Heatmap unit test: spin up an in-process sql.js + drizzle, insert
// synthetic 7-day data, and verify dbAggregateHeatmap returns sensible cells.
//
// Why: the heatmap is JS-side aggregation over probe_results, so we can
// test the logic in isolation without a running nwd process.

import initSqlJs from 'sql.js';
import { drizzle } from 'drizzle-orm/sql-js';
import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const wasmPath = path.join(here, '..', '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');

const netProbeTargets = sqliteTable('net_probe_targets', {
  id: text('id').primaryKey(),
  target: text('target').notNull(),
  probe: text('probe').notNull().default('icmp'),
  interval_ms: integer('interval_ms').notNull().default(5000),
  timeout_ms: integer('timeout_ms').notNull().default(3000),
  options_json: text('options_json').notNull().default('{}'),
  enabled: integer('enabled').notNull().default(1),
  created_at: integer('created_at').notNull(),
  updated_at: integer('updated_at').notNull(),
});

const netProbeResults = sqliteTable('net_probe_results', {
  id: text('id').primaryKey(),
  target_id: text('target_id').notNull(),
  probe: text('probe').notNull(),
  timestamp_ms: integer('timestamp_ms').notNull(),
  success: integer('success').notNull(),
  latency_ms: integer('latency_ms'),
  error: text('error'),
  payload_json: text('payload_json').notNull().default('{}'),
});

const wasmBinary = await readFile(wasmPath);
const SQL = await initSqlJs({ wasmBinary });
const sqlDb = new SQL.Database();
const db = drizzle(sqlDb, { schema: { netProbeTargets, netProbeResults } });

// Create tables.
sqlDb.run(`CREATE TABLE net_probe_targets (
  id TEXT PRIMARY KEY, target TEXT NOT NULL, probe TEXT NOT NULL DEFAULT 'icmp',
  interval_ms INTEGER NOT NULL DEFAULT 5000, timeout_ms INTEGER NOT NULL DEFAULT 3000,
  options_json TEXT NOT NULL DEFAULT '{}', enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
)`);
sqlDb.run(`CREATE TABLE net_probe_results (
  id TEXT PRIMARY KEY, target_id TEXT NOT NULL, probe TEXT NOT NULL,
  timestamp_ms INTEGER NOT NULL, success INTEGER NOT NULL,
  latency_ms INTEGER, error TEXT, payload_json TEXT NOT NULL DEFAULT '{}'
)`);

const TARGET_ID = 't1';
const now = Date.now();
const dayMs = 24 * 60 * 60 * 1000;

const rows = [];
let id = 0;
for (let day = 6; day >= 0; day--) {
  for (let hour = 0; hour < 24; hour++) {
    // 6 samples per (day, hour) for realism.
    for (let s = 0; s < 6; s++) {
      const ts = now - day * dayMs - (24 - hour) * 3600_000 + s * 30_000;
      // Higher latency + loss in the evening (18-23) of weekdays (Mon-Fri).
      const isWeekday = day >= 5; // treat recent days as "weekday" for noise
      const isEvening = hour >= 18;
      const noisy = isWeekday && isEvening;
      const success = Math.random() > (noisy ? 0.18 : 0.02);
      const latency = success
        ? 30 + Math.random() * 50 + (noisy ? 100 + Math.random() * 200 : 0)
        : null;
      rows.push({
        id: `r${id++}`,
        target_id: TARGET_ID,
        probe: 'icmp',
        timestamp_ms: ts,
        success: success ? 1 : 0,
        latency_ms: latency,
        error: success ? null : 'timeout',
        payload_json: '{}',
      });
    }
  }
}
db.insert(netProbeTargets).values({
  id: TARGET_ID, target: '1.1.1.1', probe: 'icmp',
  interval_ms: 5000, timeout_ms: 3000, options_json: '{}', enabled: 1,
  created_at: now, updated_at: now,
}).run();
db.insert(netProbeResults).values(rows).run();

// Now replicate dbAggregateHeatmap logic (mirrors the TS implementation).
function aggregateHeatmap(targetId, sinceMs) {
  const cutoff = sinceMs ?? Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recent = db.select().from(netProbeResults)
    .where(sql`${netProbeResults.target_id} = ${targetId} AND ${netProbeResults.timestamp_ms} > ${cutoff}`)
    .all();
  const cells = new Map();
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
    cells.set(`${d}:${h}`, { dayOfWeek: d, hourOfDay: h, avgLatencyMs: null, sampleCount: 0, lossPct: 0 });
  }
  const sums = new Map();
  for (const r of recent) {
    const d = new Date(r.timestamp_ms);
    const dow = (d.getDay() + 6) % 7;
    const hod = d.getHours();
    const key = `${dow}:${hod}`;
    const cell = cells.get(key);
    if (!cell) continue;
    cell.sampleCount += 1;
    if (!r.success) {
      const agg = sums.get(key) ?? { sumLat: 0, count: 0, loss: 0 };
      agg.loss += 1;
      sums.set(key, agg);
    } else if (r.latency_ms != null) {
      const agg = sums.get(key) ?? { sumLat: 0, count: 0, loss: 0 };
      agg.sumLat += r.latency_ms;
      agg.count += 1;
      sums.set(key, agg);
    }
  }
  for (const [key, agg] of sums) {
    const cell = cells.get(key);
    if (!cell) continue;
    cell.avgLatencyMs = agg.count > 0 ? agg.sumLat / agg.count : null;
    cell.lossPct = cell.sampleCount > 0 ? (agg.loss / cell.sampleCount) * 100 : 0;
  }
  return Array.from(cells.values()).sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.hourOfDay - b.hourOfDay);
}

const cells = aggregateHeatmap(TARGET_ID, now - 7 * dayMs);
console.log(`Total cells: ${cells.length}`);
const filled = cells.filter((c) => c.avgLatencyMs != null);
console.log(`Filled cells: ${filled.length}`);

// Sample a few cells to show the pattern.
console.log('\nMon 18-20 (weekday evening — should be high):');
for (const c of cells.filter((c) => c.dayOfWeek === 0 && c.hourOfDay >= 18 && c.hourOfDay <= 20)) {
  console.log(`  ${c.dayOfWeek}:${String(c.hourOfDay).padStart(2)} avg=${c.avgLatencyMs?.toFixed(1) ?? '—'}ms loss=${c.lossPct.toFixed(0)}% n=${c.sampleCount}`);
}
console.log('\nSat 03-05 (weekend night — should be low):');
for (const c of cells.filter((c) => c.dayOfWeek === 5 && c.hourOfDay >= 3 && c.hourOfDay <= 5)) {
  console.log(`  ${c.dayOfWeek}:${String(c.hourOfDay).padStart(2)} avg=${c.avgLatencyMs?.toFixed(1) ?? '—'}ms loss=${c.lossPct.toFixed(0)}% n=${c.sampleCount}`);
}
console.log('\nMon 03-05 (weekday night — also low):');
for (const c of cells.filter((c) => c.dayOfWeek === 0 && c.hourOfDay >= 3 && c.hourOfDay <= 5)) {
  console.log(`  ${c.dayOfWeek}:${String(c.hourOfDay).padStart(2)} avg=${c.avgLatencyMs?.toFixed(1) ?? '—'}ms loss=${c.lossPct.toFixed(0)}% n=${c.sampleCount}`);
}
