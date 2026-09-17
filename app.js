const STORAGE_KEY = 'budget_transactions';
const CURRENCY = 'CHF';
const LOCALE = 'de-CH';

const CATEGORIES = [
  { name: 'Ausgang', color: '#f28e2b' },
  { name: 'Verpflegung', color: '#59a14f' },
  { name: 'Kleidung', color: '#ff9da7' },
  { name: 'Hobbies', color: '#b07aa1' },
  { name: 'Friseur', color: '#86bcb6' },
  { name: 'Geschenke', color: '#d37295' },
  { name: 'Mobile Daten', color: '#4e79a7' },
  { name: 'El. Geräte', color: '#7c83fd' },
  { name: 'Ferien', color: '#76b7b2' },
  { name: 'Auto', color: '#9c755f' },
  { name: 'SBB', color: '#e15759' },
  { name: 'Cevi', color: '#06b6d4' },
  { name: 'Konto Übertragung', color: '#8891a3' },
  { name: 'Noch auszuwählen', color: '#ef4444' },
];

const FALLBACK_CATEGORY = 'Noch auszuwählen';

const CATEGORY_KEYWORDS = {
  'Konto Übertragung': ['übertrag', 'uebertrag'],
  'Verpflegung': ['lidl', 'migros', 'aldi', 'coop', 'denner', 'volg', 'spar', 'migrolino', 'mcdonald', 'restaurant', 'kebab', 'markthof', 'pronto'],
  'Auto': ['migrol', 'tamoil', 'shell', 'garage', 'tankstelle', 'parking', 'strassenverkehrsamt'],
  'SBB': ['sbb', 'postauto', 'vbz', 'zvv', 'tpg', 'bvb'],
  'Kleidung': ['zalando', 'h&m', 'c&a', 'zara', 'manor', 'nike', 'about you', 'takko'],
  'Hobbies': ['decathlon', 'kino', 'pathe', 'netflix', 'spotify', 'fitness', 'steam'],
  'Friseur': ['friseur', 'coiffeur', 'barber'],
  'Geschenke': ['geschenk', 'interflora', 'fleurop'],
  'Mobile Daten': ['swisscom', 'sunrise', 'salt', 'zimconnections', 'yallo', 'wingo'],
  'El. Geräte': ['fust', 'interdiscount', 'microspot', 'digitec', 'galaxus', 'mediamarkt', 'apple store'],
  'Ferien': ['booking.com', 'airbnb', 'hotel', 'swiss air', 'ryanair', 'easyjet'],
  'Cevi': ['cevi'],
};

const RULES_STORAGE_KEY = 'budget_learned_rules';

let learnedRules = loadLearnedRules();

function loadLearnedRules() {
  try { return JSON.parse(localStorage.getItem(RULES_STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function saveLearnedRules() {
  localStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(learnedRules));
}

function matchLearnedRule(text) {
  let best = null;
  for (const [kw, rule] of Object.entries(learnedRules)) {
    if (findWholeWordIndices(text, kw).length && (!best || kw.length > best.len)) {
      best = { category: rule.category, len: kw.length };
    }
  }
  return best ? best.category : null;
}

function guessCategory(description) {
  const text = (description || '').toLowerCase();
  const learned = matchLearnedRule(text);
  if (learned) return { category: learned, certain: true };

  let best = null;
  const matchedCategories = new Set();
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      if (text.includes(kw)) {
        matchedCategories.add(category);
        if (!best || kw.length > best.len) best = { category, len: kw.length };
      }
    }
  }
  if (!best) return { category: FALLBACK_CATEGORY, certain: false };
  return { category: best.category, certain: matchedCategories.size === 1 };
}

function monthStrOf(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function localIsoDate(date) {
  return `${monthStrOf(date)}-${String(date.getDate()).padStart(2, '0')}`;
}

let transactions = loadTransactions();
let currentMonth = monthStrOf(new Date());

function loadTransactions() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveTransactions() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(transactions));
}

function formatCurrency(amount) {
  return new Intl.NumberFormat(LOCALE, { style: 'currency', currency: CURRENCY }).format(amount);
}

function formatMonthLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(LOCALE, { month: 'long', year: 'numeric' });
}

function shiftMonth(monthStr, delta) {
  const [y, m] = monthStr.split('-').map(Number);
  return monthStrOf(new Date(y, m - 1 + delta, 1));
}

function formatCurrencyParts(amount) {
  const formatted = formatCurrency(amount);
  const idx = formatted.search(/[\d-]/);
  if (idx <= 0) return { currency: '', number: formatted.trim() };
  return { currency: formatted.slice(0, idx).trim(), number: formatted.slice(idx).trim() };
}

function getMonthTotal(monthStr) {
  return transactions
    .filter(t => t.date.slice(0, 7) === monthStr)
    .reduce((sum, t) => sum + t.amount, 0);
}

function getMonthDelta(monthStr) {
  const previousMonth = shiftMonth(monthStr, -1);
  const hasPreviousData = transactions.some(t => t.date.slice(0, 7) === previousMonth);
  if (!hasPreviousData) return null;
  const current = getMonthTotal(monthStr);
  const previousTotal = getMonthTotal(previousMonth);
  const diff = current - previousTotal;
  const pct = previousTotal > 0 ? (diff / previousTotal) * 100 : null;
  return { current, previousTotal, diff, pct, previousMonth };
}

function formatMonthShortLabel(monthStr, referenceMonthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  const sameYear = y === Number(referenceMonthStr.slice(0, 4));
  return new Date(y, m - 1, 1).toLocaleDateString(LOCALE, sameYear ? { month: 'long' } : { month: 'long', year: 'numeric' });
}

