import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';

/** Largest share of volume first — measured on 22 days in September 2026. */
const EXCHANGES = [
  { code: 'ARCX', dataset: 'ARCX.PILLAR', share: 41 },
  { code: 'XNAS', dataset: 'XNAS.ITCH', share: 21 },
  { code: 'EDGX', dataset: 'EDGX.PITCH', share: 18 },
  { code: 'MEMX', dataset: 'MEMX.MEMOIR', share: 7 },
  { code: 'BATS', dataset: 'BATS.PITCH', share: 5 },
] as const;
type Dataset = (typeof EXCHANGES)[number]['dataset'];

const MAX_DAYS = 31;
const COST_CONCURRENCY = 4;
const DOWNLOAD_CONCURRENCY = 2;
const FOLDER_KEY = 'folder';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ── State ──

/** Cost per dataset and day, as Databento quoted it; null while asking. */
let costs = new Map<string, number | null>();
let costRequest = 0;
const selected = new Set<Dataset>(EXCHANGES.slice(0, 3).map((e) => e.dataset));
let days: string[] = [];
let downloading = false;

const costKey = (dataset: string, day: string) => `${dataset}|${day}`;

// ── Key ──

async function refreshKey(): Promise<void> {
  const saved = await invoke<boolean>('key_saved').catch(() => false);
  $('key-saved').hidden = !saved;
  $('key-form').hidden = saved;
  if (saved) void refreshCosts();
}

$('key-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = $<HTMLInputElement>('key-input');
  try {
    await invoke('key_save', { key: input.value });
    input.value = '';
    await refreshKey();
  } catch (err) {
    alert(String(err));
  }
});
$('key-replace').addEventListener('click', () => {
  $('key-saved').hidden = true;
  $('key-form').hidden = false;
  $<HTMLInputElement>('key-input').focus();
});
$('key-forget').addEventListener('click', async () => {
  await invoke('key_forget').catch((err) => alert(String(err)));
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

function readForm(): { symbol: string; days: string[]; problem: string | null } {
  const symbol = $<HTMLInputElement>('symbol').value.trim().toUpperCase();
  const from = $<HTMLInputElement>('from').value;
  const to = $<HTMLInputElement>('to').value || from;
  if (!symbol || !from) return { symbol, days: [], problem: null };
  if (!/^[A-Z0-9.]{1,10}$/.test(symbol)) return { symbol, days: [], problem: 'Ticker: letters, digits and a dot only.' };
  if (to < from) return { symbol, days: [], problem: '"To" is before "From".' };
  const list = tradingDays(from, to);
  if (list.length > MAX_DAYS) return { symbol, days: [], problem: `Up to ${MAX_DAYS} days at a time.` };
  if (list.length === 0) return { symbol, days: [], problem: 'No weekdays in that range.' };
  return { symbol, days: list, problem: null };
}

let debounce = 0;
for (const id of ['symbol', 'from', 'to']) {
  $(id).addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = window.setTimeout(() => void refreshCosts(), 600);
  });
}

// ── Prices ──

async function refreshCosts(): Promise<void> {
  const request = ++costRequest;
  const { symbol, days: list, problem } = readForm();
  days = [];
  costs = new Map();
  $('cost-error').hidden = true;
  $('days-info').textContent = problem ?? (list.length ? `${list.length} weekday${list.length === 1 ? '' : 's'}: ${list[0]}${list.length > 1 ? ` … ${list[list.length - 1]}` : ''}` : 'Weekdays only. Up to 31 days at a time.');
  if (problem || !symbol || list.length === 0 || $('key-saved').hidden) return render();

  days = list;
  const jobs = list.flatMap((day) => EXCHANGES.map((e) => ({ dataset: e.dataset, day })));
  for (const j of jobs) costs.set(costKey(j.dataset, j.day), null);
  render();

  let firstError: string | null = null;
  await runPool(jobs, COST_CONCURRENCY, async ({ dataset, day }) => {
    try {
      const cost = await invoke<number>('get_cost', { symbol, day, dataset });
      if (request === costRequest) costs.set(costKey(dataset, day), cost);
    } catch (err) {
      firstError ??= String(err);
      if (request === costRequest) costs.delete(costKey(dataset, day));
    }
    if (request === costRequest) render();
  });
  if (request === costRequest && firstError) {
    $('cost-error').textContent = firstError;
    $('cost-error').hidden = false;
  }
}

