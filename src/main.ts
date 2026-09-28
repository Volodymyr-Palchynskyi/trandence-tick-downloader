import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

/**
 * Every lit US equities venue with full depth of book — the same list as
 * Trandence's server. The first five carry most of the trading; after that,
 * alphabetical by exchange family.
 */
const EXCHANGES = [
  { code: 'ARCX', dataset: 'ARCX.PILLAR', name: 'NYSE Arca' },
  { code: 'XNAS', dataset: 'XNAS.ITCH', name: 'Nasdaq' },
  { code: 'EDGX', dataset: 'EDGX.PITCH', name: 'Cboe EDGX' },
  { code: 'MEMX', dataset: 'MEMX.MEMOIR', name: 'MEMX' },
  { code: 'BATS', dataset: 'BATS.PITCH', name: 'Cboe BZX' },
  { code: 'XNYS', dataset: 'XNYS.PILLAR', name: 'NYSE' },
  { code: 'EDGA', dataset: 'EDGA.PITCH', name: 'Cboe EDGA' },
  { code: 'BATY', dataset: 'BATY.PITCH', name: 'Cboe BYX' },
  { code: 'XBOS', dataset: 'XBOS.ITCH', name: 'Nasdaq BX' },
  { code: 'XPSX', dataset: 'XPSX.ITCH', name: 'Nasdaq PSX' },
  { code: 'XASE', dataset: 'XASE.PILLAR', name: 'NYSE American' },
  { code: 'XCHI', dataset: 'XCHI.PILLAR', name: 'NYSE Texas' },
  { code: 'EPRL', dataset: 'EPRL.DOM', name: 'MIAX Pearl' },
] as const;
type Dataset = (typeof EXCHANGES)[number]['dataset'];
const ALL = EXCHANGES.map((e) => e.dataset);

const MAX_DAYS = 31;
const COST_CONCURRENCY = 6;
const DOWNLOAD_CONCURRENCY = 2;
const FOLDER_KEY = 'folder';
const EXCHANGES_KEY = 'exchanges';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ── State ──

/** Quote per dataset and day: a price, null while asking, or Databento's error. */
type Quote = number | null | { error: string };
let quotes = new Map<string, Quote>();
let costRequest = 0;
let days: string[] = [];
let downloading = false;
const selected = new Set<Dataset>(loadSelection());

const quoteKey = (dataset: string, day: string) => `${dataset}|${day}`;

function loadSelection(): Dataset[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(EXCHANGES_KEY) ?? 'null');
    if (Array.isArray(saved)) return ALL.filter((d) => saved.includes(d));
  } catch {
    // Unreadable — fall back to all.
  }
  return [...ALL];
}

function saveSelection(): void {
  localStorage.setItem(EXCHANGES_KEY, JSON.stringify([...selected]));
}

// ── Key ──

async function refreshKey(): Promise<void> {
  const saved = await invoke<boolean>('key_saved').catch(() => false);
  $('key-saved').hidden = !saved;
  $('key-form').hidden = saved;
  if (saved) {
    markValid('key-card');
    void refreshCosts();
  } else {
    render();
  }
}

$('key-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('key-input');
  try {
    await invoke('key_save', { key: input.value });
    input.value = '';
    await refreshKey();
  } catch (err) {
    markInvalid('key-card');
    showDownloadError(String(err));
  }
});
$('key-replace').addEventListener('click', () => {
  $('key-saved').hidden = true;
  $('key-form').hidden = false;
  $<HTMLInputElement>('key-input').focus();
});
$('key-forget').addEventListener('click', async () => {
  await invoke('key_forget').catch((err) => showDownloadError(String(err)));
  await refreshKey();
});

// ── Stock and days ──

function tradingDays(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length <= MAX_DAYS) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

interface FormProblem {
  field: 'symbol' | 'from' | 'to';
  message: string;
}

function readForm(): { symbol: string; days: string[]; problem: FormProblem | null } {
  const symbol = $<HTMLInputElement>('symbol').value.trim().toUpperCase();
  const from = $<HTMLInputElement>('from').value;
  const to = $<HTMLInputElement>('to').value || from;
  if (!symbol) return { symbol, days: [], problem: { field: 'symbol', message: 'Enter a ticker.' } };
  if (!/^[A-Z0-9.]{1,10}$/.test(symbol)) {
    return { symbol, days: [], problem: { field: 'symbol', message: 'Ticker: letters, digits and a dot only.' } };
  }
  if (!from) return { symbol, days: [], problem: { field: 'from', message: 'Choose a day.' } };
  if (to < from) return { symbol, days: [], problem: { field: 'to', message: '"To" is before "From".' } };
  const list = tradingDays(from, to);
  if (list.length > MAX_DAYS) return { symbol, days: [], problem: { field: 'to', message: `Up to ${MAX_DAYS} days at a time.` } };
  if (list.length === 0) return { symbol, days: [], problem: { field: 'to', message: 'No weekdays in that range.' } };
  return { symbol, days: list, problem: null };
}

