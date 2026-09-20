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

// Gutschriften (Zahlungseingänge) brauchen keine Ausgaben-Kategorie – sie bekommen diese Sonderkategorie.
const INCOME_CATEGORY = 'Einnahme';
const INCOME_COLOR = '#3a7d5c';
const TX_EXPENSE = 'expense';
const TX_INCOME = 'income';

function isExpense(t) { return t.type !== TX_INCOME; }
function isIncome(t) { return t.type === TX_INCOME; }

// Umbuchungen aufs eigene Konto sind kein Verbrauch: Sie werden angezeigt, zählen aber
// weder ins Ausgaben-Total noch in die Budget-Ziele.
const NON_SPENDING_CATEGORIES = new Set(['Konto Übertragung']);

function countsAsSpending(t) {
  return isExpense(t) && !NON_SPENDING_CATEGORIES.has(t.category);
}

function isTransfer(t) {
  return isExpense(t) && NON_SPENDING_CATEGORIES.has(t.category);
}

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

// Nur diese Kategorien darf die eingebaute Schlüsselwortliste von sich aus sicher zuordnen (z. B. Lidl → Verpflegung).
// Alle anderen Treffer sind reine Vorschläge und landen zur Bestätigung in den Karten.
const AUTO_ASSIGN_CATEGORIES = new Set(['Verpflegung']);

function matchBuiltinKeywords(text) {
  const matches = [];
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const kw of keywords) {
      let from = 0;
      while (true) {
        const idx = text.indexOf(kw, from);
        if (idx === -1) break;
        matches.push({ category, kw, idx, end: idx + kw.length });
        from = idx + 1;
      }
    }
  }
  // Ein Treffer, der komplett in einem längeren Treffer liegt („migrol“ in „migrolino“), zählt nicht.
  const kept = matches.filter(m => !matches.some(n =>
    n !== m && n.kw.length > m.kw.length && n.idx <= m.idx && n.end >= m.end
  ));
  if (!kept.length) return null;
  kept.sort((a, b) => b.kw.length - a.kw.length);
  return { category: kept[0].category, categories: new Set(kept.map(m => m.category)) };
}

// ---- Muster-Gedächtnis -------------------------------------------------------
// Merkt sich, wie oft hintereinander dieselbe Buchung (Text, bzw. Text + Betrag) derselben
// Kategorie zugeordnet wurde. Ab PATTERN_AUTO_THRESHOLD darf die App selbst zuordnen; die ersten
// PATTERN_PROBATION_COUNT automatischen Zuordnungen landen trotzdem noch zur Kontrolle in den Karten.
const PATTERNS_STORAGE_KEY = 'budget_patterns';
const PATTERN_AUTO_THRESHOLD = 5;
const PATTERN_PROBATION_COUNT = 3;

let patterns = loadPatterns();

function loadPatterns() {
  try { return JSON.parse(localStorage.getItem(PATTERNS_STORAGE_KEY)) || {}; }
  catch { return {}; }
}

function savePatterns() {
  localStorage.setItem(PATTERNS_STORAGE_KEY, JSON.stringify(patterns));
}

// Bank-Floskeln und Referenznummern, die nichts über den Händler aussagen.
const DESCRIPTION_BOILERPLATE = [
  /warenbezug und dienstleistungen/g,
  /twint-?\s?(zahlung|belastung|gutschrift)/g,
  /kartenbelastung/g,
  /(belastung|zahlungsauftrag)\s+e-?banking/g,
  /zahlungseingang/g,
  /rückgutschrift|rueckgutschrift/g,
  /geld (gesendet an|erhalten von)/g,
  /anzahl buchungen:?\s*\d+/g,
  /ref\.?\s*-?\s*nr\.?\s*:?\s*\d+/g,
  /\bfil\.?\s*\d+/g,
];

function normalizeDescription(description) {
  let text = (description || '').toLowerCase();
  DESCRIPTION_BOILERPLATE.forEach(re => { text = text.replace(re, ' '); });
  text = text.replace(/[^\p{L}\p{N}&\-.\s]/gu, ' ');
  text = text.split(/\s+/).filter(tok => /[\p{L}\p{N}&]/u.test(tok)).join(' ').trim();
  return text;
}

function patternKeysFor(description, amount) {
  const norm = normalizeDescription(description);
  const generic = norm.length < 3;
  const base = generic ? (description || '').toLowerCase().trim() : norm;
  const amountStr = Number(amount).toFixed(2);
  const keys = [{ key: `da:${base}|${amountStr}`, label: `${base} · ${formatCurrency(Number(amount))}` }];
  // Ohne Händlernamen (z. B. „TWINT Geld gesendet an“) zählt nur die Kombination mit dem Betrag.
  if (!generic) keys.push({ key: `d:${norm}`, label: norm });
  return keys;
}

function isTrustedPattern(p) {
  return !!p && p.streak >= PATTERN_AUTO_THRESHOLD;
}

// Eine bestätigte Zuordnung merken. Gibt den vorherigen Zustand zurück, damit „Zurück“ ihn wiederherstellen kann.
function learnPattern(description, amount, category) {
  const snapshot = [];
  patternKeysFor(description, amount).forEach(({ key, label }) => {
    const prev = patterns[key] ? { ...patterns[key] } : null;
    snapshot.push({ key, prev });
    if (prev && prev.category === category) {
      patterns[key] = { ...prev, streak: prev.streak + 1, label, updatedAt: Date.now() };
    } else {
      patterns[key] = { category, streak: 1, autoCount: 0, label, updatedAt: Date.now() };
    }
  });
  savePatterns();
  return snapshot;
}

function restorePatterns(snapshot) {
  if (!snapshot) return;
  snapshot.forEach(({ key, prev }) => {
    if (prev) patterns[key] = prev;
    else delete patterns[key];
  });
  savePatterns();
}

function forgetPattern(key) {
  if (!(key in patterns)) return false;
  delete patterns[key];
  savePatterns();
  return true;
}

function countPatternAutoAssignment(key) {
  if (!patterns[key]) return;
  patterns[key].autoCount = (patterns[key].autoCount || 0) + 1;
  patterns[key].updatedAt = Date.now();
}

function lookupPattern(description, amount) {
  const entries = patternKeysFor(description, amount)
    .map(k => ({ key: k.key, entry: patterns[k.key] }))
    .filter(e => e.entry);
  if (!entries.length) return null;
  const trusted = entries.find(e => isTrustedPattern(e.entry));
  return trusted ? { ...trusted, trusted: true } : { ...entries[0], trusted: false };
}

// Liefert { category, certain, reason, patternKey?, streak? }.
// certain = darf ohne Rückfrage übernommen werden; sonst landet der Eintrag in den Karten.
function guessCategory(description, amount, type = TX_EXPENSE) {
  const text = (description || '').toLowerCase();

  const learned = matchLearnedRule(text);
  if (learned) return { category: learned, certain: true, reason: 'rule' };

  const pattern = lookupPattern(description, amount);
  if (pattern && pattern.trusted) {
    const probation = (pattern.entry.autoCount || 0) < PATTERN_PROBATION_COUNT;
    return {
      category: pattern.entry.category,
      certain: !probation,
      reason: probation ? 'pattern_probation' : 'pattern',
      patternKey: pattern.key,
      streak: pattern.entry.streak,
    };
  }

  const builtin = matchBuiltinKeywords(text);
  const builtinCertain = !!builtin && builtin.categories.size === 1 && AUTO_ASSIGN_CATEGORIES.has(builtin.category);

  if (pattern) {
    // Noch nicht oft genug bestätigt: die bisherige Wahl vorschlagen, aber prüfen lassen.
    const agrees = builtinCertain && builtin.category === pattern.entry.category;
    return {
      category: pattern.entry.category,
      certain: agrees,
      reason: agrees ? 'keyword' : 'pattern_learning',
      patternKey: pattern.key,
      streak: pattern.entry.streak,
    };
  }

  if (builtin) {
    if (builtinCertain) return { category: builtin.category, certain: true, reason: 'keyword' };
    return { category: builtin.category, certain: false, reason: builtin.categories.size > 1 ? 'ambiguous' : 'suggestion' };
  }

  if (type === TX_INCOME) return { category: INCOME_CATEGORY, certain: true, reason: 'income' };
  return { category: FALLBACK_CATEGORY, certain: false, reason: 'no_match' };
}

const REVIEW_REASON_TEXT = {
  no_match: 'kein Muster erkannt',
  suggestion: 'Vorschlag, noch nicht bestätigt',
  ambiguous: 'mehrere Kategorien möglich',
  pattern_learning: 'Muster wird gelernt',
  pattern_probation: 'erste automatische Zuordnung, bitte bestätigen',
  unknown_file_category: 'Kategorie aus Datei unbekannt',
  file_unassigned: 'in der Datei nicht zugeordnet',
};

function reviewReasonText(t) {
  if (t.reason === 'pattern_learning' && t.streak) {
    return `Muster wird gelernt (${Math.min(t.streak, PATTERN_AUTO_THRESHOLD)}/${PATTERN_AUTO_THRESHOLD})`;
  }
  return REVIEW_REASON_TEXT[t.reason] || 'bitte prüfen';
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
    return migrateTransactions(JSON.parse(localStorage.getItem(STORAGE_KEY)) || []);
  } catch {
    return [];
  }
}

// Ältere Einträge kennen weder Typ (Ausgabe/Gutschrift) noch Reihenfolge innerhalb eines Tages.
// Frühere Importe wurden in Datei-Reihenfolge (neueste zuerst) gespeichert → rückwärts nummerieren.
function migrateTransactions(list) {
  if (!Array.isArray(list)) return [];
  list.forEach((t, i) => {
    if (t.type !== TX_INCOME && t.type !== TX_EXPENSE) t.type = TX_EXPENSE;
    if (typeof t.seq !== 'number') t.seq = -i;
    if (typeof t.amount !== 'number') t.amount = Number(t.amount) || 0;
  });
  return list;
}