function getMonthTransactions() {
  return transactions
    .filter(t => t.date.slice(0, 7) === currentMonth)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function categoryColor(name) {
  const found = CATEGORIES.find(c => c.name === name);
  return found ? found.color : '#64748b';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function buildCategoryOptions(selected) {
  return CATEGORIES.map(c => `<option value="${c.name}" ${c.name === selected ? 'selected' : ''}>${c.name}</option>`).join('');
}

const CATEGORIZATION_LOG_KEY = 'budget_categorization_log';
const MAX_CATEGORIZATION_LOG = 200;

let categorizationLog = loadCategorizationLog();

function loadCategorizationLog() {
  try { return JSON.parse(localStorage.getItem(CATEGORIZATION_LOG_KEY)) || []; }
  catch { return []; }
}

function saveCategorizationLog() {
  localStorage.setItem(CATEGORIZATION_LOG_KEY, JSON.stringify(categorizationLog));
}

function logCategorization(t, fromCategory, toCategory) {
  categorizationLog.push({
    id: t.id,
    description: t.description,
    amount: t.amount,
    fromCategory,
    toCategory,
    timestamp: Date.now(),
  });
  if (categorizationLog.length > MAX_CATEGORIZATION_LOG) {
    categorizationLog = categorizationLog.slice(-MAX_CATEGORIZATION_LOG);
  }
  saveCategorizationLog();
}

function updateTransactionCategory(id, newCategory) {
  const t = transactions.find(x => x.id === id);
  if (!t) return;
  const fromCategory = t.category;
  const changed = fromCategory !== newCategory || t.uncertain !== false;
  t.category = newCategory;
  t.uncertain = false;
  if (changed) logCategorization(t, fromCategory, newCategory);
  saveTransactions();
  render();
}

const GOALS_STORAGE_KEY = 'budget_goals';
const GOAL_WARNING_RATIO = 0.8;
const GOAL_ICONS = { good: '✓', warning: '!', critical: '✕' };
const GOAL_LABELS = { good: 'im Rahmen', warning: 'fast erreicht', critical: 'überschritten' };

let goals = loadGoals();

function loadGoals() {
  try {
    const parsed = JSON.parse(localStorage.getItem(GOALS_STORAGE_KEY));
    if (!parsed || typeof parsed !== 'object') return { overall: null, categories: {} };
    return {
      overall: typeof parsed.overall === 'number' && parsed.overall > 0 ? parsed.overall : null,
      categories: (parsed.categories && typeof parsed.categories === 'object') ? parsed.categories : {},
    };
  } catch {
    return { overall: null, categories: {} };
  }
}

function saveGoals() {
  localStorage.setItem(GOALS_STORAGE_KEY, JSON.stringify(goals));
}

function setOverallGoal(amount) {
  goals.overall = (typeof amount === 'number' && amount > 0) ? amount : null;
  saveGoals();
}

function setCategoryGoal(name, amount) {
  if (typeof amount === 'number' && amount > 0) {
    goals.categories[name] = amount;
  } else {
    delete goals.categories[name];
  }
  saveGoals();
}

function goalStatus(spent, goal) {
  if (!goal || goal <= 0) return null;
  const pct = (spent / goal) * 100;
  const displayPct = Math.min(pct, 100);
  if (pct < GOAL_WARNING_RATIO * 100) return { spent, goal, pct, displayPct, level: 'good' };
  if (pct <= 100) return { spent, goal, pct, displayPct, level: 'warning' };
  return { spent, goal, pct, displayPct, level: 'critical' };
}

function render() {
  document.getElementById('currentMonthLabel').textContent = formatMonthLabel(currentMonth);

  const monthTx = getMonthTransactions();
  const total = monthTx.reduce((sum, t) => sum + t.amount, 0);
  const { currency, number } = formatCurrencyParts(total);
  document.getElementById('heroCurrency').textContent = currency;
  document.getElementById('heroValue').textContent = number;
  document.getElementById('txCount').textContent = monthTx.length;
  renderHeroDelta(currentMonth);

  const byCategory = {};
  monthTx.forEach(t => {
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
  });
  const sortedCategories = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  document.getElementById('topCategory').textContent = sortedCategories.length ? sortedCategories[0][0] : '–';

  const maxCategoryAmount = sortedCategories.length ? sortedCategories[0][1] : 0;
  const categoryListEl = document.getElementById('categoryList');
  categoryListEl.innerHTML = '';
  if (!sortedCategories.length) {
    categoryListEl.innerHTML = '<p class="empty-state">Noch keine Daten für diesen Monat.</p>';
  } else {
    sortedCategories.forEach(([name, amount]) => {
      const pct = maxCategoryAmount ? (amount / maxCategoryAmount) * 100 : 0;
      const row = document.createElement('div');
      row.className = 'category-row';
      row.innerHTML = `
        <div class="category-row-top">
          <span>${escapeHtml(name)}</span>
          <span>${formatCurrency(amount)}</span>
        </div>
        <div class="category-bar-track">
          <div class="category-bar-fill" style="width:${pct}%; background:${categoryColor(name)}"></div>
        </div>
      `;
      categoryListEl.appendChild(row);
    });
  }

  renderGoalsSection(total, byCategory);
  renderImportSourceInfo();
  renderHistoryList();
  renderReviewQueue();

  const txListEl = document.getElementById('transactionList');
  const emptyState = document.getElementById('emptyState');
  txListEl.innerHTML = '';
  emptyState.hidden = monthTx.length > 0;
  monthTx.forEach(t => {
    const item = document.createElement('div');
    item.className = 'transaction-item' + (t.uncertain ? ' needs-category' : '');
    item.innerHTML = `
      <span class="tx-dot" style="background:${categoryColor(t.category)}"></span>
      <div class="tx-info">
        <span class="tx-desc">${escapeHtml(t.description)}</span>
        <span class="tx-meta">${t.date}${t.uncertain ? ' · bitte prüfen' : ''}</span>
      </div>
      <select class="tx-category-select" data-id="${t.id}">${buildCategoryOptions(t.category)}</select>
      <span class="tx-amount">${formatCurrency(t.amount)}</span>
      <button class="tx-delete" data-id="${t.id}" aria-label="Löschen">✕</button>
    `;
    txListEl.appendChild(item);
  });
}

function renderHeroDelta(monthStr) {
  const delta = getMonthDelta(monthStr);
  const deltaEl = document.getElementById('heroDelta');
  const noDataEl = document.getElementById('heroNoData');
  if (!delta) {
    deltaEl.hidden = true;
    noDataEl.hidden = false;
    return;
  }
  noDataEl.hidden = true;

  const EPS = 0.005;
  const direction = delta.diff > EPS ? 'bad' : delta.diff < -EPS ? 'good' : 'flat';
  const icon = { bad: '▲', good: '▼', flat: '→' }[direction];
  const sign = delta.diff > EPS ? '+' : delta.diff < -EPS ? '−' : '';
  const pctText = delta.pct !== null ? ` (${sign}${Math.abs(Math.round(delta.pct))}%)` : '';

  deltaEl.className = `hero-delta is-${direction}`;
  document.getElementById('heroDeltaIcon').textContent = icon;
  document.getElementById('heroDeltaText').textContent =
    `${sign}${formatCurrency(Math.abs(delta.diff))}${pctText} vs. ${formatMonthShortLabel(delta.previousMonth, monthStr)}`;
  deltaEl.hidden = false;
}

function renderGoalsSection(total, byCategory) {
  const overallStatus = goals.overall != null ? goalStatus(total, goals.overall) : null;
  const overallRow = overallStatus ? { name: 'Gesamtbudget', ...overallStatus } : null;

  const categoryRows = Object.keys(goals.categories)
    .map(name => {
      const status = goalStatus(byCategory[name] || 0, goals.categories[name]);
      return status ? { name, ...status } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.pct - a.pct);

  const allRows = overallRow ? [overallRow, ...categoryRows] : categoryRows;

  const listEl = document.getElementById('goalList');
  const emptyEl = document.getElementById('goalsEmptyState');

  if (!allRows.length) {
    listEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  listEl.innerHTML = allRows.map(r => `
    <div class="goal-row status-${r.level}">
      <div class="goal-row-top">
        <span class="goal-name">${escapeHtml(r.name)}</span>
        <span class="goal-status-badge status-${r.level}">
          <span class="goal-status-icon">${GOAL_ICONS[r.level]}</span>${GOAL_LABELS[r.level]}
        </span>
      </div>
      <div class="goal-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"
           aria-valuenow="${Math.round(r.displayPct)}"
           aria-label="${escapeHtml(r.name)}: ${Math.round(r.pct)}% des Ziels, ${GOAL_LABELS[r.level]}">
        <div class="goal-fill status-fill-${r.level}" style="width:${r.displayPct}%"></div>
      </div>
      <div class="goal-numbers">
        <span>${formatCurrency(r.spent)} von ${formatCurrency(r.goal)}</span>
        <span>${Math.round(r.pct)}%</span>
      </div>
    </div>
  `).join('');
}

function getAllMonthsWithData() {
  const months = new Set(transactions.map(t => t.date.slice(0, 7)));
  months.add(currentMonth);
  return Array.from(months).sort().reverse();
}

function renderHistoryList() {
  const months = getAllMonthsWithData();
  const listEl = document.getElementById('historyList');
  const emptyEl = document.getElementById('historyEmptyState');

  const totals = months.map(m => ({ month: m, total: getMonthTotal(m) }));
  const maxTotal = Math.max(...totals.map(t => t.total), 0);

  if (!totals.length) {
    listEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  listEl.innerHTML = totals.map(({ month, total }) => {
    const pct = maxTotal ? (total / maxTotal) * 100 : 0;
    const isCurrent = month === currentMonth;
    return `
      <button type="button" class="history-row${isCurrent ? ' is-current' : ''}" data-month="${month}">
        <div class="history-row-top">
          <span class="history-month">${formatMonthLabel(month)}${isCurrent ? '<span class="history-current-tag">ausgewählt</span>' : ''}</span>
          <span>${formatCurrency(total)}</span>
        </div>
        <div class="history-bar-track">
          <div class="history-bar-fill" style="width:${pct}%"></div>
        </div>
      </button>
    `;
  }).join('');
}

function getReviewQueue() {
  return transactions
    .filter(t => t.uncertain)
    .sort((a, b) => b.date.localeCompare(a.date));
}

function renderReviewQueue() {
  const queue = getReviewQueue();
  const listEl = document.getElementById('reviewQueueList');
  const emptyEl = document.getElementById('reviewQueueEmptyState');
  const badge = document.getElementById('reviewTabBadge');

  badge.hidden = queue.length === 0;
  badge.textContent = queue.length;
  document.getElementById('startReviewSessionBtn').disabled = queue.length === 0;

  if (!queue.length) {
    listEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  listEl.innerHTML = queue.map(t => `
    <div class="review-row">
      <div class="tx-info">
        <span class="tx-desc">${escapeHtml(t.description)}</span>
        <span class="tx-meta">${t.date} · ${formatCurrency(t.amount)}</span>
      </div>
      <select class="tx-category-select" data-id="${t.id}">${buildCategoryOptions(t.category)}</select>
      <button class="tx-delete" data-id="${t.id}" aria-label="Löschen">✕</button>
    </div>
  `).join('');
}

const reviewSessionDialog = document.getElementById('reviewSessionDialog');
const reviewCard = document.getElementById('reviewCard');
let reviewSession = { ids: [], index: 0, history: [], redoStack: [] };
let cardDrag = null;

function currentReviewTx() {
  const id = reviewSession.ids[reviewSession.index];
  return transactions.find(t => t.id === id) || null;
}

function startReviewSession() {
  const queue = getReviewQueue();
  if (!queue.length) {
    showToast('Nichts zu prüfen.');
    return;
  }
  reviewSession = { ids: queue.map(t => t.id), index: 0, history: [], redoStack: [] };
  document.getElementById('reviewCardStack').hidden = false;
  document.getElementById('reviewSessionDone').hidden = true;
  document.getElementById('reviewChipGrid').hidden = false;
  renderReviewCard();
  reviewSessionDialog.showModal();
}

function updateReviewNavButtons() {
  document.getElementById('reviewUndoBtn').disabled = reviewSession.history.length === 0;
  document.getElementById('reviewRedoBtn').disabled = reviewSession.redoStack.length === 0;
}

function renderReviewCard() {
  updateReviewNavButtons();
  const t = currentReviewTx();
  if (!t) {
    if (reviewSession.index < reviewSession.ids.length) {
      reviewSession.index++;
      renderReviewCard();
    } else {
      finishReviewSession();
    }
    return;
  }
  document.getElementById('reviewSessionProgress').textContent =
    `${reviewSession.index + 1} / ${reviewSession.ids.length}`;
  document.getElementById('reviewCardDesc').textContent = t.description;
  document.getElementById('reviewCardMeta').textContent = `${t.date} · ${formatCurrency(t.amount)}`;
  const badge = document.getElementById('reviewCardCategory');
  badge.textContent = t.category;
  badge.style.background = categoryColor(t.category);

  document.getElementById('reviewChipGrid').innerHTML = CATEGORIES.map(c => `
    <button type="button" class="review-chip" data-category="${escapeHtml(c.name)}">
      <span class="review-chip-dot" style="background:${c.color}"></span>${escapeHtml(c.name)}
    </button>
  `).join('');

  resetCardPosition();
}

function advanceReviewSession() {
  reviewSession.index++;
  if (reviewSession.index >= reviewSession.ids.length) {
    finishReviewSession();
  } else {
    renderReviewCard();
  }
}

function finishReviewSession() {
  document.getElementById('reviewCardStack').hidden = true;
  document.getElementById('reviewChipGrid').hidden = true;
  document.getElementById('reviewSessionDone').hidden = false;
  updateReviewNavButtons();
}

function resetCardPosition() {
  reviewCard.style.pointerEvents = '';
  reviewCard.style.transition = 'transform .2s ease, opacity .2s ease';
  reviewCard.style.transform = '';
  reviewCard.style.opacity = '1';
  document.getElementById('reviewStampAccept').style.opacity = '0';
  document.getElementById('reviewStampSkip').style.opacity = '0';
  setTimeout(() => { reviewCard.style.transition = ''; }, 200);
}

function flyOutCard(direction, onDone) {
  reviewCard.style.transition = 'transform .25s ease, opacity .25s ease';
  reviewCard.style.transform = `translateX(${direction * 500}px) rotate(${direction * 18}deg)`;
  reviewCard.style.opacity = '0';
  setTimeout(() => {
    reviewCard.style.transition = '';
    reviewCard.style.transform = '';
    onDone();
  }, 220);
}

function setReviewInputsEnabled(enabled) {
  reviewCard.style.pointerEvents = enabled ? '' : 'none';
  document.getElementById('reviewChipGrid').querySelectorAll('.review-chip').forEach(btn => {
    btn.disabled = !enabled;
  });
  if (enabled) {
    updateReviewNavButtons();
  } else {
    document.getElementById('reviewUndoBtn').disabled = true;
    document.getElementById('reviewRedoBtn').disabled = true;
  }
}

function assignReviewCategory(category) {
  const t = currentReviewTx();
  if (!t) return;
  const fromCategory = t.category;
  const fromUncertain = t.uncertain;
  setReviewInputsEnabled(false);
  flyOutCard(1, () => {
    updateTransactionCategory(t.id, category);
    reviewSession.history.push({ id: t.id, type: 'assign', fromCategory, fromUncertain, toCategory: category });
    reviewSession.redoStack = [];
    advanceReviewSession();
  });
}

function skipReviewCard() {
  const t = currentReviewTx();
  if (!t) return;
  const fromCategory = t.category;
  const fromUncertain = t.uncertain;
  setReviewInputsEnabled(false);
  flyOutCard(-1, () => {
    reviewSession.history.push({ id: t.id, type: 'skip', fromCategory, fromUncertain, toCategory: null });
    reviewSession.redoStack = [];
    advanceReviewSession();
  });
}

function undoReviewAction() {
  if (!reviewSession.history.length) return;
  const entry = reviewSession.history.pop();
  if (entry.type === 'assign') {
    const t = transactions.find(x => x.id === entry.id);
    if (t) {
      t.category = entry.fromCategory;
      t.uncertain = entry.fromUncertain;
      saveTransactions();
      render();
    }
  }
  reviewSession.redoStack.push(entry);
  reviewSession.index = Math.max(0, reviewSession.index - 1);
  document.getElementById('reviewCardStack').hidden = false;
  document.getElementById('reviewChipGrid').hidden = false;
  document.getElementById('reviewSessionDone').hidden = true;
  renderReviewCard();
}

function redoReviewAction() {
  if (!reviewSession.redoStack.length) return;
  const entry = reviewSession.redoStack.pop();
  if (entry.type === 'assign') {
    const t = transactions.find(x => x.id === entry.id);
    if (t) {
      t.category = entry.toCategory;
      t.uncertain = false;
      saveTransactions();
      render();
    }
  }
  reviewSession.history.push(entry);
  reviewSession.index = Math.min(reviewSession.ids.length, reviewSession.index + 1);
  renderReviewCard();
}

document.getElementById('startReviewSessionBtn').addEventListener('click', startReviewSession);
document.getElementById('reviewSessionCloseBtn').addEventListener('click', () => reviewSessionDialog.close());
document.getElementById('reviewSessionDoneBtn').addEventListener('click', () => reviewSessionDialog.close());
document.getElementById('reviewUndoBtn').addEventListener('click', undoReviewAction);
document.getElementById('reviewRedoBtn').addEventListener('click', redoReviewAction);

document.getElementById('reviewChipGrid').addEventListener('click', (e) => {
  const chip = e.target.closest('.review-chip');
  if (!chip) return;
  assignReviewCategory(chip.dataset.category);
});

reviewCard.addEventListener('pointerdown', (e) => {
  if (!currentReviewTx()) return;
  cardDrag = { startX: e.clientX, dx: 0 };
  reviewCard.setPointerCapture(e.pointerId);
  reviewCard.classList.add('dragging');
});

reviewCard.addEventListener('pointermove', (e) => {
  if (!cardDrag) return;
  cardDrag.dx = e.clientX - cardDrag.startX;
  reviewCard.style.transform = `translateX(${cardDrag.dx}px) rotate(${cardDrag.dx / 20}deg)`;
  document.getElementById('reviewStampAccept').style.opacity = String(Math.max(0, Math.min(1, cardDrag.dx / 100)));
  document.getElementById('reviewStampSkip').style.opacity = String(Math.max(0, Math.min(1, -cardDrag.dx / 100)));
});

reviewCard.addEventListener('pointerup', () => {
  if (!cardDrag) return;
  const dx = cardDrag.dx;
  cardDrag = null;
  reviewCard.classList.remove('dragging');
  const t = currentReviewTx();
  if (dx > 100 && t) {
    assignReviewCategory(t.category);
  } else if (dx < -100) {
    skipReviewCard();
  } else {
    resetCardPosition();
  }
});

const categorizationLogDialog = document.getElementById('categorizationLogDialog');
const MAX_CATEGORIZATION_LOG_SHOWN = 100;

function formatLogTimestamp(ts) {
  const d = new Date(ts);
  return `${d.toLocaleDateString(LOCALE)}, ${d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' })}`;
}

function renderCategorizationLog() {
  const listEl = document.getElementById('categorizationLogList');
  const emptyEl = document.getElementById('categorizationLogEmptyState');
  const entries = categorizationLog.slice().reverse().slice(0, MAX_CATEGORIZATION_LOG_SHOWN);

  if (!entries.length) {
    listEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  listEl.innerHTML = entries.map(entry => {
    const changeText = entry.fromCategory === FALLBACK_CATEGORY
      ? `neu zugeordnet: ${escapeHtml(entry.toCategory)}`
      : `von ${escapeHtml(entry.fromCategory)} zu ${escapeHtml(entry.toCategory)}`;
    return `
      <div class="transaction-item">
        <span class="tx-dot" style="background:${categoryColor(entry.toCategory)}"></span>
        <div class="tx-info">
          <span class="tx-desc">${escapeHtml(entry.description)}</span>
          <span class="tx-meta">${changeText} · ${formatLogTimestamp(entry.timestamp)}</span>
        </div>
        <span class="tx-amount">${formatCurrency(entry.amount)}</span>
      </div>
    `;
  }).join('');
}

function openCategorizationLogDialog() {
  renderCategorizationLog();
  categorizationLogDialog.showModal();
}

document.getElementById('categorizationLogBtn').addEventListener('click', openCategorizationLogDialog);
document.getElementById('categorizationLogCloseBtn').addEventListener('click', () => categorizationLogDialog.close());
document.getElementById('categorizationLogClearBtn').addEventListener('click', () => {
  if (!categorizationLog.length) {
    showToast('Zuordnungsverlauf ist bereits leer.');
    return;
  }
  if (!confirm('Zuordnungsverlauf wirklich leeren? Das kann nicht rückgängig gemacht werden.')) return;
  categorizationLog = [];
  saveCategorizationLog();
  renderCategorizationLog();
  showToast('Zuordnungsverlauf geleert.');
});

function getFullYearMonthRange() {
  const years = Array.from(new Set(transactions.map(t => t.date.slice(0, 4)))).sort();
  const months = [];
  years.forEach(y => {
    for (let m = 1; m <= 12; m++) {
      months.push(`${y}-${String(m).padStart(2, '0')}`);
    }
  });
  return months;
}

function formatMonthColumnLabel(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(LOCALE, { month: 'short', year: 'numeric' });
}

const CHF_FMT = '#,##0.00" CHF";-#,##0.00" CHF";"-"';
const PCT_FMT = '0%';

function stampFormat(ws, cells, fmt) {
  cells.forEach(({ r, c }) => {
    const cell = ws[XLSX.utils.encode_cell({ r, c })];
    if (cell) cell.z = fmt;
  });
}

function setComputedCell(ws, r, c, formula, value, fmt) {
  const ref = XLSX.utils.encode_cell({ r, c });
  const cell = { t: 'n', v: value, z: fmt };
  if (formula) cell.f = formula;
  ws[ref] = cell;
}

function buildRawDataSheet() {
  const sorted = transactions.slice().sort((a, b) => a.date.localeCompare(b.date));
  const aoa = [
    ['DATUM', 'MONAT', 'BESCHREIBUNG', 'KATEGORIE', 'BETRAG (CHF)'],
    ...sorted.map(t => [t.date, t.date.slice(0, 7), t.description, t.category, t.amount]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 40 }, { wch: 18 }, { wch: 14 }];
  stampFormat(ws, sorted.map((_, i) => ({ r: i + 1, c: 4 })), CHF_FMT);
  return ws;
}

function buildMonthSheet(monthStr) {
  const monthTx = transactions.filter(t => t.date.slice(0, 7) === monthStr);

  const byCategory = {};
  monthTx.forEach(t => { byCategory[t.category] = (byCategory[t.category] || 0) + t.amount; });
  const categoryRows = CATEGORIES.filter(c => byCategory[c.name]);

  const aoa = [];
  const merges = [];

  aoa.push([formatMonthLabel(monthStr)]);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } });
  aoa.push([]);
  aoa.push(['KATEGORIE', 'BETRAG (CHF)']);

  const catRowEntries = [];
  categoryRows.forEach(c => {
    catRowEntries.push({ r: aoa.length, name: c.name, value: byCategory[c.name] });
    aoa.push([c.name, byCategory[c.name]]);
  });

  aoa.push([]);
  const gesamtRow = aoa.length;
  const gesamtValue = monthTx.reduce((s, t) => s + t.amount, 0);
  aoa.push(['GESAMT', gesamtValue]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 22 }, { wch: 15 }];
  ws['!merges'] = merges;

  catRowEntries.forEach(entry => {
    setComputedCell(
      ws, entry.r, 1,
      `SUMIFS(Rohdaten!$E:$E,Rohdaten!$B:$B,"${monthStr}",Rohdaten!$D:$D,"${entry.name}")`,
      entry.value, CHF_FMT
    );
  });

  if (catRowEntries.length) {
    const firstCatExcelRow = catRowEntries[0].r + 1;
    const lastCatExcelRow = catRowEntries[catRowEntries.length - 1].r + 1;
    setComputedCell(ws, gesamtRow, 1, `SUM(B${firstCatExcelRow}:B${lastCatExcelRow})`, gesamtValue, CHF_FMT);
  } else {
    setComputedCell(ws, gesamtRow, 1, null, 0, CHF_FMT);
  }

  return ws;
}

function buildOverviewSheet(orderedMonths) {
  const totalColIdx = 1 + orderedMonths.length;
  const pctColIdx = totalColIdx + 1;
  const totalCols = pctColIdx + 1;

  const categoryData = CATEGORIES.map(cat => {
    const monthValues = orderedMonths.map(m =>
      transactions.filter(t => t.category === cat.name && t.date.slice(0, 7) === m).reduce((s, t) => s + t.amount, 0)
    );
    const rowTotal = monthValues.reduce((s, v) => s + v, 0);
    return { name: cat.name, monthValues, rowTotal };
  });
  const grandTotal = categoryData.reduce((s, c) => s + c.rowTotal, 0);

  const aoa = [];
  const merges = [];

  aoa.push(['Jahresübersicht']);
  merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } });
  aoa.push([]);
  aoa.push(['KATEGORIE', ...orderedMonths.map(m => formatMonthColumnLabel(m).toUpperCase()), 'JÄHRLICHES TOTAL', '%']);

  const catRows = [];
  categoryData.forEach(cat => {
    catRows.push(aoa.length);
    const pct = grandTotal > 0 ? cat.rowTotal / grandTotal : 0;
    aoa.push([cat.name, ...cat.monthValues, cat.rowTotal, pct]);
  });

  aoa.push([]);
  const totalRowIdx = aoa.length;
  const monthTotals = orderedMonths.map(m => getMonthTotal(m));
  aoa.push(['TOTAL', ...monthTotals, grandTotal, grandTotal > 0 ? 1 : 0]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 20 }, ...orderedMonths.map(() => ({ wch: 13 })), { wch: 16 }, { wch: 8 }];
  ws['!merges'] = merges;

  const firstMonthColLetter = XLSX.utils.encode_col(1);
  const lastMonthColLetter = XLSX.utils.encode_col(orderedMonths.length);
  const totalColLetter = XLSX.utils.encode_col(totalColIdx);
  const totalRowExcel = totalRowIdx + 1;
  const firstCatRowExcel = catRows[0] + 1;
  const lastCatRowExcel = catRows[catRows.length - 1] + 1;

  categoryData.forEach((cat, i) => {
    const r = catRows[i];
    const excelRow = r + 1;
    cat.monthValues.forEach((value, ci) => {
      const m = orderedMonths[ci];
      setComputedCell(
        ws, r, 1 + ci,
        `SUMIFS(Rohdaten!$E:$E,Rohdaten!$B:$B,"${m}",Rohdaten!$D:$D,"${cat.name}")`,
        value, CHF_FMT
      );
    });
    setComputedCell(
      ws, r, totalColIdx,
      `SUM(${firstMonthColLetter}${excelRow}:${lastMonthColLetter}${excelRow})`,
      cat.rowTotal, CHF_FMT
    );
    const pct = grandTotal > 0 ? cat.rowTotal / grandTotal : 0;
    setComputedCell(
      ws, r, pctColIdx,
      `IFERROR(${totalColLetter}${excelRow}/${totalColLetter}${totalRowExcel},0)`,
      pct, PCT_FMT
    );
  });

  orderedMonths.forEach((m, ci) => {
    const colLetter = XLSX.utils.encode_col(1 + ci);
    setComputedCell(
      ws, totalRowIdx, 1 + ci,
      `SUM(${colLetter}${firstCatRowExcel}:${colLetter}${lastCatRowExcel})`,
      monthTotals[ci], CHF_FMT
    );
  });
  setComputedCell(
    ws, totalRowIdx, totalColIdx,
    `SUM(${totalColLetter}${firstCatRowExcel}:${totalColLetter}${lastCatRowExcel})`,
    grandTotal, CHF_FMT
  );
  setComputedCell(ws, totalRowIdx, pctColIdx, null, grandTotal > 0 ? 1 : 0, PCT_FMT);

  return ws;
}

