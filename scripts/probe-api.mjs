// Checks what the exchange list will show, before any app code exists.
// Calls only metadata.get_cost and metadata.get_billable_size — they are free
// and download nothing.
//
//   DATABENTO_API_KEY=db-... node scripts/probe-api.mjs NBIS 2026-09-25
//
// For each exchange, prints the cost and size of the whole UTC day and of the
// trading day's own window (04:00–20:00 America/New_York).

const API = 'https://hist.databento.com/v0';
const DATASETS = ['ARCX.PILLAR', 'XNAS.ITCH', 'EDGX.PITCH', 'MEMX.MEMOIR', 'BATS.PITCH'];

const key = process.env.DATABENTO_API_KEY;
const [symbol, day] = process.argv.slice(2);
if (!key || !symbol || !/^\d{4}-\d{2}-\d{2}$/.test(day ?? '')) {
  console.error('Usage: DATABENTO_API_KEY=... node scripts/probe-api.mjs SYMBOL YYYY-MM-DD');
  process.exit(1);
}

/** UTC ISO time of a New York wall-clock time on the given day. */
function nyToUtc(date, hhmm) {
  const guess = new Date(`${date}T${hhmm}:00Z`);
  const ny = new Date(guess.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() + (utc - ny)).toISOString();
}

async function call(endpoint, params) {
  const resp = await fetch(`${API}/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${key}:`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ schema: 'mbp-10', symbols: symbol, stype_in: 'raw_symbol', ...params }),
  });
  const text = await resp.text();
  if (!resp.ok) return `HTTP ${resp.status}: ${text.slice(0, 160)}`;
  return Number(text);
}

const next = new Date(`${day}T00:00:00Z`);
next.setUTCDate(next.getUTCDate() + 1);
const windows = {
  'UTC day': { start: `${day}T00:00:00Z`, end: next.toISOString().slice(0, 10) + 'T00:00:00Z' },
  '04:00–20:00 ET': { start: nyToUtc(day, '04:00'), end: nyToUtc(day, '20:00') },
};

console.log(`${symbol} ${day}`);
for (const [name, w] of Object.entries(windows)) console.log(`  ${name}: ${w.start} → ${w.end}`);
console.log();

const fmtCost = (v) => (typeof v === 'number' ? `$${v.toFixed(4)}` : v);
const fmtSize = (v) => (typeof v === 'number' ? `${(v / 1e6).toFixed(1)} MB` : v);

for (const dataset of DATASETS) {
  const row = [dataset.padEnd(13)];
  for (const w of Object.values(windows)) {
    const params = { dataset, start: w.start, end: w.end };
    const [cost, size] = await Promise.all([
      call('metadata.get_cost', params),
      call('metadata.get_billable_size', params),
    ]);
    row.push(`${fmtCost(cost).padStart(10)} ${fmtSize(size).padStart(10)}`);
  }
  console.log(row.join('  |  '));
}
console.log(`\ncolumns: ${Object.keys(windows).join('  |  ')}  (cost, billable size)`);