// Chronologisch: nach Datum, innerhalb eines Tages nach Buchungsreihenfolge.
function compareChronological(a, b) {
  return a.date.localeCompare(b.date) || ((a.seq || 0) - (b.seq || 0)) || String(a.id).localeCompare(String(b.id));
}

function plural(count, singular, pluralForm) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

function formatDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate || '');
  return m ? `${m[3]}.${m[2]}.${m[1]}` : (isoDate || '');
}

// Läuft der Browserspeicher voll, darf das nicht stillschweigend passieren.
let storageWarned = false;

function safeSetItem(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err) {
    console.error('Speichern fehlgeschlagen:', err);
    if (!storageWarned) {
      storageWarned = true;
      setTimeout(() => showToast('Speicher voll — bitte ein Backup sichern und alte Monate löschen.'), 0);
    }
    return false;
  }
}

function saveTransactions() {
  safeSetItem(STORAGE_KEY, JSON.stringify(transactions));
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

function monthTransactionsOf(monthStr) {
  return transactions.filter(t => t.date.slice(0, 7) === monthStr);
}

function sumAmounts(list) {
  return list.reduce((sum, t) => sum + t.amount, 0);
}

// Ausgaben-Total des Monats: ohne Gutschriften und ohne Konto-Übertragungen.
function getMonthTotal(monthStr) {
  return sumAmounts(monthTransactionsOf(monthStr).filter(countsAsSpending));
}

function getMonthIncome(monthStr) {
  return sumAmounts(monthTransactionsOf(monthStr).filter(isIncome));
}

function getMonthTransfers(monthStr) {
  return sumAmounts(monthTransactionsOf(monthStr).filter(isTransfer));
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
  return monthTransactionsOf(currentMonth).sort(compareChronological);
}

function categoryColor(name) {
  if (name === INCOME_CATEGORY) return INCOME_COLOR;
  const found = CATEGORIES.find(c => c.name === name);
  return found ? found.color : '#64748b';
}

// Auswählbare Kategorien: Gutschriften bekommen zusätzlich „Einnahme“ angeboten.
function selectableCategories(type) {
  const list = CATEGORIES.map(c => ({ name: c.name, color: c.color }));
  if (type === TX_INCOME) list.unshift({ name: INCOME_CATEGORY, color: INCOME_COLOR });
  return list;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// Für Werte in Attributen: escapeHtml lässt Anführungszeichen stehen, weil sie in
// Textknoten harmlos sind. In einem Attribut würden sie es vorzeitig beenden — und
// Buchungstexte der Bank enthalten durchaus welche.
function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function buildCategoryOptions(selected, type) {
  const list = selectableCategories(type);
  if (selected && !list.some(c => c.name === selected)) list.push({ name: selected, color: categoryColor(selected) });
  return list.map(c => `<option value="${escapeAttr(c.name)}" ${c.name === selected ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
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

// Vom Benutzer bestätigte/gewählte Kategorie übernehmen. Jede Bestätigung trainiert das Muster-Gedächtnis;
// der zurückgegebene Schnappschuss erlaubt es, das Gelernte bei „Zurück“ wieder rückgängig zu machen.
function updateTransactionCategory(id, newCategory, options = {}) {
  const t = transactions.find(x => x.id === id);
  if (!t) return null;
  const fromCategory = t.category;
  const changed = fromCategory !== newCategory || t.uncertain !== false;
  t.category = newCategory;
  t.uncertain = false;
  const snapshot = options.learn === false ? null : learnPattern(t.description, t.amount, newCategory);
  if (changed) logCategorization(t, fromCategory, newCategory);
  saveTransactions();
  render();
  renderPatternsList();
  return snapshot;
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

// Gründe, die eine echte Lücke bedeuten (rot) statt nur einen unbestätigten Vorschlag (gelb).
const URGENT_REASONS = new Set(['no_match', 'unknown_file_category']);

function isUrgent(t) {
  return URGENT_REASONS.has(t.reason) || t.category === FALLBACK_CATEGORY;
}

// Ein Balken wird über scaleX animiert; der Endwert steckt in der Breite.
function barMarkup(className, pct, color) {
  const style = `width:${pct}%${color ? `; background:${color}` : ''}`;
  return `<div class="${className}" style="${style}"></div>`;
}

function render() {
  document.getElementById('currentMonthLabel').textContent = formatMonthLabel(currentMonth);

  const monthTx = getMonthTransactions();
  const spending = monthTx.filter(countsAsSpending);
  const total = sumAmounts(spending);
  const income = sumAmounts(monthTx.filter(isIncome));
  const transfers = sumAmounts(monthTx.filter(isTransfer));

  const { currency, number } = formatCurrencyParts(total);
  document.getElementById('heroCurrency').textContent = currency;
  animateHeroValue(number, total);
  document.getElementById('txCount').textContent = monthTx.length;
  document.getElementById('monthIncome').textContent = formatCurrency(income);

  const transferCard = document.getElementById('transferCard');
  transferCard.hidden = transfers <= 0;
  document.getElementById('monthTransfers').textContent = formatCurrency(transfers);

  document.getElementById('welcomeCard').hidden = transactions.length > 0;
  renderHeroDelta(currentMonth);

  // Gezählte und nicht gezählte Kategorien getrennt ausweisen.
  const byCategory = {};
  monthTx.filter(isExpense).forEach(t => {
    byCategory[t.category] = (byCategory[t.category] || 0) + t.amount;
  });
  const entries = Object.entries(byCategory).sort((a, b) => b[1] - a[1]);
  const counted = entries.filter(([name]) => !NON_SPENDING_CATEGORIES.has(name));
  const aside = entries.filter(([name]) => NON_SPENDING_CATEGORIES.has(name));

  document.getElementById('topCategory').textContent = counted.length ? counted[0][0] : '–';

  const maxAmount = counted.length ? counted[0][1] : 0;
  const categoryListEl = document.getElementById('categoryList');
  categoryListEl.innerHTML = counted.length
    ? counted.map(([name, amount], i) => `
        <div class="category-row" style="--i:${i}">
          <div class="category-row-top">
            <span>${escapeHtml(name)}</span>
            <span>${formatCurrency(amount)}</span>
          </div>
          <div class="category-bar-track">
            ${barMarkup('category-bar-fill', maxAmount ? (amount / maxAmount) * 100 : 0, categoryColor(name))}
          </div>
        </div>`).join('')
    : '<p class="empty-state">Noch keine Daten für diesen Monat.</p>';

  document.getElementById('categoryAsideWrap').hidden = aside.length === 0;
  document.getElementById('categoryAside').innerHTML = aside.map(([name, amount]) => `
    <div class="category-row is-aside">
      <div class="category-row-top">
        <span>${escapeHtml(name)}</span>
        <span>${formatCurrency(amount)}</span>
      </div>
    </div>`).join('');

  renderGoalsSection(total, byCategory);
  renderImportSourceInfo();
  renderHistoryList();
  renderReviewQueue();
  renderBackupStatus();

  const txListEl = document.getElementById('transactionList');
  document.getElementById('emptyState').hidden = monthTx.length > 0;
  txListEl.innerHTML = monthTx.map((t, i) => {
    const credit = isIncome(t);
    const classes = ['transaction-item'];
    if (t.uncertain) classes.push('needs-category');
    if (t.uncertain && isUrgent(t)) classes.push('is-urgent');
    if (credit) classes.push('is-income');
    const meta = [formatDate(t.date)];
    if (credit) meta.push('Gutschrift');
    if (isTransfer(t)) meta.push('zählt nicht ins Total');
    if (t.uncertain) meta.push(reviewReasonText(t));
    return `
      <div class="${classes.join(' ')}" style="--i:${i}">
        <span class="tx-dot" style="background:${categoryColor(t.category)}"></span>
        <div class="tx-info">
          <span class="tx-desc">${escapeHtml(t.description)}</span>
          <span class="tx-meta">${escapeHtml(meta.join(' · '))}</span>
        </div>
        <select class="tx-category-select" data-id="${escapeAttr(t.id)}" aria-label="Kategorie für ${escapeAttr(t.description)}">${buildCategoryOptions(t.category, t.type)}</select>
        <span class="tx-amount${credit ? ' is-income' : ''}">${credit ? '+ ' : ''}${formatCurrency(t.amount)}</span>
        <button type="button" class="tx-delete" data-id="${escapeAttr(t.id)}" aria-label="Eintrag ${escapeAttr(t.description)} löschen">✕</button>
      </div>`;
  }).join('');
}

// Die grosse Zahl zählt weich auf den neuen Wert hoch, statt zu springen.
let heroAnim = { value: null, frame: 0 };

function animateHeroValue(text, value) {
  const el = document.getElementById('heroValue');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const from = heroAnim.value;
  heroAnim.value = value;

  if (reduce || from === null || from === value || document.hidden) {
    cancelAnimationFrame(heroAnim.frame);
    el.textContent = text;
    return;
  }

  cancelAnimationFrame(heroAnim.frame);
  const start = performance.now();
  const duration = 480;
  const step = (now) => {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    if (p < 1) {
      el.textContent = formatCurrencyParts(from + (value - from) * eased).number;
      heroAnim.frame = requestAnimationFrame(step);
    } else {
      el.textContent = text;
    }
  };
  heroAnim.frame = requestAnimationFrame(step);
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
  listEl.innerHTML = allRows.map((r, i) => `
    <div class="goal-row status-${r.level}" style="--i:${i}">
      <div class="goal-row-top">
        <span class="goal-name">${escapeHtml(r.name)}</span>
        <span class="goal-status-badge status-${r.level}">
          <span class="goal-status-icon">${GOAL_ICONS[r.level]}</span>${GOAL_LABELS[r.level]}
        </span>
      </div>
      <div class="goal-track" role="progressbar" aria-valuemin="0" aria-valuemax="100"
           aria-valuenow="${Math.round(r.displayPct)}"
           aria-label="${escapeAttr(r.name)}: ${Math.round(r.pct)}% des Ziels, ${GOAL_LABELS[r.level]}">
        ${barMarkup(`goal-fill status-fill-${r.level}`, r.displayPct)}
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

  const totals = months.map(m => ({ month: m, total: getMonthTotal(m), income: getMonthIncome(m) }));
  const maxTotal = Math.max(...totals.map(t => t.total), 0);

  if (!totals.length) {
    listEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  listEl.innerHTML = totals.map(({ month, total, income }, i) => {
    const pct = maxTotal ? (total / maxTotal) * 100 : 0;
    const isCurrent = month === currentMonth;
    return `
      <button type="button" class="history-row${isCurrent ? ' is-current' : ''}" data-month="${month}" style="--i:${i}"${isCurrent ? ' aria-current="true"' : ''}>
        <div class="history-row-top">
          <span class="history-month">${formatMonthLabel(month)}${isCurrent ? '<span class="history-current-tag">ausgewählt</span>' : ''}</span>
          <span>${formatCurrency(total)}</span>
        </div>
        <div class="history-bar-track">
          ${barMarkup('history-bar-fill', pct)}
        </div>
        ${income > 0 ? `<div class="history-income">Gutschriften: + ${formatCurrency(income)}</div>` : ''}
      </button>
    `;
  }).join('');
}

// Alle noch zu bestätigenden Einträge, chronologisch (älteste zuerst).
function getReviewQueue() {
  return transactions.filter(t => t.uncertain).sort(compareChronological);
}

function renderReviewQueue() {
  const queue = getReviewQueue();
  const listEl = document.getElementById('reviewQueueList');
  const emptyEl = document.getElementById('reviewQueueEmptyState');
  const badge = document.getElementById('reviewTabBadge');

  // Kurzes Aufpoppen, wenn die Zahl sich ändert – sonst übersieht man neue Aufgaben.
  const previous = badge.textContent;
  badge.hidden = queue.length === 0;
  badge.textContent = queue.length;
  if (!badge.hidden && previous !== String(queue.length)) {
    badge.classList.remove('is-bumped');
    void badge.offsetWidth;
    badge.classList.add('is-bumped');
  }
  document.getElementById('startReviewSessionBtn').disabled = queue.length === 0;

  if (!queue.length) {
    listEl.innerHTML = '';
    emptyEl.hidden = false;
    return;
  }
  emptyEl.hidden = true;
  listEl.innerHTML = queue.map((t, i) => `
    <div class="review-row${isUrgent(t) ? ' is-urgent' : ''}" style="--i:${i}">
      <div class="tx-info">
        <span class="tx-desc">${escapeHtml(t.description)}</span>
        <span class="tx-meta">${formatDate(t.date)} · ${isIncome(t) ? '+ ' : ''}${formatCurrency(t.amount)}${isIncome(t) ? ' (Gutschrift)' : ''} · ${escapeHtml(reviewReasonText(t))}</span>
      </div>
      <select class="tx-category-select" data-id="${escapeAttr(t.id)}" aria-label="Kategorie für ${escapeAttr(t.description)}">${buildCategoryOptions(t.category, t.type)}</select>
      <button type="button" class="tx-delete" data-id="${escapeAttr(t.id)}" aria-label="Eintrag ${escapeAttr(t.description)} löschen">✕</button>
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
  document.getElementById('reviewProgressFill').style.width =
    `${(reviewSession.index / reviewSession.ids.length) * 100}%`;
  document.getElementById('reviewCardDesc').textContent = t.description;
  document.getElementById('reviewCardMeta').textContent =
    `${formatDate(t.date)} · ${isIncome(t) ? '+ ' : ''}${formatCurrency(t.amount)} · ${isIncome(t) ? 'Gutschrift' : 'Ausgabe'}`;
  document.getElementById('reviewCardReason').textContent = reviewReasonText(t);
  const badge = document.getElementById('reviewCardCategory');
  badge.textContent = t.category;
  badge.style.background = categoryColor(t.category);

  document.getElementById('reviewChipGrid').innerHTML = selectableCategories(t.type).map(c => `
    <button type="button" class="review-chip" data-category="${escapeAttr(c.name)}">
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
  document.getElementById('reviewProgressFill').style.width = '100%';
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
    const patternSnapshot = updateTransactionCategory(t.id, category);
    reviewSession.history.push({ id: t.id, type: 'assign', fromCategory, fromUncertain, toCategory: category, patternSnapshot });
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
    }
    // Auch das dabei Gelernte zurücknehmen, sonst zählt die zurückgenommene Zuordnung weiter als Bestätigung.
    restorePatterns(entry.patternSnapshot);
    render();
    renderPatternsList();
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
      entry.patternSnapshot = learnPattern(t.description, t.amount, entry.toCategory);
      saveTransactions();
      render();
      renderPatternsList();
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

// Bricht die Geste ab (z. B. eingehender Anruf), darf die Karte nicht schief hängen bleiben.
reviewCard.addEventListener('pointercancel', () => {
  if (!cardDrag) return;
  cardDrag = null;
  reviewCard.classList.remove('dragging');
  resetCardPosition();
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
document.getElementById('categorizationLogClearBtn').addEventListener('click', async () => {
  if (!categorizationLog.length) {
    showToast('Zuordnungsverlauf ist bereits leer.');
    return;
  }
  const ok = await askConfirm({
    title: 'Verlauf leeren?',
    text: 'Der Zuordnungsverlauf wird vollständig gelöscht. Deine Ausgaben und Kategorien bleiben unverändert.',
    confirmLabel: 'Leeren',
  });
  if (!ok) return;
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

// Rohdaten-Spalten: A DATUM · B MONAT · C TYP · D BESCHREIBUNG · E KATEGORIE · F BETRAG
const EXPORT_TYPE_LABEL = { [TX_EXPENSE]: 'Ausgabe', [TX_INCOME]: 'Gutschrift' };

function expenseSumFormula(monthStr, categoryName) {
  return `SUMIFS(Rohdaten!$F:$F,Rohdaten!$B:$B,"${monthStr}",Rohdaten!$C:$C,"Ausgabe",Rohdaten!$E:$E,"${categoryName}")`;
}

function incomeSumFormula(monthStr) {
  return `SUMIFS(Rohdaten!$F:$F,Rohdaten!$B:$B,"${monthStr}",Rohdaten!$C:$C,"Gutschrift")`;
}

function buildRawDataSheet() {
  const sorted = transactions.slice().sort(compareChronological);
  const aoa = [
    ['DATUM', 'MONAT', 'TYP', 'BESCHREIBUNG', 'KATEGORIE', 'BETRAG (CHF)'],
    ...sorted.map(t => [t.date, t.date.slice(0, 7), EXPORT_TYPE_LABEL[t.type] || 'Ausgabe', t.description, t.category, t.amount]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 12 }, { wch: 10 }, { wch: 11 }, { wch: 40 }, { wch: 18 }, { wch: 14 }];
  stampFormat(ws, sorted.map((_, i) => ({ r: i + 1, c: 5 })), CHF_FMT);
  return ws;
}

function buildMonthSheet(monthStr) {
  const monthTx = monthTransactionsOf(monthStr);
  const expenses = monthTx.filter(isExpense);

  const byCategory = {};
  expenses.forEach(t => { byCategory[t.category] = (byCategory[t.category] || 0) + t.amount; });
  // Konto-Übertragungen stehen unterhalb des Totals, damit die Summe sie nicht erfasst.
  const categoryRows = CATEGORIES.filter(c => byCategory[c.name] && !NON_SPENDING_CATEGORIES.has(c.name));
  const asideRows = CATEGORIES.filter(c => byCategory[c.name] && NON_SPENDING_CATEGORIES.has(c.name));
  const expenseTotal = sumAmounts(monthTx.filter(countsAsSpending));
  const incomeTotal = sumAmounts(monthTx.filter(isIncome));

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
  const ausgabenRow = aoa.length;
  aoa.push(['AUSGABEN TOTAL', expenseTotal]);
  const einnahmenRow = aoa.length;
  aoa.push(['EINNAHMEN', incomeTotal]);
  const differenzRow = aoa.length;
  aoa.push(['DIFFERENZ', incomeTotal - expenseTotal]);

  const asideEntries = [];
  if (asideRows.length) {
    aoa.push([]);
    aoa.push(['NICHT IM TOTAL']);
    asideRows.forEach(c => {
      asideEntries.push({ r: aoa.length, name: c.name, value: byCategory[c.name] });
      aoa.push([c.name, byCategory[c.name]]);
    });
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 22 }, { wch: 15 }];
  ws['!merges'] = merges;

  [...catRowEntries, ...asideEntries].forEach(entry => {
    setComputedCell(ws, entry.r, 1, expenseSumFormula(monthStr, entry.name), entry.value, CHF_FMT);
  });

  if (catRowEntries.length) {
    const firstCatExcelRow = catRowEntries[0].r + 1;
    const lastCatExcelRow = catRowEntries[catRowEntries.length - 1].r + 1;
    setComputedCell(ws, ausgabenRow, 1, `SUM(B${firstCatExcelRow}:B${lastCatExcelRow})`, expenseTotal, CHF_FMT);
  } else {
    setComputedCell(ws, ausgabenRow, 1, null, 0, CHF_FMT);
  }
  setComputedCell(ws, einnahmenRow, 1, incomeSumFormula(monthStr), incomeTotal, CHF_FMT);
  setComputedCell(ws, differenzRow, 1, `B${einnahmenRow + 1}-B${ausgabenRow + 1}`, incomeTotal - expenseTotal, CHF_FMT);

  return ws;
}

function buildOverviewSheet(orderedMonths) {
  const totalColIdx = 1 + orderedMonths.length;
  const pctColIdx = totalColIdx + 1;
  const totalCols = pctColIdx + 1;

  const categoryRow = (cat) => {
    const monthValues = orderedMonths.map(m =>
      sumAmounts(monthTransactionsOf(m).filter(t => isExpense(t) && t.category === cat.name))
    );
    return { name: cat.name, monthValues, rowTotal: monthValues.reduce((s, v) => s + v, 0) };
  };
  // Konto-Übertragungen stehen unterhalb des Totals und fliessen nicht in die Summen ein.
  const categoryData = CATEGORIES.filter(c => !NON_SPENDING_CATEGORIES.has(c.name)).map(categoryRow);
  const asideData = CATEGORIES.filter(c => NON_SPENDING_CATEGORIES.has(c.name)).map(categoryRow);
  const grandTotal = categoryData.reduce((s, c) => s + c.rowTotal, 0);
  const monthTotals = orderedMonths.map(m => getMonthTotal(m));
  const monthIncomes = orderedMonths.map(m => getMonthIncome(m));
  const incomeTotal = monthIncomes.reduce((s, v) => s + v, 0);

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
  aoa.push(['AUSGABEN TOTAL', ...monthTotals, grandTotal, grandTotal > 0 ? 1 : 0]);
  const incomeRowIdx = aoa.length;
  aoa.push(['EINNAHMEN', ...monthIncomes, incomeTotal, '']);
  const diffRowIdx = aoa.length;
  aoa.push(['DIFFERENZ (EINNAHMEN − AUSGABEN)', ...monthIncomes.map((v, i) => v - monthTotals[i]), incomeTotal - grandTotal, '']);

  const asideRowIdx = [];
  if (asideData.length) {
    aoa.push([]);
    aoa.push(['NICHT IM TOTAL']);
    asideData.forEach(cat => {
      asideRowIdx.push(aoa.length);
      aoa.push([cat.name, ...cat.monthValues, cat.rowTotal, '']);
    });
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [{ wch: 30 }, ...orderedMonths.map(() => ({ wch: 13 })), { wch: 16 }, { wch: 8 }];
  ws['!merges'] = merges;

  const firstMonthColLetter = XLSX.utils.encode_col(1);
  const lastMonthColLetter = XLSX.utils.encode_col(orderedMonths.length);
  const totalColLetter = XLSX.utils.encode_col(totalColIdx);
  const totalRowExcel = totalRowIdx + 1;
  const incomeRowExcel = incomeRowIdx + 1;
  const firstCatRowExcel = catRows[0] + 1;
  const lastCatRowExcel = catRows[catRows.length - 1] + 1;

  categoryData.forEach((cat, i) => {
    const r = catRows[i];
    const excelRow = r + 1;
    cat.monthValues.forEach((value, ci) => {
      setComputedCell(ws, r, 1 + ci, expenseSumFormula(orderedMonths[ci], cat.name), value, CHF_FMT);
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
    setComputedCell(ws, incomeRowIdx, 1 + ci, incomeSumFormula(m), monthIncomes[ci], CHF_FMT);
    setComputedCell(
      ws, diffRowIdx, 1 + ci,
      `${colLetter}${incomeRowExcel}-${colLetter}${totalRowExcel}`,
      monthIncomes[ci] - monthTotals[ci], CHF_FMT
    );
  });
  setComputedCell(
    ws, totalRowIdx, totalColIdx,
    `SUM(${totalColLetter}${firstCatRowExcel}:${totalColLetter}${lastCatRowExcel})`,
    grandTotal, CHF_FMT
  );
  setComputedCell(ws, totalRowIdx, pctColIdx, null, grandTotal > 0 ? 1 : 0, PCT_FMT);
  setComputedCell(
    ws, incomeRowIdx, totalColIdx,
    `SUM(${firstMonthColLetter}${incomeRowExcel}:${lastMonthColLetter}${incomeRowExcel})`,
    incomeTotal, CHF_FMT
  );
  setComputedCell(
    ws, diffRowIdx, totalColIdx,
    `${totalColLetter}${incomeRowExcel}-${totalColLetter}${totalRowExcel}`,
    incomeTotal - grandTotal, CHF_FMT
  );

  asideData.forEach((cat, i) => {
    const r = asideRowIdx[i];
    const excelRow = r + 1;
    cat.monthValues.forEach((value, ci) => {
      setComputedCell(ws, r, 1 + ci, expenseSumFormula(orderedMonths[ci], cat.name), value, CHF_FMT);
    });
    setComputedCell(
      ws, r, totalColIdx,
      `SUM(${firstMonthColLetter}${excelRow}:${lastMonthColLetter}${excelRow})`,
      cat.rowTotal, CHF_FMT
    );
  });

  return ws;
}

function buildWorkbook() {
  const orderedMonths = getFullYearMonthRange();
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
  return wb;
}

async function exportYearlyExcel() {
  if (!getFullYearMonthRange().length) {
    showToast('Keine Daten zum Exportieren vorhanden.');
    return;
  }
  const btn = document.getElementById('exportExcelBtn');
  try {
    await withBusyButton(btn, 'Wird erstellt …', async () => {
      await ensureXlsx();
      XLSX.writeFile(buildWorkbook(), `Budget-Export-${localIsoDate(new Date())}.xlsx`);
    });
    showToast('Excel-Datei heruntergeladen.');
  } catch (err) {
    console.error('Export-Fehler:', err);
    showToast('Export fehlgeschlagen. Bist du online? Die Excel-Funktion wird einmalig nachgeladen.');
  }
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
const typeSelect = document.getElementById('fType');

function fillAddCategorySelect() {
  const previous = categorySelect.value;
  categorySelect.innerHTML = buildCategoryOptions(previous, typeSelect.value);
}
typeSelect.addEventListener('change', fillAddCategorySelect);

const dialog = document.getElementById('addDialog');
document.getElementById('addBtn').addEventListener('click', () => {
  typeSelect.value = TX_EXPENSE;
  fillAddCategorySelect();
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
  const amount = Math.abs(parseFloat(document.getElementById('fAmount').value));
  const category = categorySelect.value;
  const type = typeSelect.value === TX_INCOME ? TX_INCOME : TX_EXPENSE;
  if (!date || !description || isNaN(amount)) return;

  // Manuelle Einträge kommen ans Ende des Tages; die Kategorie gilt als vom Benutzer bestätigt.
  transactions.push({ id: Date.now().toString(), date, description, amount, type, category, uncertain: false, seq: 1e9 });
  learnPattern(description, amount, category);
  saveTransactions();
  currentMonth = date.slice(0, 7);
  dialog.close();
  render();
  renderPatternsList();
});

const goalsDialog = document.getElementById('goalsDialog');

function openGoalsDialog() {
  document.getElementById('goalOverall').value = goals.overall ?? '';
  document.getElementById('goalCategoryFields').innerHTML = CATEGORIES.map(c => `
    <label class="goal-field">
      <span class="goal-field-dot" style="background:${c.color}"></span>
      ${escapeHtml(c.name)}
      <input type="number" min="0" step="0.05" placeholder="kein Ziel"
             data-goal-category="${escapeAttr(c.name)}"
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

document.getElementById('clearMonthBtn').addEventListener('click', async () => {
  const monthTx = getMonthTransactions();
  if (!monthTx.length) {
    showToast('Keine Einträge in diesem Monat.');
    return;
  }
  const label = formatMonthLabel(currentMonth);
  const ok = await askConfirm({
    title: `${label} löschen?`,
    text: `${plural(monthTx.length, 'Eintrag wird', 'Einträge werden')} unwiderruflich entfernt. Gelernte Regeln und Muster bleiben erhalten.`,
  });
  if (!ok) return;

  const idsToRemove = new Set(monthTx.map(t => t.id));
  transactions = transactions.filter(t => !idsToRemove.has(t.id));
  saveTransactions();
  render();
  showToast(`${plural(monthTx.length, 'Eintrag', 'Einträge')} aus ${label} gelöscht.`);
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
  // Animation neu starten, auch wenn schon eine Meldung sichtbar ist.
  toast.style.animation = 'none';
  void toast.offsetWidth;
  toast.style.animation = '';
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => { toast.hidden = true; }, 4000);
}

// ---- Eigener Bestätigungs-Dialog statt der Browser-Meldung ------------------
const confirmDialog = document.getElementById('confirmDialog');
let confirmResolve = null;

function askConfirm({ title = 'Sicher?', text = '', confirmLabel = 'Löschen', danger = true }) {
  settleConfirm(false);   // eine noch offene Abfrage sauber beenden, statt sie zu verlieren
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmText').textContent = text;
  const okBtn = document.getElementById('confirmOkBtn');
  okBtn.textContent = confirmLabel;
  okBtn.className = danger ? 'btn-danger' : 'btn-primary';
  if (!confirmDialog.open) confirmDialog.showModal();
  return new Promise(resolve => { confirmResolve = resolve; });
}

function settleConfirm(value) {
  if (confirmResolve) { confirmResolve(value); confirmResolve = null; }
}

document.getElementById('confirmOkBtn').addEventListener('click', () => {
  settleConfirm(true);
  confirmDialog.close();
});
document.getElementById('confirmCancelBtn').addEventListener('click', () => {
  settleConfirm(false);
  confirmDialog.close();
});
// Fängt das Schliessen per Escape-Taste ab. Das close-Ereignis kommt verzögert; ist inzwischen
// schon wieder eine Abfrage offen, gehört sie nicht zu diesem Ereignis.
confirmDialog.addEventListener('close', () => {
  if (!confirmDialog.open) settleConfirm(false);
});

// ---- Excel-Bibliothek erst laden, wenn sie gebraucht wird -------------------
// Spart beim Start rund 900 KB und macht die App auf dem Handy spürbar schneller.
let xlsxPromise = null;

function ensureXlsx() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  if (xlsxPromise) return xlsxPromise;
  xlsxPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'lib/xlsx.full.min.js';
    script.onload = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('XLSX fehlt'));
    script.onerror = () => { xlsxPromise = null; reject(new Error('XLSX konnte nicht geladen werden')); };
    document.head.appendChild(script);
  });
  return xlsxPromise;
}

// Zeigt während einer längeren Aktion einen Ladezustand auf dem Knopf.
async function withBusyButton(button, label, task) {
  const original = button.innerHTML;
  button.disabled = true;
  button.textContent = label;
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.innerHTML = original;
  }
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

const DATE_KEYWORDS = ['datum', 'buchungsdatum', 'valuta', 'date', 'buchung'];
const DESC_KEYWORDS = ['buchungstext', 'text', 'beschreibung', 'avisierungstext', 'zahlungszweck', 'description', 'details', 'bezeichnung', 'händler', 'haendler', 'name'];
const AMOUNT_KEYWORDS = ['betrag', 'amount', 'belastung', 'debit', 'ausgabe', 'soll'];
const CREDIT_KEYWORDS = ['gutschrift', 'credit', 'eingang', 'einnahme', 'haben'];
const CATEGORY_HEADER_KEYWORDS = ['kategorie', 'category', 'rubrik', 'zuordnung'];
const TYPE_HEADER_NAMES = ['typ', 'type', 'art', 'buchungsart'];

function findColumn(headers, keywords, exclude = []) {
  const lower = headers.map(h => String(h || '').toLowerCase());
  for (const kw of keywords) {
    const idx = lower.findIndex((h, i) => !exclude.includes(i) && h.includes(kw));
    if (idx !== -1) return idx;
  }
  return -1;
}

function findExactColumn(headers, names, exclude = []) {
  return headers.findIndex((h, i) => !exclude.includes(i) && names.includes(String(h || '').trim().toLowerCase()));
}

function analyzeHeaderRow(headers) {
  const dateIdx = findColumn(headers, DATE_KEYWORDS);
  const amountIdx = findColumn(headers, AMOUNT_KEYWORDS, [dateIdx]);
  const creditIdx = findColumn(headers, CREDIT_KEYWORDS, [dateIdx, amountIdx]);
  const descIdx = findColumn(headers, DESC_KEYWORDS, [dateIdx, amountIdx, creditIdx]);
  const categoryIdx = findColumn(headers, CATEGORY_HEADER_KEYWORDS, [dateIdx, amountIdx, creditIdx, descIdx]);
  const typeIdx = findExactColumn(headers, TYPE_HEADER_NAMES, [dateIdx, amountIdx, creditIdx, descIdx, categoryIdx]);
  return { dateIdx, amountIdx, creditIdx, descIdx, categoryIdx, typeIdx };
}

// Sucht in den ersten Zeilen eines Blatts die Titelzeile und erkennt zwei Tabellenarten:
//  - detail:  Einzelbuchungen (Datum, Beschreibung, Betrag – optional Gutschrift, Kategorie, Typ)
//  - summary: Monatssummen pro Kategorie ohne Datum (z. B. die Monatsblätter des eigenen Exports)
function detectTable(rows, sheetName) {
  const limit = Math.min(rows.length, 20);
  for (let i = 0; i < limit; i++) {
    const headers = (rows[i] || []).map(c => String(c ?? '').trim());
    if (headers.filter(Boolean).length < 2) continue;
    const cols = analyzeHeaderRow(headers);
    const hasAmount = cols.amountIdx !== -1 || cols.creditIdx !== -1;
    if (cols.dateIdx !== -1 && cols.descIdx !== -1 && hasAmount) {
      return { kind: 'detail', sheetName, rows, headerRowIndex: i, headers, ...cols };
    }
    if (cols.dateIdx === -1 && cols.descIdx === -1 && cols.categoryIdx !== -1 && hasAmount) {
      return { kind: 'summary', sheetName, rows, headerRowIndex: i, headers, ...cols };
    }
  }
  return null;
}

// Notlösung, wenn keine Tabelle erkannt wurde: erste Zeile mit bekannten Stichworten (sonst Zeile 1),
// die Spalten ordnet der Benutzer dann von Hand zu.
function findHeaderRow(rows) {
  const allKeywords = [...DATE_KEYWORDS, ...DESC_KEYWORDS, ...AMOUNT_KEYWORDS];
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const rowText = (rows[i] || []).map(c => String(c || '').toLowerCase());
    if (rowText.some(cell => allKeywords.some(kw => cell.includes(kw)))) return i;
  }
  return 0;
}

function fallbackTable(rows, sheetName) {
  const headerRowIndex = findHeaderRow(rows);
  const headers = (rows[headerRowIndex] || []).map(c => String(c ?? '').trim());
  return { kind: 'detail', sheetName, rows, headerRowIndex, headers, ...analyzeHeaderRow(headers) };
}

const MONTH_NAME_NUMBERS = {
  januar: 1, jan: 1, februar: 2, feb: 2, märz: 3, maerz: 3, mär: 3, mar: 3, april: 4, apr: 4, mai: 5,
  juni: 6, jun: 6, juli: 7, jul: 7, august: 8, aug: 8, september: 9, sept: 9, sep: 9,
  oktober: 10, okt: 10, november: 11, nov: 11, dezember: 12, dez: 12,
};

// Erkennt „2026-08“, „08.2026“, „August 2026“, „08-Aug“ … in Blatt- oder Dateinamen.
function parseMonthHint(text) {
  const s = String(text || '').toLowerCase();
  let m = s.match(/(20\d{2})[-_. /]?(0[1-9]|1[0-2])(?!\d)/);
  if (m) return { year: Number(m[1]), month: Number(m[2]) };
  m = s.match(/(^|\D)(0?[1-9]|1[0-2])[-_. /](20\d{2})(?!\d)/);
  if (m) return { year: Number(m[3]), month: Number(m[2]) };
  const yearMatch = s.match(/(^|\D)(20\d{2})(?!\d)/);
  const year = yearMatch ? Number(yearMatch[2]) : null;
  const names = Object.keys(MONTH_NAME_NUMBERS).sort((a, b) => b.length - a.length);
  for (const name of names) {
    if (new RegExp(`(^|[^a-zäöü])${name}(?![a-zäöü])`).test(s)) return { year, month: MONTH_NAME_NUMBERS[name] };
  }
  return null;
}

function resolveSummaryMonth(sheetName, fileName) {
  const fromSheet = parseMonthHint(sheetName);
  const fromFile = parseMonthHint(fileName);
  const month = fromSheet ? fromSheet.month : (fromFile ? fromFile.month : null);
  if (!month) return null;
  const year = (fromSheet && fromSheet.year) || (fromFile && fromFile.year) || new Date().getFullYear();
  return `${year}-${String(month).padStart(2, '0')}`;
}

// ---- Kategorien aus der Datei den App-Kategorien zuordnen ----------------------------------
function normalizeCategoryName(s) {
  return asciiUmlauts(String(s || '').toLowerCase()).replace(/[^a-z0-9]+/g, ' ').trim();
}

const CATEGORY_ALIASES = {
  'Verpflegung': ['lebensmittel', 'essen', 'nahrung', 'food', 'einkauf', 'einkaufen', 'essen auswaerts', 'lebensmittel einkauf'],
  'Ausgang': ['ausgang freizeit', 'freizeit', 'ausgehen', 'party', 'bar'],
  'Kleidung': ['kleider', 'clothes', 'mode'],
  'Hobbies': ['hobby', 'hobbys', 'sport'],
  'Friseur': ['coiffeur', 'haare', 'barber'],
  'Geschenke': ['geschenk', 'gifts'],
  'Mobile Daten': ['mobile', 'handy', 'telefon', 'natel', 'telefon post', 'abo'],
  'El. Geräte': ['el geraet', 'elektronik', 'elektro', 'geraete', 'electronics'],
  'Ferien': ['urlaub', 'reisen', 'reise', 'holiday'],
  'Auto': ['car', 'benzin', 'tanken', 'bz parking priv', 'parking'],
  'SBB': ['oev', 'ov', 'zug', 'bahn', 'zvv', 'gav'],
  'Cevi': ['cevi kosten'],
  'Konto Übertragung': ['uebertrag', 'uebertragung', 'transfer', 'umbuchung', 'konto'],
  'Noch auszuwählen': ['offen', 'unklar', 'unbekannt', 'rest', 'noch offen'],
  [INCOME_CATEGORY]: ['einnahmen', 'gutschrift', 'lohn', 'salaer', 'income', 'einkommen'],
};

function mapFileCategory(raw) {
  const norm = normalizeCategoryName(raw);
  if (!norm) return null;
  const all = [...CATEGORIES.map(c => c.name), INCOME_CATEGORY];
  const exact = all.find(name => normalizeCategoryName(name) === norm);
  if (exact) return exact;
  for (const [name, aliases] of Object.entries(CATEGORY_ALIASES)) {
    if (aliases.includes(norm)) return name;
  }
  // Teilübereinstimmung, z. B. „Geräte“ ↔ „El. Geräte“
  const partial = all.find(name => {
    const n = normalizeCategoryName(name);
    return n.length >= 4 && norm.length >= 4 && (norm.includes(n) || n.includes(norm));
  });
  return partial || null;
}

// Kategorie einer importierten Zeile bestimmen. Eine Kategorie aus der Datei gilt als bestätigt;
// nur leere/unbekannte Zuordnungen werden von der App vorgeschlagen und landen in den Karten.
function resolveRowCategory(row) {
  const raw = row.fileCategoryRaw;
  if (raw) {
    const mapped = mapFileCategory(raw);
    if (mapped && mapped !== FALLBACK_CATEGORY) return { category: mapped, certain: true, reason: 'file', fromFile: true };
    const guess = guessCategory(row.description, row.amount, row.type);
    if (!mapped) return { ...guess, certain: false, reason: 'unknown_file_category', unknownName: raw };
    if (guess.certain) return guess;
    return { ...guess, reason: guess.reason === 'no_match' ? 'file_unassigned' : guess.reason };
  }
  return guessCategory(row.description, row.amount, row.type);
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

let importTables = [];
let importSkippedSheets = [];
let currentImportHeaders = [];

const mapDate = document.getElementById('mapDate');
const mapDesc = document.getElementById('mapDesc');
const mapAmount = document.getElementById('mapAmount');
const mapCredit = document.getElementById('mapCredit');
const mapCategory = document.getElementById('mapCategory');
const mapSign = document.getElementById('mapSign');
const mapSignLabel = document.getElementById('mapSignLabel');

function suggestSignForHeader(headerName) {
  const h = (headerName || '').toLowerCase();
  if (h.includes('belastung') || h.includes('debit') || h.includes('ausgabe') || h.includes('soll')) return 'all_expense';
  return 'negative';
}

function updateSignSuggestion() {
  mapSign.value = suggestSignForHeader(currentImportHeaders[Number(mapAmount.value)]);
  // Mit eigener Gutschrift-Spalte ist das Vorzeichen egal: Belastung = Ausgabe, Gutschrift = Einnahme.
  mapSignLabel.hidden = Number(mapCredit.value) !== -1;
}

function fillHeaderSelect(select, headers, defaultIdx, optional) {
  select.innerHTML = '';
  if (optional) {
    const none = document.createElement('option');
    none.value = '-1';
    none.textContent = '– keine –';
    select.appendChild(none);
  }
  headers.forEach((h, idx) => {
    const opt = document.createElement('option');
    opt.value = String(idx);
    opt.textContent = h || `Spalte ${idx + 1}`;
    select.appendChild(opt);
  });
  select.value = String(defaultIdx !== -1 ? defaultIdx : (optional ? -1 : 0));
}

function populateMappingSelects(table) {
  currentImportHeaders = table.headers;
  fillHeaderSelect(mapDate, table.headers, table.dateIdx, false);
  fillHeaderSelect(mapDesc, table.headers, table.descIdx, false);
  fillHeaderSelect(mapAmount, table.headers, table.amountIdx, false);
  fillHeaderSelect(mapCredit, table.headers, table.creditIdx, true);
  fillHeaderSelect(mapCategory, table.headers, table.categoryIdx, true);
  updateSignSuggestion();
}

function currentMapping() {
  return {
    dateIdx: Number(mapDate.value),
    descIdx: Number(mapDesc.value),
    amountIdx: Number(mapAmount.value),
    creditIdx: Number(mapCredit.value),
    categoryIdx: Number(mapCategory.value),
    sign: mapSign.value,
  };
}

// Die Spaltenwahl gilt für das erste Blatt; weitere Blätter werden über gleichlautende Titel
// zugeordnet und fallen sonst auf ihre eigene automatische Erkennung zurück.
function mappingForTable(table, primary, mapping) {
  if (table === primary) return { ...mapping, typeIdx: table.typeIdx };
  const byHeader = (idx, fallback) => {
    if (idx === -1) return -1;
    const name = String(primary.headers[idx] || '').toLowerCase();
    const found = table.headers.findIndex(h => String(h || '').toLowerCase() === name);
    return found !== -1 ? found : fallback;
  };
  return {
    dateIdx: byHeader(mapping.dateIdx, table.dateIdx),
    descIdx: byHeader(mapping.descIdx, table.descIdx),
    amountIdx: byHeader(mapping.amountIdx, table.amountIdx),
    creditIdx: byHeader(mapping.creditIdx, table.creditIdx),
    categoryIdx: byHeader(mapping.categoryIdx, table.categoryIdx),
    typeIdx: table.typeIdx,
    sign: mapping.sign,
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function buildRowsForDetailTable(table, m) {
  const dataRows = table.rows.slice(table.headerRowIndex + 1).filter(r => (r || []).some(c => c !== '' && c != null));
  const parsed = dataRows.map((row, fileIndex) => {
    const date = m.dateIdx !== -1 ? toIsoDate(row[m.dateIdx]) : null;
    const description = m.descIdx !== -1 ? String(row[m.descIdx] ?? '').trim() : '';
    const debit = m.amountIdx !== -1 ? parseAmount(row[m.amountIdx]) : null;
    const credit = m.creditIdx !== -1 ? parseAmount(row[m.creditIdx]) : null;
    let amount = null;
    let type = null;

    if (m.creditIdx !== -1) {
      // Getrennte Spalten: Belastung = Ausgabe, Gutschrift = Einnahme.
      if (debit !== null && debit !== 0) { amount = Math.abs(debit); type = TX_EXPENSE; }
      else if (credit !== null && credit !== 0) { amount = Math.abs(credit); type = TX_INCOME; }
    } else if (debit !== null && debit !== 0) {
      amount = Math.abs(debit);
      if (m.sign === 'negative') type = debit < 0 ? TX_EXPENSE : TX_INCOME;
      else if (m.sign === 'positive') type = debit > 0 ? TX_EXPENSE : TX_INCOME;
      else if (m.sign === 'all_income') type = TX_INCOME;
      else type = TX_EXPENSE;
    }

    // Eine ausdrückliche Typ-Spalte (z. B. aus dem eigenen Export) hat Vorrang.
    if (m.typeIdx !== -1 && amount !== null) {
      const tv = String(row[m.typeIdx] ?? '').toLowerCase();
      if (/gutschrift|einnahme|income|credit/.test(tv)) type = TX_INCOME;
      else if (/ausgabe|belastung|expense|debit/.test(tv)) type = TX_EXPENSE;
    }

    const fileCategoryRaw = m.categoryIdx !== -1 ? String(row[m.categoryIdx] ?? '').trim() : '';
    const valid = !!(date && description && amount !== null && amount > 0 && type);
    return { date, description, amount: valid ? round2(amount) : null, type, fileCategoryRaw, valid, fileIndex };
  });

  // Bankexporte listen meist das Neueste zuoberst → dann rückwärts durchnummerieren,
  // damit Buchungen desselben Tages chronologisch bleiben.
  const validRows = parsed.filter(r => r.valid);
  const descending = validRows.length > 1 && validRows[0].date > validRows[validRows.length - 1].date;
  const n = parsed.length;
  parsed.forEach(r => { r.seq = descending ? (n - 1 - r.fileIndex) : r.fileIndex; });
  return parsed;
}

const SUMMARY_SKIP_LABELS = /^(gesamt|total|summe|ausgaben|einnahmen|differenz|saldo|kategorie)/;

function buildRowsForSummaryTable(table) {
  const month = table.month;
  const amountIdx = table.amountIdx !== -1 ? table.amountIdx : table.creditIdx;
  const dataRows = table.rows.slice(table.headerRowIndex + 1);
  return dataRows.map((row, i) => {
    const label = String((row || [])[table.categoryIdx] ?? '').trim();
    const amount = parseAmount((row || [])[amountIdx]);
    const skip = !label || SUMMARY_SKIP_LABELS.test(label.toLowerCase());
    const valid = !!(month && !skip && amount !== null && amount > 0);
    return {
      date: month ? `${month}-01` : null,
      description: `Monatssumme ${label}`,
      amount: valid ? round2(amount) : null,
      type: TX_EXPENSE,
      fileCategoryRaw: label,
      valid,
      seq: i,
      summary: true,
    };
  });
}

function buildImportRows() {
  if (!importTables.length) return [];
  const primary = importTables[0];
  const mapping = primary.kind === 'summary' ? null : currentMapping();
  const rows = [];
  importTables.forEach((table, ti) => {
    const tableRows = table.kind === 'summary'
      ? buildRowsForSummaryTable(table)
      : buildRowsForDetailTable(table, mappingForTable(table, primary, mapping));
    tableRows.forEach(r => {
      r.seq = ti * 1e6 + r.seq;
      r.sheetName = table.sheetName;
      rows.push(r);
    });
  });
  return rows;
}

function renderImportSheetsInfo(rows) {
  const el = document.getElementById('importSheetsInfo');
  if (importTables.length <= 1 && !importSkippedSheets.length) { el.hidden = true; return; }
  const parts = importTables.map(t => {
    const count = rows.filter(r => r.valid && r.sheetName === t.sheetName).length;
    if (t.kind === 'summary') return `${t.sheetName} (${t.month ? count + ' Summen' : 'kein Monat erkannt'})`;
    return `${t.sheetName} (${count})`;
  });
  let text = `${importTables.length} Tabellenblätter erkannt: ${parts.join(', ')}`;
  if (importSkippedSheets.length) text += ` · übersprungen: ${importSkippedSheets.join(', ')}`;
  el.textContent = text;
  el.hidden = false;
}

const TYPE_LABEL = { [TX_EXPENSE]: 'Ausgabe', [TX_INCOME]: 'Gutschrift' };

function renderImportPreview() {
  const rows = buildImportRows();
  const validRows = rows.filter(r => r.valid).sort(compareChronological);
  const summary = document.getElementById('importSummary');
  const confirmBtn = document.getElementById('importConfirmBtn');
  renderImportSheetsInfo(rows);

  const resolved = validRows.map(r => ({ ...r, ...resolveRowCategory(r) }));
  const expenses = resolved.filter(r => r.type === TX_EXPENSE).length;
  const incomes = resolved.length - expenses;
  const fromFile = resolved.filter(r => r.fromFile).length;
  const toReview = resolved.filter(r => !r.certain).length;
  const unknownNames = Array.from(new Set(resolved.filter(r => r.unknownName).map(r => r.unknownName)));

  if (!validRows.length) {
    summary.textContent = `0 von ${rows.length} Zeilen erkannt. Prüfe die Spalten-Zuordnung oben.`;
    summary.classList.add('import-summary-warning');
    confirmBtn.disabled = true;
  } else {
    const parts = [`${plural(expenses, 'Ausgabe', 'Ausgaben')} und ${plural(incomes, 'Gutschrift', 'Gutschriften')} erkannt (${rows.length} Zeilen)`];
    if (fromFile) parts.push(`${fromFile} Kategorien aus der Datei übernommen`);
    parts.push(toReview ? `${toReview} zu prüfen` : 'nichts zu prüfen');
    if (unknownNames.length) parts.push(`unbekannte Kategorien: ${unknownNames.slice(0, 5).join(', ')}${unknownNames.length > 5 ? ', …' : ''}`);
    summary.textContent = parts.join(' · ');
    summary.classList.toggle('import-summary-warning', unknownNames.length > 0);
    confirmBtn.disabled = false;
  }

  const body = document.getElementById('importPreviewBody');
  body.innerHTML = '';
  const previewRows = resolved.length ? resolved.slice(0, 12) : rows.slice(0, 12);
  previewRows.forEach(r => {
    const tr = document.createElement('tr');
    if (!r.valid) tr.style.opacity = '0.4';
    tr.innerHTML = `
      <td>${r.date ? formatDate(r.date) : '–'}</td>
      <td>${escapeHtml(r.description || '–')}</td>
      <td>${r.type ? TYPE_LABEL[r.type] : '–'}</td>
      <td>${r.amount !== null ? formatCurrency(r.amount) : '–'}</td>
      <td>${r.category ? escapeHtml(r.category) : '–'}${r.valid && !r.certain ? ' ⚠' : ''}</td>
    `;
    body.appendChild(tr);
  });
}

[mapDate, mapDesc, mapCategory, mapSign].forEach(select => {
  select.addEventListener('change', renderImportPreview);
});
[mapAmount, mapCredit].forEach(select => {
  select.addEventListener('change', () => {
    updateSignSuggestion();
    renderImportPreview();
  });
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

function collectTablesFromWorkbook(workbook, fileName) {
  const tables = [];
  const skipped = [];
  workbook.SheetNames.forEach(name => {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: '' });
    const table = rows.length ? detectTable(rows, name) : null;
    if (!table) { skipped.push(name); return; }
    if (table.kind === 'summary') table.month = resolveSummaryMonth(name, fileName);
    tables.push(table);
  });
  // Einzelbuchungen haben Vorrang vor blossen Monatssummen, sonst würde doppelt gezählt.
  const detail = tables.filter(t => t.kind === 'detail');
  if (detail.length) {
    tables.filter(t => t.kind === 'summary').forEach(t => skipped.push(t.sheetName));
    return { tables: detail, skipped };
  }
  return { tables, skipped };
}

function handleImportTables({ tables, skipped }) {
  if (!tables.length) {
    showToast('Keine passende Tabelle gefunden (Datum, Beschreibung und Betrag werden benötigt).');
    return;
  }
  importTables = tables;
  importSkippedSheets = skipped;
  const primary = tables[0];
  document.getElementById('importMapping').hidden = primary.kind === 'summary';
  if (primary.kind !== 'summary') populateMappingSelects(primary);
  renderImportPreview();
  importDialog.showModal();
}

fileInput.addEventListener('change', async () => {
  const file = fileInput.files[0];
  if (!file) return;
  currentImportFileName = file.name;
  const isCsv = /\.csv$/i.test(file.name);

  // Für Excel-Dateien und für Datums-Zahlen in CSVs wird die Tabellen-Bibliothek gebraucht.
  try {
    await ensureXlsx();
  } catch {
    showToast('Die Excel-Funktion konnte nicht geladen werden. Bitte einmal online öffnen.');
    fileInput.value = '';
    return;
  }

  const reader = new FileReader();

  reader.onerror = () => showToast('Datei konnte nicht gelesen werden.');

  reader.onload = (e) => {
    try {
      if (isCsv) {
        const rows = parseCsvText(e.target.result);
        if (!rows.length) { showToast('Datei enthält keine Daten.'); return; }
        handleImportTables({ tables: [detectTable(rows, file.name) || fallbackTable(rows, file.name)], skipped: [] });
      } else {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        if (!workbook.SheetNames.length) {
          showToast('Keine Tabelle in der Datei gefunden.');
          return;
        }
        const result = collectTablesFromWorkbook(workbook, file.name);
        if (!result.tables.length) {
          const firstName = workbook.SheetNames[0];
          const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstName], { header: 1, raw: true, defval: '' });
          if (!rows.length) { showToast('Datei enthält keine Daten.'); return; }
          result.tables = [fallbackTable(rows, firstName)];
          result.skipped = workbook.SheetNames.slice(1);
        }
        handleImportTables(result);
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
  // Chronologisch verarbeiten, damit „x-mal hintereinander gleich zugeordnet“ auch der Reihe nach zählt.
  const rows = buildImportRows().filter(r => r.valid).sort(compareChronological);
  const sessionCounts = new Map();
  const newUncertainIds = [];
  let added = 0, skipped = 0;

  rows.forEach(r => {
    const keyBase = `${r.date}|${r.description}|${r.amount.toFixed(2)}${r.type === TX_INCOME ? '|+' : ''}`;
    const localIndex = sessionCounts.get(keyBase) || 0;
    sessionCounts.set(keyBase, localIndex + 1);
    const id = `${keyBase}#${localIndex}`;

    if (transactions.some(t => t.id === id)) {
      skipped++;
      return;
    }

    const res = resolveRowCategory(r);
    transactions.push({
      id, date: r.date, description: r.description, amount: r.amount, type: r.type,
      category: res.category, uncertain: !res.certain, reason: res.reason, streak: res.streak,
      seq: r.seq, source: r.summary ? 'summary' : 'import',
    });
    if (!res.certain) newUncertainIds.push(id);

    if (res.fromFile && !r.summary) {
      // Zuordnungen aus der Datei sind verlässlich → sie zählen wie eine Bestätigung von Hand.
      learnPattern(r.description, r.amount, res.category);
    } else if (res.patternKey && (res.reason === 'pattern' || res.reason === 'pattern_probation')) {
      countPatternAutoAssignment(res.patternKey);
    }
    added++;
  });

  savePatterns();
  saveTransactions();

  if (currentImportFileName) {
    const monthsTouched = new Set(rows.map(r => r.date.slice(0, 7)));
    monthsTouched.forEach(m => {
      importLog[m] = { filename: currentImportFileName, importedAt: Date.now() };
    });
    saveImportLog();
  }

  importDialog.close();
  if (rows.length) currentMonth = rows[rows.length - 1].date.slice(0, 7);
  render();
  renderPatternsList();
  showToast(`${plural(added, 'Eintrag', 'Einträge')} importiert, ${skipped} bereits vorhanden.`);
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
    row.className = 'review-row' + (isUrgent(t) ? ' is-urgent' : '');
    row.innerHTML = `
      <div class="tx-info">
        <span class="tx-desc">${escapeHtml(t.description)}</span>
        <span class="tx-meta">${formatDate(t.date)} · ${isIncome(t) ? '+ ' : ''}${formatCurrency(t.amount)}${isIncome(t) ? ' (Gutschrift)' : ''} · ${escapeHtml(reviewReasonText(t))}</span>
      </div>
      <select class="tx-category-select" data-id="${escapeAttr(t.id)}" aria-label="Kategorie für ${escapeAttr(t.description)}">${buildCategoryOptions(t.category, t.type)}</select>
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
      const note = updated > 0 ? ` ${plural(updated, 'bestehende unsichere Ausgabe wurde', 'bestehende unsichere Ausgaben wurden')} entsprechend aktualisiert.` : '';
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
      <button type="button" class="teach-rule-remove" data-keyword="${escapeAttr(kw)}" aria-label="Regel für ${escapeAttr(kw)} löschen">✕</button>
    </span>
  `).join('') : '<p class="empty-state">Noch keine eigenen Regeln gelernt.</p>';
}

// Liste der still gelernten Muster. Text+Betrag-Varianten werden nur gezeigt, wenn es keinen
// reinen Text-Eintrag dazu gibt (sonst stünde jeder Händler doppelt drin).
function visiblePatternEntries() {
  return Object.entries(patterns)
    .filter(([key]) => {
      if (!key.startsWith('da:')) return true;
      const base = key.slice(3, key.lastIndexOf('|'));
      return !patterns[`d:${base}`];
    })
    .sort((a, b) => (b[1].streak - a[1].streak) || (b[1].updatedAt - a[1].updatedAt))
    .slice(0, 60);
}

function renderPatternsList() {
  const list = document.getElementById('patternsList');
  const entries = visiblePatternEntries();
  document.getElementById('patternCount').textContent = entries.length;
  list.innerHTML = entries.length ? entries.map(([key, p]) => {
    const trusted = isTrustedPattern(p);
    const status = trusted ? `${p.streak}× · automatisch` : `${p.streak}/${PATTERN_AUTO_THRESHOLD}`;
    return `
      <span class="teach-rule-chip${trusted ? ' is-trusted' : ''}">
        <span class="teach-rule-dot" style="background:${categoryColor(p.category)}"></span>
        <span class="teach-rule-kw">${escapeHtml(p.label || key)}</span> → <span class="teach-rule-cat">${escapeHtml(p.category)}</span>
        <span class="teach-rule-count">(${status})</span>
        <button type="button" class="teach-rule-remove" data-pattern-key="${escapeAttr(key)}" aria-label="Muster ${escapeAttr(p.label || key)} vergessen">✕</button>
      </span>
    `;
  }).join('') : '<p class="empty-state">Noch keine Muster gelernt — sie entstehen beim Zuordnen in den Karten oder Listen.</p>';
}

document.getElementById('patternsList').addEventListener('click', (e) => {
  const btn = e.target.closest('.teach-rule-remove');
  if (!btn) return;
  forgetPattern(btn.dataset.patternKey);
  renderPatternsList();
  showToast('Muster vergessen.');
});

const TEACH_WELCOME_MESSAGE = 'Hallo! Ich bin kein echter KI-Chat, sondern ein einfacher Lern-Assistent: Ich merke mir feste Regeln wie „Aldi ist Verpflegung“ und wende sie danach automatisch an. Zusätzlich lernt die App aus deinen Zuordnungen: Ab fünf gleichen Zuordnungen hintereinander ordnet sie selbst zu – die ersten Male noch mit Rückfrage in den Karten.';

if (!teachChatHistory.length) appendChatMessage('bot', TEACH_WELCOME_MESSAGE);
else renderTeachChatLogFromHistory();
renderTeachRulesList();
renderPatternsList();

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

// ---- Monatliche Erinnerung ---------------------------------------------------
// Erscheint einmal pro Kalendermonat, beim ersten Öffnen der App im neuen Monat.
const REMINDER_MONTH_KEY = 'budget_reminder_month';
const LAST_BACKUP_KEY = 'budget_last_backup';

const MONTHLY_QUOTES = [
  'Ein neuer Monat. Dein Konto hat Neuigkeiten.',
  'Der letzte Monat ist abgerechnet — willst du wissen, wie er ausgegangen ist?',
  'Zahlen lügen nicht. Aber sie schweigen, solange du sie nicht fragst.',
  'Wer weiss, wohin sein Geld geht, muss es nicht suchen.',
  'Auszug holen, hochladen, durchwischen. Geht schneller als ein Kaffee.',
  'Sparen fängt nicht beim Verzichten an, sondern beim Hinschauen.',
  'Ein Monat ohne Überblick ist ein Monat im Blindflug.',
  'Der beste Zeitpunkt war der Erste. Der zweitbeste ist jetzt.',
  'Dein Geld war einen Monat lang unterwegs. Zeit für den Reisebericht.',
  'Backup gemacht, Auszug geladen, Kopf frei.',
  'Ein Budget ist kein Verbot. Es ist Wissen.',
  'Kleine Beträge sind wie Krümel: Man sieht sie erst, wenn man auf den Boden schaut.',
];

// Fest pro Monat gewählt, damit der Spruch beim Neuladen derselbe bleibt.
function monthlyQuote(monthStr) {
  const [y, m] = monthStr.split('-').map(Number);
  return MONTHLY_QUOTES[(y * 12 + m) % MONTHLY_QUOTES.length];
}

function parseBackupDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(isoDate || ''));
  if (!m) return Date.now();
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime();
}

function getLastBackupTime() {
  try {
    const n = Number(localStorage.getItem(LAST_BACKUP_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch { return null; }
}

function setLastBackupTime(ts) {
  try { localStorage.setItem(LAST_BACKUP_KEY, String(ts || Date.now())); } catch {}
}

function daysSince(ts) {
  return Math.floor((Date.now() - ts) / 86400000);
}

function formatDaysAgo(ts) {
  const d = daysSince(ts);
  if (d <= 0) return 'heute';
  if (d === 1) return 'gestern';
  return `vor ${d} Tagen`;
}

// Dauerhaft sichtbarer Hinweis im Reiter „Assistent“, wie alt das letzte Backup ist.
function renderBackupStatus() {
  const el = document.getElementById('backupStatus');
  const ts = getLastBackupTime();
  if (!ts) {
    el.textContent = transactions.length
      ? 'Noch nie ein Backup gespeichert.'
      : 'Noch keine Daten vorhanden.';
    el.className = 'backup-status' + (transactions.length ? ' status-critical' : '');
    return;
  }
  const d = daysSince(ts);
  const level = d > 45 ? 'critical' : d > 20 ? 'warning' : 'good';
  el.textContent = `Letztes Backup: ${formatDaysAgo(ts)}.`;
  el.className = `backup-status status-${level}`;
}

function buildReminderChecklist(previousMonth) {
  const items = [];

  const backupTs = getLastBackupTime();
  if (!backupTs) {
    items.push({ level: 'critical', text: 'Noch nie ein Backup gespeichert.' });
  } else {
    const d = daysSince(backupTs);
    items.push({
      level: d > 45 ? 'critical' : d > 20 ? 'warning' : 'good',
      text: `Letztes Backup: ${formatDaysAgo(backupTs)}.`,
    });
  }

  const entry = importLog[previousMonth];
  items.push(entry
    ? { level: 'good', text: `${formatMonthLabel(previousMonth)}: importiert aus ${entry.filename}.` }
    : { level: 'warning', text: `${formatMonthLabel(previousMonth)}: noch keine Datei importiert.` });

  const open = getReviewQueue().length;
  if (open) items.push({ level: 'warning', text: `${plural(open, 'Eintrag wartet', 'Einträge warten')} auf deine Zuordnung.` });

  return items;
}

const monthlyReminderDialog = document.getElementById('monthlyReminderDialog');

function renderReminderChecklist(previousMonth) {
  document.getElementById('reminderChecklist').innerHTML = buildReminderChecklist(previousMonth).map(item => `
    <div class="reminder-item status-${item.level}">
      <span class="reminder-item-icon">${GOAL_ICONS[item.level]}</span>
      <span>${escapeHtml(item.text)}</span>
    </div>
  `).join('');
}

function openMonthlyReminder(monthStr) {
  const previousMonth = shiftMonth(monthStr, -1);
  document.getElementById('reminderKicker').textContent = `${formatMonthLabel(monthStr)} — neuer Monat`;
  document.getElementById('reminderQuote').textContent = monthlyQuote(monthStr);
  renderReminderChecklist(previousMonth);
  monthlyReminderDialog.dataset.previousMonth = previousMonth;
  monthlyReminderDialog.showModal();
}

function maybeShowMonthlyReminder() {
  if (!transactions.length) return;          // Frische Installation nicht gleich vollquatschen.
  const nowMonth = monthStrOf(new Date());
  let stored = null;
  try { stored = localStorage.getItem(REMINDER_MONTH_KEY); } catch {}
  if (stored === nowMonth) return;
  try { localStorage.setItem(REMINDER_MONTH_KEY, nowMonth); } catch {}
  openMonthlyReminder(nowMonth);
}

document.getElementById('reminderBackupBtn').addEventListener('click', () => {
  exportBackup();
  renderReminderChecklist(monthlyReminderDialog.dataset.previousMonth);
});

document.getElementById('reminderImportBtn').addEventListener('click', () => {
  monthlyReminderDialog.close();
  setActiveTab('panel-transactions');
  document.getElementById('fileInput').click();
});

document.getElementById('reminderCloseBtn').addEventListener('click', () => monthlyReminderDialog.close());

function exportBackup() {
  const data = {
    version: 1,
    exportedAt: localIsoDate(new Date()),
    transactions,
    goals,
    learnedRules,
    patterns,
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
  setLastBackupTime(Date.now());
  showToast('Backup heruntergeladen.');
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = async (e) => {
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
    const ok = await askConfirm({
      title: 'Backup einspielen?',
      text: `Alle Daten in diesem Browser werden durch das Backup vom ${formatDate(data.exportedAt) || 'unbekannten Datum'} ersetzt (${plural(data.transactions.length, 'Eintrag', 'Einträge')}).`,
      confirmLabel: 'Ersetzen',
    });
    if (!ok) return;

    transactions = migrateTransactions(data.transactions);
    goals = data.goals && typeof data.goals === 'object' ? data.goals : { overall: null, categories: {} };
    learnedRules = data.learnedRules && typeof data.learnedRules === 'object' ? data.learnedRules : {};
    patterns = data.patterns && typeof data.patterns === 'object' ? data.patterns : {};
    importLog = data.importLog && typeof data.importLog === 'object' ? data.importLog : {};
    teachChatHistory = Array.isArray(data.teachChatHistory) ? data.teachChatHistory : [];
    categorizationLog = Array.isArray(data.categorizationLog) ? data.categorizationLog : [];

    saveTransactions();
    saveGoals();
    saveLearnedRules();
    savePatterns();
    saveImportLog();
    saveTeachChat();
    saveCategorizationLog();

    // Nach dem Wiederherstellen liegen die Daten nachweislich in dieser Datei – das zählt als Backup.
    setLastBackupTime(parseBackupDate(data.exportedAt));

    currentMonth = monthStrOf(new Date());
    render();
    renderTeachRulesList();
    renderPatternsList();
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

// Neue Version im Hintergrund: einmalig Bescheid geben statt still zu bleiben.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const fresh = reg.installing;
        if (!fresh) return;
        fresh.addEventListener('statechange', () => {
          if (fresh.state === 'installed' && navigator.serviceWorker.controller) {
            showToast('Neue Version verfügbar — App neu laden.');
          }
        });
      });
    }).catch(() => {});
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

function setActiveTab(panelId, options = {}) {
  const panel = document.getElementById(panelId);
  const changed = panel && panel.hidden;

  tabButtons.forEach(btn => {
    const isActive = btn.dataset.panel === panelId;
    document.getElementById(btn.dataset.panel).hidden = !isActive;
    btn.setAttribute('aria-selected', String(isActive));
    btn.tabIndex = isActive ? 0 : -1;
  });
  try { localStorage.setItem(TAB_STORAGE_KEY, panelId); } catch {}

  // Der Inhalt fährt beim Wechsel sanft ein; die Klasse entfernt sich danach selbst.
  if (panel && changed && options.animate !== false) {
    panel.classList.remove('is-entering');
    void panel.offsetWidth;
    panel.classList.add('is-entering');
    clearTimeout(setActiveTab._t);
    setActiveTab._t = setTimeout(() => panel.classList.remove('is-entering'), 900);
    if (options.scroll !== false) window.scrollTo({ top: 0, behavior: 'smooth' });
  }
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

// Die Reiterleiste klebt am Laptop direkt unter der Kopfzeile – deren Höhe messen wir live.
const topbarEl = document.querySelector('.app-topbar');

function syncTopbarHeight() {
  document.documentElement.style.setProperty('--topbar-h', `${Math.round(topbarEl.offsetHeight)}px`);
}

if (typeof ResizeObserver === 'function') {
  new ResizeObserver(syncTopbarHeight).observe(topbarEl);
} else {
  window.addEventListener('resize', syncTopbarHeight);
}
syncTopbarHeight();

document.getElementById('welcomeImportBtn').addEventListener('click', () => {
  setActiveTab('panel-transactions');
  document.getElementById('fileInput').click();
});

const startTab = loadActiveTab();
setActiveTab(startTab, { animate: false });

render();

// Auch der zuerst sichtbare Reiter fährt einmal sanft ein.
const startPanel = document.getElementById(startTab);
startPanel.classList.add('is-entering');
setTimeout(() => startPanel.classList.remove('is-entering'), 1000);

// Startbildschirm erst ausblenden, wenn der erste Inhalt wirklich gezeichnet ist.
function hideSplash() {
  const splash = document.getElementById('splash');
  if (!splash || splash.classList.contains('is-hidden')) return;
  splash.classList.add('is-hidden');
  setTimeout(() => splash.remove(), 600);
}

if (document.fonts && document.fonts.ready) {
  // Kurzer Mindestmoment, damit das Logo nicht aufblitzt und sofort verschwindet.
  Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1200))])
    .then(() => setTimeout(hideSplash, 260));
} else {
  setTimeout(hideSplash, 500);
}
window.addEventListener('load', () => setTimeout(hideSplash, 1500));

maybeShowMonthlyReminder();
