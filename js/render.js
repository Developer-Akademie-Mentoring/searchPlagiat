// ── Display ───────────────────────────────────────────────────────────────────

/**
 * @param {string} str - raw string to escape for safe HTML output
 * @returns {string}
 */
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * @param {object[]} searchItems - items searched in the source repo
 * @param {string} name - function name to look up
 * @returns {object|undefined} the matching source item, if any
 */
function findSourceFunctionItem(searchItems, name) {
  return searchItems.find(i => i.kind === 'function' && i.name === name);
}

/**
 * @param {string} repoId - "owner/repo" of the matched (found) repo
 * @param {{name: string, path: string}} match - matched function name and its file path in the found repo
 * @param {object[]} searchItems - items searched in the source repo, used to look up the source definition
 * @returns {string} HTML markup for one expandable function-comparison row
 */
function buildFunctionMatchRow(repoId, match, searchItems) {
  const sourceItem = findSourceFunctionItem(searchItems, match.name);
  const sourceCode = sourceItem && sourceItem.body ? formatCode(sourceItem.body) : '(Quellcode nicht verfügbar)';
  return `
    <div class="function-match">
      <button class="accordion__toggle function-match__toggle" type="button" aria-expanded="false"
        data-function-toggle data-repo="${escapeHtml(repoId)}" data-path="${escapeHtml(match.path)}" data-name="${escapeHtml(match.name)}">
        <span><code class="result-card__tag">${escapeHtml(match.name)}</code></span>
        <span class="accordion__icon icon icon--expand-more"></span>
      </button>
      <div class="accordion__content function-match__content">
        <p class="function-match__label">Quellcode im geprüften Repo:</p>
        <pre class="function-match__code"><code>${escapeHtml(sourceCode)}</code></pre>
        <p class="function-match__label">Quellcode im gefundenen Repo:</p>
        <pre class="function-match__code" data-found-code>Lädt…</pre>
      </div>
    </div>
  `;
}

/**
 * @param {string} repoId - "owner/repo" of the matched (found) repo
 * @param {Array<{name: string, path: string}>} functions - matched functions for this repo
 * @param {object[]} searchItems - items searched in the source repo
 * @returns {string} HTML block listing all function matches, or empty string if there are none
 */
function buildFunctionMatchesSection(repoId, functions, searchItems) {
  if (!functions || functions.length === 0) return '';
  const rows = functions.map(f => buildFunctionMatchRow(repoId, f, searchItems)).join('');
  return `<div class="result-card__functions"><p class="result-card__reason"><strong>${functions.length} übereinstimmende Funktionen:</strong></p>${rows}</div>`;
}

/**
 * @param {string} repoId - "owner/repo" of the repo being checked
 * @param {object} item - the unmatched search item (function) from the source repo
 * @returns {string} HTML for one expandable row showing the source code, with the found-repo side loaded on demand
 */
function buildUnmatchedFunctionRow(repoId, item) {
  const sourceCode = item.body ? formatCode(item.body) : '(Quellcode nicht verfügbar)';
  return `
    <div class="function-match">
      <button class="accordion__toggle function-match__toggle" type="button" aria-expanded="false"
        data-unmatched-function-toggle data-repo="${escapeHtml(repoId)}" data-name="${escapeHtml(item.name)}">
        <span><code class="result-card__tag">${escapeHtml(item.name)}</code></span>
        <span class="accordion__icon icon icon--expand-more"></span>
      </button>
      <div class="accordion__content function-match__content">
        <p class="function-match__label">Quellcode im geprüften Repo:</p>
        <pre class="function-match__code"><code>${escapeHtml(sourceCode)}</code></pre>
        <p class="function-match__label">Code im gefundenen Repo:</p>
        <pre class="function-match__code" data-unmatched-found-code>Noch nicht geprüft – zum Suchen aufklappen</pre>
      </div>
    </div>
  `;
}