/** Sum over the chosen days; null while any is still being asked, NaN if any failed. */
function costOf(dataset: Dataset): number | null {
  let sum = 0;
  for (const day of days) {
    const k = costKey(dataset, day);
    if (!costs.has(k)) return NaN;
    const c = costs.get(k);
    if (c === null || c === undefined) return null;
    sum += c;
  }
  return sum;
}

const money = (v: number) => (v > 0 && v < 0.01 ? '< $0.01' : `$${v.toFixed(2)}`);

function render(): void {
  const rows = EXCHANGES.map((e) => {
    const c = days.length ? costOf(e.dataset) : undefined;
    const price = c === undefined ? '—' : c === null ? 'asking…' : Number.isNaN(c) ? 'error' : c === 0 ? 'no data' : money(c);
    return `<tr>
      <td><input type="checkbox" data-dataset="${e.dataset}" ${selected.has(e.dataset) ? 'checked' : ''} aria-label="${e.code}" /></td>
      <td><strong>${e.code}</strong> <span class="muted">${e.dataset}</span></td>
      <td>~${e.share}%</td>
      <td class="num">${price}</td>
    </tr>`;
  });
  $('exchange-rows').innerHTML = rows.join('');

  const chosen = EXCHANGES.filter((e) => selected.has(e.dataset)).map((e) => costOf(e.dataset));
  const pending = chosen.some((c) => c === null);
  const failed = chosen.some((c) => c !== null && Number.isNaN(c));
  const total = chosen.reduce<number>((s, c) => s + (c && !Number.isNaN(c) ? c : 0), 0);
  $('total').textContent = !days.length || !chosen.length ? '—' : pending ? 'asking…' : money(total) + (failed ? ' (some prices missing)' : '');

  const files = plannedFiles();
  const folder = localStorage.getItem(FOLDER_KEY);
  $('download-summary').textContent = files.length ? `${files.length} file${files.length === 1 ? '' : 's'} · ${money(total)}` : '';
  $<HTMLButtonElement>('download').disabled = downloading || pending || !folder || files.length === 0;
}

$('exchange-rows').addEventListener('change', (e) => {
  const box = e.target as HTMLInputElement;
  const dataset = box.dataset['dataset'] as Dataset | undefined;
  if (!dataset) return;
  if (box.checked) selected.add(dataset);
  else selected.delete(dataset);
  render();
});
$('select-all').addEventListener('click', () => {
  EXCHANGES.forEach((e) => selected.add(e.dataset));
  render();
});
$('select-top3').addEventListener('click', () => {
  selected.clear();
  EXCHANGES.slice(0, 3).forEach((e) => selected.add(e.dataset));
  render();
});

// ── Folder ──

function showFolder(): void {
  const folder = localStorage.getItem(FOLDER_KEY);
  $('folder').textContent = folder ?? 'Not chosen';
  $('folder').classList.toggle('muted', !folder);
  render();
}
$('choose-folder').addEventListener('click', async () => {
  const picked = await open({ directory: true, multiple: false, defaultPath: localStorage.getItem(FOLDER_KEY) ?? undefined });
  if (typeof picked === 'string') {
    localStorage.setItem(FOLDER_KEY, picked);
    showFolder();
  }
});

// ── Download ──

interface PlannedFile {
  id: string;
  dataset: Dataset;
  day: string;
}

/** Selected exchanges × days that have data (a zero price means the market was closed). */
function plannedFiles(): PlannedFile[] {
  return days.flatMap((day) =>
    EXCHANGES.filter((e) => selected.has(e.dataset) && (costs.get(costKey(e.dataset, day)) ?? 0) > 0).map((e) => ({
      id: `${e.dataset}-${day}`,
      dataset: e.dataset,
      day,
    })),
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
  const symbol = readForm().symbol;
  const folder = localStorage.getItem(FOLDER_KEY);
  const files = plannedFiles();
  if (!folder || !files.length) return;

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
void refreshKey();
