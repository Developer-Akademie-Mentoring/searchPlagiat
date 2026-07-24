// ── Review step ───────────────────────────────────────────────────────────────

/**
 * @param {{name: string, file: string}} item - extracted function to review
 * @param {string} attr - data attribute marking the checkbox as a function selector
 * @returns {string} HTML markup for one checkbox row
 */
function buildReviewCheckbox(item, attr) {
  const file = item.file ? `<span class="review__file">${escapeHtml(item.file)}</span>` : '';
  return `
    <label class="review__item">
      <input type="checkbox" ${attr} value="${escapeHtml(item.name)}" checked>
      <code class="result-card__tag">${escapeHtml(item.name)}</code>
      ${file}
    </label>
  `;
}

/**
 * @param {string} title - group heading (e.g. "Funktionen")
 * @param {object[]} items - extracted items to list as checkboxes
 * @param {string} attr - data attribute marking checkboxes in this group
 * @returns {string} HTML block for the group, or empty string if there are no items
 */
function buildReviewGroup(title, items, attr) {
  if (!items || items.length === 0) return '';
  const rows = items.map(i => buildReviewCheckbox(i, attr)).join('');
  return `<div class="review__group"><h3 class="review__group-title">${escapeHtml(title)}</h3>${rows}</div>`;
}

/**
 * @param {object[]} functions - extracted humanlike functions
 * @returns {string} HTML markup for the full review panel
 */
function buildReviewPanel(functions) {
  return `
    <div class="review__panel">
      <h2 class="review__title">Gefundene Namen prüfen</h2>
      <p class="review__hint">Wähle ab, was nicht durchsucht werden soll, und ergänze bei Bedarf weitere Funktionsnamen.</p>
      <p class="review__tip">
        <strong>Tipp:</strong> Je weniger Funktionen gesucht werden, desto unwahrscheinlicher findet man ein Ergebnis.
        Suche lieber nach vielen Funktionen.
      </p>
      ${buildReviewGroup('Funktionen', functions, 'data-review-fn')}
      <div class="review__group">
        <h3 class="review__group-title">Weitere Funktionen hinzufügen</h3>
        <div class="review__manual-list" id="reviewManualList"></div>
        <button type="button" class="review__add-btn" id="reviewAddBtn"><span class="icon icon--add"></span> Funktion hinzufügen</button>
      </div>
      <button type="button" class="review__start-btn" id="reviewStartBtn">Jetzt suchen</button>
    </div>
  `;
}

/** Appends one more empty text input for a manually added function name */
function addManualFunctionInput() {
  const list = document.getElementById('reviewManualList');
  const row = document.createElement('div');
  row.className = 'review__manual-row';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'review__manual-input';
  input.placeholder = 'Funktionsname';
  row.appendChild(input);
  list.appendChild(row);
  input.focus();
}

/**
 * @param {object[]} items - extracted items to filter
 * @param {string} attr - data attribute marking this group's checkboxes
 * @returns {object[]} items whose checkbox is still checked
 */
function filterSelectedReviewItems(items, attr) {
  const checkedNames = [...document.querySelectorAll(`[${attr}]:checked`)].map(cb => cb.value);
  return items.filter(item => checkedNames.includes(item.name));
}

/**
 * @returns {string[]} non-empty, de-duplicated function names typed into the manual inputs
 */
function getManualFunctionNames() {
  const seen = new Set();
  const names = [];
  for (const input of document.querySelectorAll('.review__manual-input')) {
    const name = input.value.trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

/**
 * @param {object[]} functions - extracted humanlike functions
 * @returns {object[]} final search items, manually added functions first so they run before rate limits can cut the search short, followed by the selected checkboxes
 */
function buildSearchItemsFromReview(functions) {
  const selectedFunctions = filterSelectedReviewItems(functions, 'data-review-fn').map(f => ({ ...f, kind: 'function' }));
  const existingNames = new Set(selectedFunctions.map(f => f.name));
  const manualFunctions = getManualFunctionNames()
    .filter(name => !existingNames.has(name))
    .map(name => ({ name, kind: 'function' }));
  return [...manualFunctions, ...selectedFunctions];
}

/**
 * @param {object[]} functions - extracted humanlike functions
 * @param {{owner: string, repo: string}} parsed - parsed repo owner and name
 * @param {string} token - personal access token
 */
async function beginSearchFromReview(functions, parsed, token) {
  const searchItems = buildSearchItemsFromReview(functions);
  if (searchItems.length === 0) {
    showError('Bitte mindestens einen Namen auswählen oder hinzufügen.');
    return;
  }
  reviewSection.innerHTML = '';
  searchBtn.disabled = true;
  const repoId = `${parsed.owner}/${parsed.repo}`;
  const repoMatches = new Map();
  lastSearchContext = { repoMatches, searchItems, token, checkedRepoIds: new Set() };
  const completed = await runSearch(searchItems, repoId, token, 0, repoMatches);
  if (completed) {
    showResults(sortedResults(repoMatches), searchItems);
  }
  searchBtn.disabled = false;
}

/**
 * @param {object[]} functions - extracted humanlike functions
 * @param {{owner: string, repo: string}} parsed - parsed repo owner and name
 * @param {string} token - personal access token
 */
function showReviewStep(functions, parsed, token) {
  reviewSection.innerHTML = buildReviewPanel(functions);
  document.getElementById('reviewAddBtn').addEventListener('click', addManualFunctionInput);
  document.getElementById('reviewStartBtn').addEventListener('click', () => beginSearchFromReview(functions, parsed, token));
}