function exportYearlyExcel() {
  const orderedMonths = getFullYearMonthRange();
  if (!orderedMonths.length) {
    showToast('Keine Daten zum Exportieren vorhanden.');
    return;
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildOverviewSheet(orderedMonths), 'Jahresübersicht');
  orderedMonths.forEach(m => {
    XLSX.utils.book_append_sheet(wb, buildMonthSheet(m), formatMonthLabel(m).slice(0, 31));
  });
  XLSX.utils.book_append_sheet(wb, buildRawDataSheet(), 'Rohdaten');

  const rawDataIdx = wb.SheetNames.indexOf('Rohdaten');
  wb.Workbook = wb.Workbook || {};
  wb.Workbook.Sheets = wb.Workbook.Sheets || [];
  wb.Workbook.Sheets[rawDataIdx] = { Hidden: 1 };

  XLSX.writeFile(wb, `Budget-Export-${localIsoDate(new Date())}.xlsx`);
}

document.getElementById('exportExcelBtn').addEventListener('click', exportYearlyExcel);

document.getElementById('historyList').addEventListener('click', (e) => {
  const btn = e.target.closest('.history-row');
  if (!btn) return;
  currentMonth = btn.dataset.month;
  setActiveTab('panel-overview');
  render();
});

document.getElementById('reviewQueueList').addEventListener('change', (e) => {
  const select = e.target.closest('.tx-category-select');
  if (!select) return;
  updateTransactionCategory(select.dataset.id, select.value);
});