let debounce = 0;
for (const id of ['symbol', 'from', 'to']) {
  $(id).addEventListener('input', () => {
    markValid(id);
    clearTimeout(debounce);
    debounce = window.setTimeout(() => void refreshCosts(), 600);
  });
}

// ── Prices ──

async function refreshCosts(): Promise<void> {
  const request = ++costRequest;
  const { symbol, days: list, problem } = readForm();
  days = [];
  quotes = new Map();
  $('cost-error').hidden = true;
  const incomplete = problem && problem.field === 'symbol' && !symbol;
  $('days-info').textContent =
    problem && !incomplete
      ? problem.message
      : list.length
        ? `${list.length} weekday${list.length === 1 ? '' : 's'}: ${list[0]}${list.length > 1 ? ` … ${list[list.length - 1]}` : ''}`
        : `Weekdays only. Up to ${MAX_DAYS} days at a time.`;
  if (problem || $('key-saved').hidden) return render();

  days = list;
  const jobs = list.flatMap((day) => ALL.map((dataset) => ({ dataset, day })));
  for (const j of jobs) quotes.set(quoteKey(j.dataset, j.day), null);
  render();

  await runPool(jobs, COST_CONCURRENCY, async ({ dataset, day }) => {
    let quote: Quote;
    try {
      quote = await invoke<number>('get_cost', { symbol, day, dataset });
    } catch (err) {
      quote = { error: String(err) };
    }
    if (request !== costRequest) return;
    quotes.set(quoteKey(dataset, day), quote);
    render();
  });

  // One banner only when nothing could be priced at all (a bad key, no network);
  // an exchange without data for a day shows its own error in its row.
  if (request === costRequest) {
    const all = [...quotes.values()];
    const firstError = all.find((q): q is { error: string } => typeof q === 'object' && q !== null);
    if (firstError && all.every((q) => typeof q === 'object' && q !== null)) {
      $('cost-error').textContent = firstError.error;
      $('cost-error').hidden = false;
    }
  }
}

type Price = { state: 'none' } | { state: 'asking' } | { state: 'error'; error: string } | { state: 'ok'; usd: number };

/** Sum over the chosen days. */
function priceOf(dataset: Dataset): Price {
  if (!days.length) return { state: 'none' };
  let usd = 0;
  for (const day of days) {
    const q = quotes.get(quoteKey(dataset, day));
    if (q === null || q === undefined) return { state: 'asking' };
    if (typeof q === 'object') return { state: 'error', error: q.error };
    usd += q;
  }
  return { state: 'ok', usd };
}

const money = (v: number) => (v > 0 && v < 0.01 ? '< $0.01' : `$${v.toFixed(2)}`);
const escape = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function render(): void {
  $('exchange-rows').innerHTML = EXCHANGES.map((e) => {
    const p = priceOf(e.dataset);
    const cell =
      p.state === 'none'
        ? '—'
        : p.state === 'asking'
          ? '<span class="muted">asking…</span>'
          : p.state === 'error'
            ? `<span class="error-inline" title="${escape(p.error)}">not available</span>`
            : p.usd === 0
              ? '<span class="muted">no data</span>'
              : money(p.usd);
    return `<tr>
      <td><input type="checkbox" data-dataset="${e.dataset}" ${selected.has(e.dataset) ? 'checked' : ''} aria-label="${e.code}" /></td>
      <td><strong>${e.code}</strong> <span class="muted">${e.name}</span></td>
      <td class="muted">${e.dataset}</td>
      <td class="num">${cell}</td>
    </tr>`;
  }).join('');

  const chosen = EXCHANGES.filter((e) => selected.has(e.dataset)).map((e) => priceOf(e.dataset));
  const asking = chosen.some((p) => p.state === 'asking');
  const total = chosen.reduce((s, p) => s + (p.state === 'ok' ? p.usd : 0), 0);
  $('total').textContent = !days.length || !chosen.length ? '—' : asking ? 'asking…' : money(total);

  const files = plannedFiles();
  const button = $<HTMLButtonElement>('download');
  button.disabled = downloading;
  button.textContent = downloading
    ? 'Downloading…'
    : files.length && !asking
      ? `Download · ${files.length} file${files.length === 1 ? '' : 's'} · ${money(total)}`
      : 'Download';
}

$('exchange-rows').addEventListener('change', (e) => {
  const box = e.target as HTMLInputElement;
  const dataset = box.dataset['dataset'] as Dataset | undefined;
  if (!dataset) return;
  if (box.checked) selected.add(dataset);
  else selected.delete(dataset);
  saveSelection();
  markValid('exchanges-card');
  render();
});
$('select-all').addEventListener('click', () => {
  ALL.forEach((d) => selected.add(d));
  saveSelection();
  markValid('exchanges-card');
  render();
});
$('select-none').addEventListener('click', () => {
  selected.clear();
  saveSelection();
  render();
});

// ── Folder ──

