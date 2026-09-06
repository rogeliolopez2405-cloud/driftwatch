/* Driftwatch board. Plain DOM, no framework, no build step.
   It reads /api/board and draws cards. That is all it does. */

const grid = document.querySelector('[data-grid]');
const empty = document.querySelector('[data-empty]');
const stamp = document.querySelector('[data-stamp]');
const refreshBtn = document.querySelector('[data-refresh]');
const drawer = document.querySelector('[data-drawer]');

let state = { cards: [], counts: { cards: 0, attention: 0, stale: 0 } };
let view = 'all';

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function describeAge(ms) {
  if (!Number.isFinite(ms)) return 'unknown';
  if (ms < MINUTE) return 'just now';
  if (ms < HOUR) return Math.floor(ms / MINUTE) + 'm ago';
  if (ms < DAY) return Math.floor(ms / HOUR) + 'h ago';
  return Math.floor(ms / DAY) + 'd ago';
}

function describeDuration(ms) {
  if (ms < HOUR) return Math.round(ms / MINUTE) + 'm';
  if (ms < DAY) return Math.round(ms / HOUR) + 'h';
  return Math.round(ms / DAY) + 'd';
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function isStale(card) {
  return card.flags.some((f) => f.name === 'stale');
}

/* A value that is an ISO timestamp reads better as a plain date on the card.
   The full value is still shown in the drawer. */
function displayValue(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
    }
  }
  return value;
}

function cardNode(card) {
  const node = el('button', 'card');
  node.type = 'button';
  if (card.flags.length) node.classList.add('is-flagged');
  if (isStale(card)) node.classList.add('is-stale');

  const top = el('div', 'card-top');
  top.append(el('span', 'card-label', card.label));
  top.append(el('span', 'card-age', describeAge(card.ageMs)));
  node.append(top);

  const value = el('div', 'card-value');
  value.append(el('span', null, displayValue(card.value)));
  if (card.unit) value.append(el('span', 'unit', card.unit));
  node.append(value);

  node.append(el('div', 'card-key mono', card.key));

  const used = card.ttlMs > 0 ? Math.min(1, card.ageMs / card.ttlMs) : 1;
  const meter = el('div', 'meter');
  if (used >= 1) meter.classList.add('is-alert');
  else if (used >= 0.75) meter.classList.add('is-warn');
  const fill = el('span');
  fill.style.width = Math.round(used * 100) + '%';
  meter.append(fill);
  meter.title = 'ttl ' + describeDuration(card.ttlMs);
  node.append(meter);

  const chips = el('div', 'chips');
  for (const flag of card.flags) {
    const chip = el('span', 'chip', flag.name);
    if (flag.name === 'stale') chip.classList.add('is-stale');
    chip.title = flag.reason;
    chips.append(chip);
  }
  if (card.synthetic) chips.append(el('span', 'chip is-demo', 'demo data'));
  if (chips.childElementCount) node.append(chips);

  node.addEventListener('click', () => openDrawer(card));
  return node;
}

function sparkline(history) {
  const numeric = history
    .map((h) => (typeof h.value === 'number' ? h.value : Number(h.value)))
    .filter((n) => Number.isFinite(n));

  if (numeric.length < 2) {
    return el('p', 'card-key', 'Not enough numeric readings yet.');
  }

  const w = 380;
  const h = 72;
  const pad = 10;
  const min = Math.min(...numeric);
  const max = Math.max(...numeric);
  const span = max - min || 1;

  const points = numeric.map((n, i) => {
    const x = pad + (i / (numeric.length - 1)) * (w - pad * 2);
    const y = h - pad - ((n - min) / span) * (h - pad * 2);
    return [x, y];
  });

  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('class', 'spark');
  svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Recent readings from ' + min + ' to ' + max);

  const area = document.createElementNS(svgNs, 'path');
  area.setAttribute('d',
    'M' + points.map((p) => p[0] + ',' + p[1]).join(' L')
    + ' L' + points[points.length - 1][0] + ',' + (h - pad)
    + ' L' + points[0][0] + ',' + (h - pad) + ' Z');
  area.setAttribute('fill', 'var(--accent-soft)');
  svg.append(area);

  const line = document.createElementNS(svgNs, 'path');
  line.setAttribute('d', 'M' + points.map((p) => p[0] + ',' + p[1]).join(' L'));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'var(--accent)');
  line.setAttribute('stroke-width', '1.5');
  svg.append(line);

  const last = points[points.length - 1];
  const dot = document.createElementNS(svgNs, 'circle');
  dot.setAttribute('cx', String(last[0]));
  dot.setAttribute('cy', String(last[1]));
  dot.setAttribute('r', '3');
  dot.setAttribute('fill', 'var(--accent)');
  svg.append(dot);

  return svg;
}

function openDrawer(card) {
  drawer.querySelector('[data-drawer-title]').textContent = card.label;

  const facts = drawer.querySelector('[data-drawer-facts]');
  facts.replaceChildren();
  const rows = [
    ['Key', card.key],
    ['Value', String(card.value) + (card.unit ? ' ' + card.unit : '')],
    ['Read', new Date(card.at).toLocaleString() + ' (' + describeAge(card.ageMs) + ')'],
    ['TTL', describeDuration(card.ttlMs)],
    ['Fresh', card.fresh ? 'yes' : 'no'],
    ['Collector', card.collectorId],
    ['Synthetic', card.synthetic ? 'yes - demo data' : 'no'],
  ];
  for (const flag of card.flags) rows.push(['Flag: ' + flag.name, flag.reason]);
  if (card.note) rows.push(['Note', card.note]);

  for (const [term, def] of rows) {
    facts.append(el('dt', null, term));
    facts.append(el('dd', null, def));
  }

  const sparkWrap = drawer.querySelector('[data-drawer-spark]');
  sparkWrap.replaceChildren(sparkline(card.history || []));

  drawer.hidden = false;
}

function closeDrawer() {
  drawer.hidden = true;
}

function render() {
  const cards = view === 'attention'
    ? state.cards.filter((c) => c.flags.length > 0)
    : state.cards;

  grid.replaceChildren(...cards.map(cardNode));
  empty.hidden = cards.length > 0;
  if (cards.length === 0 && view === 'attention') {
    empty.textContent = 'Nothing needs attention.';
  } else if (cards.length === 0) {
    empty.textContent = 'Nothing here yet. Add a collector to collectors/ and run npm run once.';
  }

  document.querySelector('[data-count="cards"]').textContent = state.counts.cards;
  document.querySelector('[data-count="attention"]').textContent = state.counts.attention;
  stamp.textContent = 'updated ' + new Date(state.generatedAt).toLocaleTimeString();
}

async function fetchBoard() {
  const res = await fetch('/api/board');
  state = await res.json();
  render();
}

refreshBtn.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Refreshing';
  try {
    await fetch('/api/refresh', { method: 'POST' });
    await fetchBoard();
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Refresh';
  }
});

for (const button of document.querySelectorAll('.view')) {
  button.addEventListener('click', () => {
    view = button.dataset.view;
    for (const other of document.querySelectorAll('.view')) {
      const on = other === button;
      other.classList.toggle('is-on', on);
      other.setAttribute('aria-selected', String(on));
    }
    render();
  });
}

drawer.addEventListener('click', (event) => {
  if (event.target === drawer || event.target.closest('[data-drawer-close]')) closeDrawer();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !drawer.hidden) closeDrawer();
});

fetchBoard();
setInterval(fetchBoard, 30000);