document.getElementById('reviewQueueList').addEventListener('click', (e) => {
  const btn = e.target.closest('.tx-delete');
  if (!btn) return;
  transactions = transactions.filter(t => t.id !== btn.dataset.id);
  saveTransactions();
  render();
});

document.getElementById('prevMonth').addEventListener('click', () => {
  currentMonth = shiftMonth(currentMonth, -1);
  render();
});
document.getElementById('nextMonth').addEventListener('click', () => {
  currentMonth = shiftMonth(currentMonth, 1);
  render();
});

const categorySelect = document.getElementById('fCategory');
CATEGORIES.forEach(c => {
  const opt = document.createElement('option');
  opt.value = c.name;
  opt.textContent = c.name;
  categorySelect.appendChild(opt);
});

const dialog = document.getElementById('addDialog');
document.getElementById('addBtn').addEventListener('click', () => {
  document.getElementById('fDate').value = localIsoDate(new Date());
  document.getElementById('fDesc').value = '';
  document.getElementById('fAmount').value = '';
  dialog.showModal();
});
document.getElementById('cancelBtn').addEventListener('click', () => dialog.close());

document.getElementById('addForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const date = document.getElementById('fDate').value;
  const description = document.getElementById('fDesc').value.trim();
  const amount = parseFloat(document.getElementById('fAmount').value);
  const category = categorySelect.value;
  if (!date || !description || isNaN(amount)) return;

  transactions.push({ id: Date.now().toString(), date, description, amount, category });
  saveTransactions();
  currentMonth = date.slice(0, 7);
  dialog.close();
  render();
});