function showFolder(): void {
  const folder = localStorage.getItem(FOLDER_KEY);
  $('folder').textContent = folder ?? 'Not chosen';
  $('folder').classList.toggle('muted', !folder);
}
$('choose-folder').addEventListener('click', async () => {
  const picked = await open({ directory: true, multiple: false, defaultPath: localStorage.getItem(FOLDER_KEY) ?? undefined });
  if (typeof picked === 'string') {
    localStorage.setItem(FOLDER_KEY, picked);
    markValid('folder-card');
    showFolder();
  }
});

// ── Validation ──

function markInvalid(id: string): void {
  $(id).classList.add('invalid');
}
function markValid(id: string): void {
  $(id).classList.remove('invalid');
}
function showDownloadError(message: string | null): void {
  $('download-error').textContent = message ?? '';
  $('download-error').hidden = !message;
}

/** Everything a download needs; highlights what is missing and says what to do. */
function checkReady(): string[] {
  const problems: string[] = [];
  if ($('key-saved').hidden) {
    markInvalid('key-card');
    problems.push('Save your Databento API key.');
  }
  const { problem } = readForm();
  if (problem) {
    markInvalid(problem.field);
    problems.push(problem.message);
  }
  if (selected.size === 0) {
    markInvalid('exchanges-card');
    problems.push('Choose at least one exchange.');
  }
  if (!localStorage.getItem(FOLDER_KEY)) {
    markInvalid('folder-card');
    problems.push('Choose a folder for the files.');
  }
  if (problems.length) return problems;

  const chosen = EXCHANGES.filter((e) => selected.has(e.dataset)).map((e) => priceOf(e.dataset));
  if (chosen.some((p) => p.state === 'asking' || p.state === 'none')) return ['Prices are still loading — try again in a moment.'];
  if (plannedFiles().length === 0) {
    markInvalid('exchanges-card');
    return ['None of the chosen exchanges has data for these days.'];
  }
  return [];
}

// ── Download ──

interface PlannedFile {
  id: string;
  dataset: Dataset;
  day: string;
}

/** Chosen exchanges × days with a price above zero (zero: the market was closed). */
function plannedFiles(): PlannedFile[] {
  return days.flatMap((day) =>
    EXCHANGES.filter((e) => {
      const q = quotes.get(quoteKey(e.dataset, day));
      return selected.has(e.dataset) && typeof q === 'number' && q > 0;
    }).map((e) => ({ id: `${e.dataset}-${day}`, dataset: e.dataset, day })),
  );
}

const fileName = (f: PlannedFile) => `${f.dataset.toLowerCase().replace('.', '-')}-${f.day.replaceAll('-', '')}.mbp-10.csv.zst`;
const megabytes = (b: number) => `${(b / 1e6).toFixed(1)} MB`;

function setStatus(id: string, text: string, kind: 'queued' | 'active' | 'done' | 'failed'): void {
  const li = document.querySelector<HTMLElement>(`[data-file="${id}"]`);
  if (!li) return;
  li.className = kind;
  li.querySelector('.status')!.textContent = text;
}

void listen<{ id: string; bytes: number }>('download-progress', (e) => {
  setStatus(e.payload.id, `downloading · ${megabytes(e.payload.bytes)}`, 'active');
});

$('download').addEventListener('click', async () => {
  const problems = checkReady();
  showDownloadError(problems.length ? problems.join(' ') : null);
  if (problems.length) return;

  const symbol = readForm().symbol;
  const folder = localStorage.getItem(FOLDER_KEY)!;
  const files = plannedFiles();

  downloading = true;
  render();
  $('files-card').hidden = false;
  $('files').innerHTML = files
    .map((f) => `<li data-file="${f.id}" class="queued"><span>${fileName(f)}</span><span class="status">queued</span></li>`)
    .join('');

  await runPool(files, DOWNLOAD_CONCURRENCY, async (f) => {
    setStatus(f.id, 'starting…', 'active');
    try {
      const r = await invoke<{ file: string; bytes: number; skipped: boolean }>('download', {
        id: f.id,
        symbol,
        day: f.day,
        dataset: f.dataset,
        folder,
      });
      setStatus(f.id, r.skipped ? `already in the folder · ${megabytes(r.bytes)}` : `done · ${megabytes(r.bytes)}`, 'done');
    } catch (err) {
      setStatus(f.id, String(err), 'failed');
    }
  });

  downloading = false;
  render();
});

// ── Helpers ──

async function runPool<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await work(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// ── Start ──

const today = new Date();
const lastWeekday = new Date(today);
do lastWeekday.setDate(lastWeekday.getDate() - 1);
while (lastWeekday.getDay() === 0 || lastWeekday.getDay() === 6);
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
$<HTMLInputElement>('from').value = iso(lastWeekday);
$<HTMLInputElement>('to').value = iso(lastWeekday);
$<HTMLInputElement>('from').max = iso(today);
$<HTMLInputElement>('to').max = iso(today);

showFolder();
render();
void refreshKey();
