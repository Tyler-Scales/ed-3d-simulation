#!/usr/bin/env node
// Runs the simulation engine without a browser and prints one row per simulated day.
// Usage: node scripts/run-headless.js [--days 7] [--arrivals 60] [--providers 2] [--nurses 3] [--board 150] [--seed 15029]
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
};
const days = opt('days', 7);
const seed = opt('seed', 15029);
const params = {
  perDay: opt('arrivals', 60),
  providers: opt('providers', 2),
  nurses: opt('nurses', 3),
  boardMed: opt('board', 150),
};

// The engine lives in index.html inside <script id="engine"> and has no DOM dependencies.
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.match(/<script id="engine">([\s\S]*?)<\/script>/)[1];
const EDSim = new Function(source + '; return EDSim;')();

const median = a => { if (!a.length) return null; a.sort((x, y) => x - y); return a[a.length >> 1]; };
const S = EDSim.create(seed, params);
while (S.t < 0) EDSim.step(S); // one warm-up day so the department is not empty at the start

const rows = [];
let arrivalsAtDayStart = S.arrivals, peakBeds = 0, peakWaiting = 0, bedMinutes = 0;
while (S.t < 1440 * days) {
  EDSim.step(S);
  const m = EDSim.metrics(S);
  peakBeds = Math.max(peakBeds, m.inBed);
  peakWaiting = Math.max(peakWaiting, m.waiting);
  bedMinutes += m.inBed;
  if (S.t % 1440 === 0) {
    const done = S.done; // visits that ended in the last 24 simulated hours
    const discharged = done.filter(p => p.outcome === 'discharged');
    const admitted = done.filter(p => p.outcome === 'admitted');
    const lwbs = done.filter(p => p.outcome === 'lwbs');
    rows.push({
      day: S.t / 1440,
      arrivals: S.arrivals - arrivalsAtDayStart,
      departures: done.length,
      'LWBS %': +(lwbs.length / Math.max(1, done.length) * 100).toFixed(1),
      'admit %': +(admitted.length / Math.max(1, done.length) * 100).toFixed(1),
      'door-to-provider (min)': median(done.filter(p => p.tProv != null).map(p => p.tProv - p.tArr)),
      'LOS discharged (min)': median(discharged.map(p => p.tOut - p.tArr)),
      'LOS admitted (min)': median(admitted.map(p => p.tOut - p.tArr)),
      'CT scans': done.filter(p => p.tCT != null).length,
    });
    arrivalsAtDayStart = S.arrivals;
  }
}
console.log('Parameters:', JSON.stringify(params), 'seed', seed);
console.table(rows);
console.log('Average beds occupied: ' + (bedMinutes / (1440 * days)).toFixed(1) + ' of ' + EDSim.NBEDS +
  ' | peak beds: ' + peakBeds + ' | peak waiting: ' + peakWaiting);