const goalsDialog = document.getElementById('goalsDialog');

function openGoalsDialog() {
  document.getElementById('goalOverall').value = goals.overall ?? '';
  document.getElementById('goalCategoryFields').innerHTML = CATEGORIES.map(c => `
    <label class="goal-field">
      <span class="goal-field-dot" style="background:${c.color}"></span>
      ${escapeHtml(c.name)}
      <input type="number" min="0" step="0.05" placeholder="kein Ziel"
             data-goal-category="${escapeHtml(c.name)}"
             value="${goals.categories[c.name] ?? ''}">
    </label>
  `).join('');
  goalsDialog.showModal();
}

document.getElementById('goalsSettingsBtn').addEventListener('click', openGoalsDialog);
document.getElementById('goalsEmptyBtn').addEventListener('click', openGoalsDialog);
document.getElementById('goalsCancelBtn').addEventListener('click', () => goalsDialog.close());

document.getElementById('goalsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const overallRaw = parseFloat(document.getElementById('goalOverall').value);
  setOverallGoal(isNaN(overallRaw) ? null : overallRaw);

  document.querySelectorAll('#goalCategoryFields [data-goal-category]').forEach(input => {
    const raw = parseFloat(input.value);
    setCategoryGoal(input.dataset.goalCategory, isNaN(raw) ? null : raw);
  });

  goalsDialog.close();
  render();
});

document.getElementById('transactionList').addEventListener('click', (e) => {
  const btn = e.target.closest('.tx-delete');
  if (!btn) return;
  transactions = transactions.filter(t => t.id !== btn.dataset.id);
  saveTransactions();
  render();
});

document.getElementById('clearMonthBtn').addEventListener('click', () => {
  const monthTx = getMonthTransactions();
  if (!monthTx.length) {
    showToast('Keine Ausgaben in diesem Monat.');
    return;
  }
  const label = formatMonthLabel(currentMonth);
  if (!confirm(`${monthTx.length} Ausgabe(n) aus ${label} wirklich löschen? Das kann nicht rückgängig gemacht werden.`)) return;

  const idsToRemove = new Set(monthTx.map(t => t.id));
  transactions = transactions.filter(t => !idsToRemove.has(t.id));
  saveTransactions();
  render();
  showToast(`${monthTx.length} Ausgabe(n) aus ${label} gelöscht.`);
});

document.getElementById('transactionList').addEventListener('change', (e) => {
  const select = e.target.closest('.tx-category-select');
  if (!select) return;
  updateTransactionCategory(select.dataset.id, select.value);
});

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, 4000);
}