/**
 * @param {{functions: string[]}} unmatched - checked function names with no match in this repo
 * @param {string} repoId - "owner/repo" of the repo being checked
 * @param {object[]} searchItems - all items that were checked, used to look up each unmatched function's source code
 * @returns {string} collapsed accordion HTML block, or empty string if there is nothing to show
 */
function buildCardUnmatchedSection(unmatched, repoId, searchItems) {
  if (unmatched.functions.length === 0) return '';
  const functionRows = unmatched.functions
    .map(name => findSourceFunctionItem(searchItems, name))
    .filter(Boolean)
    .map(item => buildUnmatchedFunctionRow(repoId, item))
    .join('');
  return `
    <div class="accordion result-card__unmatched">
      <button class="accordion__toggle" type="button" aria-expanded="false" data-accordion-toggle>
        <span>Geprüft, ohne Treffer in diesem Repo (${unmatched.functions.length})</span>
        <span class="accordion__icon icon icon--expand-more"></span>
      </button>
      <div class="accordion__content">
        ${functionRows}
      </div>
    </div>
  `;
}

/**
 * @param {string} repoId - "owner/repo" string used as the card title link
 * @param {{functions: object[], url: string, description: string}} data - match data
 * @param {number} rank - 1-based position in the result list
 * @param {object[]} searchItems - all items that were checked against this repo
 * @returns {string} HTML markup for a single result card
 */
function buildResultCard(repoId, data, rank, searchItems) {
  const desc = data.description
    ? `<p class="result-card__description">${escapeHtml(data.description)}</p>`
    : '';
  const unmatched = findUnmatchedItems(searchItems, new Map([[repoId, data]]));
  return `
    <article class="result-card">
      <span class="result-card__rank">#${rank}</span>
      <div class="result-card__body">
        <a class="result-card__link" href="${data.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(repoId)}</a>
        ${desc}
        ${buildFunctionMatchesSection(repoId, data.functions, searchItems)}
        ${buildCardUnmatchedSection(unmatched, repoId, searchItems)}
        ${buildDetailCheckSection(repoId, unmatched)}
      </div>
    </article>
  `;
}

/**
 * @param {string} repoId - "owner/repo" of this result card's repo
 * @param {{functions: string[]}} unmatched - names checked but not yet confirmed for this repo
 * @returns {string} HTML for the "Detail Check" button, an already-checked note, or empty string if nothing to check
 */
function buildDetailCheckSection(repoId, unmatched) {
  if (unmatched.functions.length === 0) return '';
  const alreadyChecked = lastSearchContext && lastSearchContext.checkedRepoIds.has(repoId);
  if (alreadyChecked) {
    return '<p class="result-card__detail-status">Bereits detailliert geprüft – keine weiteren Übereinstimmungen gefunden.</p>';
  }
  return `
    <div class="result-card__detail-check">
      <button type="button" class="result-card__detail-btn" data-detail-check data-repo="${escapeHtml(repoId)}">Detail Check</button>
      <p class="result-card__detail-status" data-detail-status></p>
    </div>
  `;
}

/**
 * @param {Array<[string, object]>} matches - sorted [repoId, matchData] pairs to render
 * @param {object[]} searchItems - all items that were searched
 */
function showResults(matches, searchItems) {
  if (matches.length === 0) {
    resultsSection.innerHTML = '<p class="results__empty">Keine ähnlichen Repositories gefunden.</p>';
    return;
  }
  const cards = matches.map(([id, data], i) => buildResultCard(id, data, i + 1, searchItems)).join('');
  resultsSection.innerHTML = `<h2 class="results__title">Ähnliche Repositories (${matches.length})</h2>${cards}`;
}

/**
 * @param {string} msg - error message to display in the results area
 */
function showError(msg) {
  resultsSection.innerHTML = `<p class="results__error">${escapeHtml(msg)}</p>`;
}

/**
 * @param {string} msg - status text to display alongside the loading spinner
 */
function showStatus(msg) {
  resultsSection.innerHTML = `<div class="results__loading"><span class="results__spinner"></span>${escapeHtml(msg)}</div>`;
}