function toIsoDate(value) {
  if (value instanceof Date && !isNaN(value)) {
    const y = value.getFullYear(), m = value.getMonth() + 1, d = value.getDate();
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed) return `${parsed.y}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
  }
  if (typeof value === 'string') {
    const s = value.trim();
    let m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    if (m) {
      let [, d, mo, y] = m;
      if (y.length === 2) y = '20' + y;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      const [, y, mo, d] = m;
      return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
    const d = new Date(s);
    if (!isNaN(d)) return toIsoDate(d);
  }
  return null;
}

function parseAmount(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value
      .replace(/['’\s]/g, '')
      .replace(/CHF|Fr\.?|EUR|€/gi, '')
      .replace(',', '.');
    const n = parseFloat(cleaned);
    return isNaN(n) ? null : n;
  }
  return null;
}

const DATE_KEYWORDS = ['datum', 'buchungsdatum', 'valuta', 'date'];
const DESC_KEYWORDS = ['text', 'buchungstext', 'beschreibung', 'avisierungstext', 'zahlungszweck', 'description', 'details'];
const AMOUNT_KEYWORDS = ['betrag', 'amount', 'belastung'];

function findColumn(headers, keywords) {
  const lower = headers.map(h => String(h || '').toLowerCase());
  for (const kw of keywords) {
    const idx = lower.findIndex(h => h.includes(kw));
    if (idx !== -1) return idx;
  }
  return -1;
}

const IMPORT_LOG_STORAGE_KEY = 'budget_import_log';
let importLog = loadImportLog();
let currentImportFileName = null;

function loadImportLog() {
  try { return JSON.parse(localStorage.getItem(IMPORT_LOG_STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function saveImportLog() {
  localStorage.setItem(IMPORT_LOG_STORAGE_KEY, JSON.stringify(importLog));
}

function renderImportSourceInfo() {
  const el = document.getElementById('importSourceInfo');
  const entry = importLog[currentMonth];
  if (!entry) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = `Importiert aus: ${entry.filename}`;
}

let importSheetRows = [];
let importHeaderRowIndex = 0;

function findHeaderRow(rows) {
  const allKeywords = [...DATE_KEYWORDS, ...DESC_KEYWORDS, ...AMOUNT_KEYWORDS];
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const rowText = rows[i].map(c => String(c || '').toLowerCase());
    if (rowText.some(cell => allKeywords.some(kw => cell.includes(kw)))) return i;
  }
  return 0;
}

let currentImportHeaders = [];

function suggestSignForHeader(headerName) {
  const h = (headerName || '').toLowerCase();
  if (h.includes('belastung') || h.includes('debit')) return 'all';
  return 'negative';
}

function updateSignSuggestion() {
  const amountIdx = Number(document.getElementById('mapAmount').value);
  document.getElementById('mapSign').value = suggestSignForHeader(currentImportHeaders[amountIdx]);
}

function populateMappingSelects(headers) {
  currentImportHeaders = headers;
  const dateIdx = findColumn(headers, DATE_KEYWORDS);
  const descIdx = findColumn(headers, DESC_KEYWORDS);
  const amountIdx = findColumn(headers, AMOUNT_KEYWORDS);

  [['mapDate', dateIdx], ['mapDesc', descIdx], ['mapAmount', amountIdx]].forEach(([selectId, defaultIdx]) => {
    const select = document.getElementById(selectId);
    select.innerHTML = '';
    headers.forEach((h, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = h || `Spalte ${idx + 1}`;
      select.appendChild(opt);
    });
    if (defaultIdx !== -1) select.value = defaultIdx;
  });
  updateSignSuggestion();
}

function buildImportRows() {
  const headers = importSheetRows[importHeaderRowIndex] || [];
  const dataRows = importSheetRows.slice(importHeaderRowIndex + 1).filter(r => r.some(c => c !== '' && c != null));
  const dateIdx = Number(document.getElementById('mapDate').value);
  const descIdx = Number(document.getElementById('mapDesc').value);
  const amountIdx = Number(document.getElementById('mapAmount').value);
  const sign = document.getElementById('mapSign').value;

  return dataRows.map(row => {
    const date = toIsoDate(row[dateIdx]);
    const description = String(row[descIdx] ?? '').trim();
    const rawAmount = parseAmount(row[amountIdx]);
    let amount = null;
    if (rawAmount !== null) {
      if (sign === 'negative' && rawAmount < 0) amount = Math.abs(rawAmount);
      else if (sign === 'positive' && rawAmount > 0) amount = rawAmount;
      else if (sign === 'all') amount = Math.abs(rawAmount);
    }
    const valid = date && description && amount !== null && amount > 0;
    const guess = valid ? guessCategory(description) : null;
    return {
      date, description, amount: valid ? Math.round(amount * 100) / 100 : null,
      category: guess ? guess.category : null,
      uncertain: guess ? !guess.certain : false,
      valid,
    };
  });
}

function renderImportPreview() {
  const rows = buildImportRows();
  const validRows = rows.filter(r => r.valid);
  const summary = document.getElementById('importSummary');
  const confirmBtn = document.getElementById('importConfirmBtn');

  if (!validRows.length) {
    summary.textContent = `0 von ${rows.length} Zeilen erkannt. Prüfe die Spalten-Zuordnung und Vorzeichen-Logik oben.`;
    summary.classList.add('import-summary-warning');
    confirmBtn.disabled = true;
  } else {
    summary.textContent = `${validRows.length} von ${rows.length} Zeilen werden als Ausgabe erkannt.`;
    summary.classList.remove('import-summary-warning');
    confirmBtn.disabled = false;
  }

  const body = document.getElementById('importPreviewBody');
  body.innerHTML = '';
  rows.slice(0, 10).forEach(r => {
    const tr = document.createElement('tr');
    if (!r.valid) tr.style.opacity = '0.4';
    tr.innerHTML = `
      <td>${r.date || '–'}</td>
      <td>${escapeHtml(r.description || '–')}</td>
      <td>${r.amount !== null ? formatCurrency(r.amount) : '–'}</td>
      <td>${r.category || '–'}${r.uncertain ? ' ⚠' : ''}</td>
    `;
    body.appendChild(tr);
  });
}

['mapDate', 'mapDesc', 'mapSign'].forEach(id => {
  document.getElementById(id).addEventListener('change', renderImportPreview);
});
document.getElementById('mapAmount').addEventListener('change', () => {
  updateSignSuggestion();
  renderImportPreview();
});

const importDialog = document.getElementById('importDialog');
const fileInput = document.getElementById('fileInput');

document.getElementById('importBtn').addEventListener('click', () => fileInput.click());

function detectCsvDelimiter(line) {
  const candidates = [';', ',', '\t'];
  const counts = candidates.map(d => (line.split(d).length - 1));
  const best = counts.indexOf(Math.max(...counts));
  return counts[best] > 0 ? candidates[best] : ',';
}

function splitCsvLine(line, delimiter) {
  const result = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      result.push(cur.trim());
      cur = '';
    } else {
      cur += ch;
    }
  }
  result.push(cur.trim());
  return result;
}

function parseCsvText(text) {
  const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim().length > 0);
  if (!lines.length) return [];
  const delimiter = detectCsvDelimiter(lines[0]);
  return lines.map(line => splitCsvLine(line, delimiter));
}

function handleParsedRows(rows) {
  if (!rows.length) {
    showToast('Datei enthält keine Daten.');
    return;
  }
  importSheetRows = rows;
  importHeaderRowIndex = findHeaderRow(importSheetRows);
  populateMappingSelects(importSheetRows[importHeaderRowIndex] || []);
  renderImportPreview();
  importDialog.showModal();
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  currentImportFileName = file.name;
  const isCsv = /\.csv$/i.test(file.name);
  const reader = new FileReader();

  reader.onerror = () => showToast('Datei konnte nicht gelesen werden.');

  reader.onload = (e) => {
    try {
      if (isCsv) {
        handleParsedRows(parseCsvText(e.target.result));
      } else {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        if (!workbook.SheetNames.length) {
          showToast('Keine Tabelle in der Datei gefunden.');
          return;
        }
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        handleParsedRows(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' }));
      }
    } catch (err) {
      console.error('Import-Fehler:', err);
      showToast('Datei konnte nicht gelesen werden. Ist es eine gültige Excel/CSV-Datei?');
    }
  };

  if (isCsv) reader.readAsText(file, 'UTF-8');
  else reader.readAsArrayBuffer(file);
  fileInput.value = '';
});

document.getElementById('importCancelBtn').addEventListener('click', () => importDialog.close());

document.getElementById('importConfirmBtn').addEventListener('click', () => {
  const rows = buildImportRows().filter(r => r.valid);
  const sessionCounts = new Map();
  const newUncertainIds = [];
  let added = 0, skipped = 0;

  rows.forEach(r => {
    const keyBase = `${r.date}|${r.description}|${r.amount.toFixed(2)}`;
    const localIndex = sessionCounts.get(keyBase) || 0;
    sessionCounts.set(keyBase, localIndex + 1);
    const id = `${keyBase}#${localIndex}`;

    if (transactions.some(t => t.id === id)) {
      skipped++;
      return;
    }
    transactions.push({ id, date: r.date, description: r.description, amount: r.amount, category: r.category, uncertain: r.uncertain });
    if (r.uncertain) newUncertainIds.push(id);
    added++;
  });

  saveTransactions();

  if (currentImportFileName) {
    const monthsTouched = new Set(rows.map(r => r.date.slice(0, 7)));
    monthsTouched.forEach(m => {
      importLog[m] = { filename: currentImportFileName, importedAt: Date.now() };
    });
    saveImportLog();
  }

  importDialog.close();
  if (rows.length) currentMonth = rows[0].date.slice(0, 7);
  render();
  showToast(`${added} Ausgabe(n) importiert, ${skipped} bereits vorhanden.`);
  if (newUncertainIds.length) openReviewDialog(newUncertainIds);
});

const reviewDialog = document.getElementById('reviewDialog');

function openReviewDialog(ids) {
  const list = document.getElementById('reviewList');
  list.innerHTML = '';
  ids.forEach(id => {
    const t = transactions.find(x => x.id === id);
    if (!t) return;
    const row = document.createElement('div');
    row.className = 'review-row';
    row.innerHTML = `
      <div class="tx-info">
        <span class="tx-desc">${escapeHtml(t.description)}</span>
        <span class="tx-meta">${t.date} · ${formatCurrency(t.amount)}</span>
      </div>
      <select class="tx-category-select" data-id="${t.id}">${buildCategoryOptions(t.category)}</select>
    `;
    list.appendChild(row);
  });
  document.getElementById('reviewCount').textContent = ids.length;
  reviewDialog.showModal();
}

document.getElementById('reviewList').addEventListener('change', (e) => {
  const select = e.target.closest('.tx-category-select');
  if (!select) return;
  updateTransactionCategory(select.dataset.id, select.value);
});

document.getElementById('reviewDoneBtn').addEventListener('click', () => reviewDialog.close());

const CHAT_STORAGE_KEY = 'budget_teach_chat';
const MIN_KEYWORD_LEN = 3;
const MAX_KEYWORD_WORDS = 4;
const MAX_CHAT_HISTORY = 40;

const TEACH_CONNECTORS = [
  'ist', 'sind', 'war', 'waren', 'gehört', 'gehoert', 'gehören', 'gehoeren', 'gehörte',
  'zählt', 'zaehlt', 'zählen', 'zaehlen', 'wenn', 'vorkommt', 'kommt', 'vor', 'dann',
  'enthält', 'enthaelt', 'enthalten', 'heisst', 'heißt', 'kategorie', 'kategorien',
  'als', 'zu', 'in', 'im', 'ein', 'eine', 'einer', 'der', 'die', 'das', 'für', 'fuer',
  'bei', 'von', 'nach', 'soll', 'sollte', 'sollten', 'bin', 'sicher', 'ordne',
  'zuordnen', 'zuordne', 'doch', 'auch', 'immer', 'bitte', 'und', 'oder',
];

const TEACH_STOPWORDS = [
  'geld', 'gesendet', 'senden', 'sendung', 'überweisung', 'ueberweisung', 'bezahlt',
  'bezahlung', 'zahlung', 'gezahlt', 'zahlen', 'einkauf', 'einkaufen', 'eingekauft',
  'gekauft', 'kauf', 'kaufen', 'rechnung', 'abbuchung', 'lastschrift', 'twint',
  'karte', 'kartenzahlung', 'kartenbelastung', 'transaktion', 'transaktionen', 'betrag', 'ausgabe',
  'ausgaben', 'online', 'shop', 'laden', 'geschäft', 'geschaeft', 'store', 'automat',
  'bank', 'konto', 'regel', 'regeln', 'danke', 'hallo', 'ok', 'okay', 'ja', 'nein',
  'gut', 'super', 'warenbezug', 'dienstleistungen', 'zahlungsauftrag', 'zahlungseingang',
  'rückgutschrift', 'rueckgutschrift', 'e-banking', 'ebanking', 'auftrag',
];

let teachChatHistory = loadTeachChat();

function loadTeachChat() {
  try { return JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY)) || []; }
  catch { return []; }
}

function saveTeachChat() {
  localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(teachChatHistory));
}

function isWordChar(ch) {
  return !!ch && /[A-Za-zÀ-ÖØ-öø-ÿ0-9]/.test(ch);
}

function findWholeWordIndices(haystackLower, needleLower) {
  const indices = [];
  let from = 0;
  while (true) {
    const idx = haystackLower.indexOf(needleLower, from);
    if (idx === -1) break;
    const before = idx > 0 ? haystackLower[idx - 1] : '';
    const after = haystackLower[idx + needleLower.length] || '';
    if (!isWordChar(before) && !isWordChar(after)) indices.push(idx);
    from = idx + 1;
  }
  return indices;
}

function asciiUmlauts(s) {
  return s.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

function categoryNameVariants(name) {
  const lower = name.toLowerCase();
  const variants = new Set([lower, asciiUmlauts(lower)]);
  if (lower.includes('.')) {
    const noPeriod = lower.replace(/\.\s*/g, ' ').replace(/\s+/g, ' ').trim();
    variants.add(noPeriod);
    variants.add(asciiUmlauts(noPeriod));
  }
  return Array.from(variants);
}

function findCategoryInText(text) {
  const lower = text.toLowerCase();
  let best = null;
  CATEGORIES.forEach(cat => {
    categoryNameVariants(cat.name).forEach(needle => {
      findWholeWordIndices(lower, needle).forEach(idx => {
        if (!best || idx >= best.index) best = { category: cat.name, index: idx, length: needle.length };
      });
    });
  });
  return best;
}

function stripWholeWords(text, wordList) {
  let result = text;
  wordList.forEach(word => {
    const indices = findWholeWordIndices(result.toLowerCase(), word.toLowerCase());
    for (let i = indices.length - 1; i >= 0; i--) {
      const idx = indices[i];
      result = result.slice(0, idx) + ' ' + result.slice(idx + word.length);
    }
  });
  return result;
}

function extractKeywordCandidate(remainder) {
  let text = stripWholeWords(remainder, TEACH_CONNECTORS);
  text = text.replace(/["'.,;:!?()\-–>=]/g, ' ');
  let tokens = text.split(/\s+/).filter(Boolean);
  tokens = tokens.filter(tok => !TEACH_STOPWORDS.includes(tok.toLowerCase()));
  if (tokens.length === 0) return '';
  if (tokens.length > MAX_KEYWORD_WORDS) return null;
  const joined = tokens.join(' ');
  if (joined.length < MIN_KEYWORD_LEN) return '';
  return joined;
}

function parseTeachInput(raw) {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { type: 'empty' };

  const forgetMatch = trimmed.match(/^(?:vergiss|vergesse|entferne|lösche|loesche|löschen)\b(.*)$/i);
  if (forgetMatch) {
    const rest = forgetMatch[1].trim();
    if (!rest) return { type: 'forget_missing' };
    const candidate = extractKeywordCandidate(rest);
    if (!candidate) return { type: 'forget_missing' };
    return { type: 'forget', keyword: candidate.toLowerCase(), label: candidate };
  }

  const sepMatch = trimmed.match(/^(.+?)\s*(?:=>|->|→|=|:)\s*(.+)$/);
  if (sepMatch) {
    const rightSide = sepMatch[2].trim().toLowerCase();
    const matchedCategory = CATEGORIES.find(c => categoryNameVariants(c.name).includes(rightSide));
    if (matchedCategory) {
      if (matchedCategory.name === FALLBACK_CATEGORY) return { type: 'fallback_target' };
      const candidate = extractKeywordCandidate(sepMatch[1]);
      if (candidate === null) return { type: 'too_long' };
      if (candidate === '') return { type: 'too_vague', category: matchedCategory.name };
      return { type: 'learn', keyword: candidate.toLowerCase(), label: candidate, category: matchedCategory.name };
    }
  }

  const found = findCategoryInText(trimmed);
  if (!found) return { type: 'unrecognized' };
  if (found.category === FALLBACK_CATEGORY) return { type: 'fallback_target' };

  const remainder = trimmed.slice(0, found.index) + ' ' + trimmed.slice(found.index + found.length);
  const candidate = extractKeywordCandidate(remainder);
  if (candidate === null) return { type: 'too_long' };
  if (candidate === '') return { type: 'too_vague', category: found.category };
  return { type: 'learn', keyword: candidate.toLowerCase(), label: candidate, category: found.category };
}

function teachRule(keyword, category, label) {
  const existing = learnedRules[keyword];
  learnedRules[keyword] = { category, label, updatedAt: Date.now() };
  saveLearnedRules();
  return { isNew: !existing, previousCategory: existing ? existing.category : null };
}

function forgetRule(keyword) {
  if (!(keyword in learnedRules)) return false;
  delete learnedRules[keyword];
  saveLearnedRules();
  return true;
}

function applyRuleRetroactively(keyword, category) {
  let count = 0;
  transactions.forEach(t => {
    if (t.uncertain && findWholeWordIndices(t.description.toLowerCase(), keyword).length) {
      t.category = category;
      t.uncertain = false;
      count++;
    }
  });
  if (count > 0) { saveTransactions(); render(); }
  return count;
}

function handleTeachInput(raw) {
  const result = parseTeachInput(raw);
  switch (result.type) {
    case 'empty':
      return 'Sag mir kurz, welcher Händler zu welcher Kategorie gehört, z. B. „Aldi ist Verpflegung“.';
    case 'unrecognized':
      return `Ich konnte keine Kategorie erkennen. Verfügbare Kategorien: ${CATEGORIES.map(c => c.name).join(', ')}.`;
    case 'too_vague':
      return `Das ist mir zu allgemein für eine Regel${result.category ? ` (${result.category})` : ''}. Nenne einen konkreten Händlernamen, z. B. „Aldi ist ${result.category || 'Verpflegung'}“.`;
    case 'too_long':
      return 'Das habe ich nicht klar verstanden. Bitte kurz und konkret, z. B. „Aldi ist Verpflegung“.';
    case 'fallback_target':
      return `„${FALLBACK_CATEGORY}“ ist nur der Platzhalter für unklare Ausgaben — dafür kann ich keine feste Regel lernen. Wähle eine echte Kategorie, z. B. „Aldi ist Verpflegung“.`;
    case 'forget_missing':
      return 'Für welchen Händler soll ich die Regel vergessen? Z. B. „vergiss Aldi“.';
    case 'forget': {
      const existed = forgetRule(result.keyword);
      return existed
        ? `Ok, Regel für „${result.label}“ vergessen. Bereits zugeordnete Ausgaben bleiben unverändert.`
        : `Für „${result.label}“ hatte ich noch keine eigene Regel gespeichert.`;
    }
    case 'learn': {
      const { isNew, previousCategory } = teachRule(result.keyword, result.category, result.label);
      const updated = applyRuleRetroactively(result.keyword, result.category);
      const note = updated > 0 ? ` ${updated} bestehende, unsichere Ausgabe(n) wurden entsprechend aktualisiert.` : '';
      if (isNew) return `Gelernt: „${result.label}“ → ${result.category}.${note}`;
      if (previousCategory === result.category) return `Diese Regel war schon so gespeichert: „${result.label}“ → ${result.category}.${note}`;
      return `Regel aktualisiert: „${result.label}“ gehört jetzt zu ${result.category} (vorher: ${previousCategory}).${note}`;
    }
    default:
      return 'Das habe ich nicht verstanden.';
  }
}

function appendChatMessage(role, text) {
  teachChatHistory.push({ role, text, ts: Date.now() });
  if (teachChatHistory.length > MAX_CHAT_HISTORY) teachChatHistory = teachChatHistory.slice(-MAX_CHAT_HISTORY);
  saveTeachChat();
  const log = document.getElementById('teachChatLog');
  const bubble = document.createElement('div');
  bubble.className = `teach-bubble teach-bubble-${role}`;
  bubble.innerHTML = `<span class="teach-bubble-text">${escapeHtml(text)}</span>`;
  log.appendChild(bubble);
  log.scrollTop = log.scrollHeight;
}

function renderTeachChatLogFromHistory() {
  const log = document.getElementById('teachChatLog');
  log.innerHTML = teachChatHistory.map(m => `
    <div class="teach-bubble teach-bubble-${m.role}"><span class="teach-bubble-text">${escapeHtml(m.text)}</span></div>
  `).join('');
  log.scrollTop = log.scrollHeight;
}

function renderTeachRulesList() {
  const list = document.getElementById('teachRulesList');
  const entries = Object.entries(learnedRules).sort((a, b) => b[1].updatedAt - a[1].updatedAt);
  document.getElementById('teachRuleCount').textContent = entries.length;
  list.innerHTML = entries.length ? entries.map(([kw, rule]) => `
    <span class="teach-rule-chip">
      <span class="teach-rule-dot" style="background:${categoryColor(rule.category)}"></span>
      <span class="teach-rule-kw">${escapeHtml(rule.label || kw)}</span> → <span class="teach-rule-cat">${escapeHtml(rule.category)}</span>
      <button type="button" class="teach-rule-remove" data-keyword="${escapeHtml(kw)}" aria-label="Regel für ${escapeHtml(kw)} löschen">✕</button>
    </span>
  `).join('') : '<p class="empty-state">Noch keine eigenen Regeln gelernt.</p>';
}

const TEACH_WELCOME_MESSAGE = 'Hallo! Ich bin kein echter KI-Chat, sondern ein einfacher Lern-Assistent: Ich merke mir Regeln wie „Aldi ist Verpflegung“ und wende sie danach automatisch an. Schreib mir einfach, was zu welcher Kategorie gehört.';

if (!teachChatHistory.length) appendChatMessage('bot', TEACH_WELCOME_MESSAGE);
else renderTeachChatLogFromHistory();
renderTeachRulesList();

document.getElementById('teachForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('teachInput');
  const val = input.value.trim();
  if (!val) return;
  appendChatMessage('user', val);
  appendChatMessage('bot', handleTeachInput(val));
  input.value = '';
  renderTeachRulesList();
});

document.getElementById('teachRulesList').addEventListener('click', (e) => {
  const btn = e.target.closest('.teach-rule-remove');
  if (!btn) return;
  forgetRule(btn.dataset.keyword);
  renderTeachRulesList();
  appendChatMessage('bot', `Regel für „${btn.dataset.keyword}“ gelöscht.`);
});

function exportBackup() {
  const data = {
    version: 1,
    exportedAt: localIsoDate(new Date()),
    transactions,
    goals,
    learnedRules,
    importLog,
    teachChatHistory,
    categorizationLog,
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `budget-backup-${localIsoDate(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('Backup heruntergeladen.');
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    let data;
    try {
      data = JSON.parse(e.target.result);
    } catch {
      showToast('Backup-Datei ist kein gültiges JSON.');
      return;
    }
    if (!data || !Array.isArray(data.transactions)) {
      showToast('Das ist keine gültige Backup-Datei.');
      return;
    }
    if (!confirm('Aktuelle Daten in diesem Browser werden durch das Backup ersetzt. Fortfahren?')) return;

    transactions = data.transactions;
    goals = data.goals && typeof data.goals === 'object' ? data.goals : { overall: null, categories: {} };
    learnedRules = data.learnedRules && typeof data.learnedRules === 'object' ? data.learnedRules : {};
    importLog = data.importLog && typeof data.importLog === 'object' ? data.importLog : {};
    teachChatHistory = Array.isArray(data.teachChatHistory) ? data.teachChatHistory : [];
    categorizationLog = Array.isArray(data.categorizationLog) ? data.categorizationLog : [];

    saveTransactions();
    saveGoals();
    saveLearnedRules();
    saveImportLog();
    saveTeachChat();
    saveCategorizationLog();

    currentMonth = monthStrOf(new Date());
    render();
    renderTeachRulesList();
    renderTeachChatLogFromHistory();
    showToast('Backup wiederhergestellt.');
  };
  reader.onerror = () => showToast('Backup-Datei konnte nicht gelesen werden.');
  reader.readAsText(file, 'UTF-8');
}

document.getElementById('exportBackupBtn').addEventListener('click', exportBackup);

const backupFileInput = document.getElementById('backupFileInput');
document.getElementById('importBackupBtn').addEventListener('click', () => backupFileInput.click());
backupFileInput.addEventListener('change', () => {
  const file = backupFileInput.files[0];
  if (file) importBackup(file);
  backupFileInput.value = '';
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  });
}

const TAB_STORAGE_KEY = 'budget_active_tab';
const DEFAULT_TAB = 'panel-overview';
const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));

function loadActiveTab() {
  try {
    const saved = localStorage.getItem(TAB_STORAGE_KEY);
    return tabButtons.some(b => b.dataset.panel === saved) ? saved : DEFAULT_TAB;
  } catch {
    return DEFAULT_TAB;
  }
}

function setActiveTab(panelId) {
  tabButtons.forEach(btn => {
    const isActive = btn.dataset.panel === panelId;
    document.getElementById(btn.dataset.panel).hidden = !isActive;
    btn.setAttribute('aria-selected', String(isActive));
    btn.tabIndex = isActive ? 0 : -1;
  });
  try { localStorage.setItem(TAB_STORAGE_KEY, panelId); } catch {}
}

document.getElementById('tabBar').addEventListener('click', (e) => {
  const btn = e.target.closest('.tab-btn');
  if (!btn) return;
  setActiveTab(btn.dataset.panel);
});

document.getElementById('tabBar').addEventListener('keydown', (e) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  const currentIdx = tabButtons.findIndex(b => b.getAttribute('aria-selected') === 'true');
  let nextIdx = currentIdx;
  if (e.key === 'ArrowLeft') nextIdx = (currentIdx - 1 + tabButtons.length) % tabButtons.length;
  if (e.key === 'ArrowRight') nextIdx = (currentIdx + 1) % tabButtons.length;
  if (e.key === 'Home') nextIdx = 0;
  if (e.key === 'End') nextIdx = tabButtons.length - 1;
  const next = tabButtons[nextIdx];
  setActiveTab(next.dataset.panel);
  next.focus();
});

setActiveTab(loadActiveTab());

render();
