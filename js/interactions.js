/**
 * @param {HTMLElement} btn - accordion toggle button
 * @param {HTMLElement} content - accordion content panel controlled by btn
 */
function toggleAccordionElement(btn, content) {
  const isOpen = content.classList.contains('accordion__content--open');
  content.classList.toggle('accordion__content--open', !isOpen);
  btn.setAttribute('aria-expanded', String(!isOpen));
  btn.querySelector('.accordion__icon').classList.toggle('accordion__icon--open', !isOpen);
}

/** Toggles the token info accordion between open and closed */
function toggleAccordion() {
  toggleAccordionElement(tokenInfoBtn, tokenInfoContent);
}

/**
 * @param {MouseEvent} e - click event bubbling up from the results section
 */
function handleResultsAccordionClick(e) {
  const btn = e.target.closest('[data-accordion-toggle]');
  if (btn) toggleAccordionElement(btn, btn.nextElementSibling);
}

/**
 * @param {HTMLElement} btn - toggle button holding data-repo/data-path/data-name attributes
 * @param {HTMLElement} content - accordion content panel containing the [data-found-code] element
 */
async function loadFoundFunctionCode(btn, content) {
  content.dataset.loaded = 'true';
  const codeEl = content.querySelector('[data-found-code]');
  const [owner, repo] = btn.dataset.repo.split('/');
  const token = tokenInput.value.trim();
  try {
    const file = await githubFetch(`/repos/${owner}/${repo}/contents/${btn.dataset.path}`, token);
    if (!file.content) throw new Error('Datei zu groß oder nicht lesbar.');
    const code = normalizeCode(atob(file.content.replace(/\n/g, '')));
    const body = extractNamedFunctionBody(code, btn.dataset.name);
    codeEl.textContent = body ? formatCode(body) : '(Funktionskörper konnte nicht extrahiert werden)';
  } catch (e) {
    codeEl.textContent = `Fehler beim Laden: ${e.message}`;
  }
}

/**
 * @param {MouseEvent} e - click event bubbling up from the results section
 */
function handleFunctionToggleClick(e) {
  const btn = e.target.closest('[data-function-toggle]');
  if (!btn) return;
  const content = btn.nextElementSibling;
  toggleAccordionElement(btn, content);
  if (content.classList.contains('accordion__content--open') && !content.dataset.loaded) {
    loadFoundFunctionCode(btn, content);
  }
}

/**
 * @param {HTMLElement} btn - toggle button holding data-repo/data-name attributes (no known path yet)
 * @param {HTMLElement} content - accordion content panel containing the [data-unmatched-found-code] element
 */
async function loadUnmatchedFunctionCode(btn, content) {
  content.dataset.loaded = 'true';
  const codeEl = content.querySelector('[data-unmatched-found-code]');
  const repoId = btn.dataset.repo;
  const name = btn.dataset.name;
  if (!lastSearchContext) return;
  const { repoMatches, searchItems, token } = lastSearchContext;
  const entry = repoMatches.get(repoId);
  const item = findSourceFunctionItem(searchItems, name);
  const onProgress = (current, total) => { codeEl.textContent = `Prüfe Datei ${current}/${total}...`; };
  try {
    const confirmed = await verifyItemsInRepo(repoId, [item], token, onProgress);
    if (confirmed.length === 0) {
      codeEl.textContent = '(Auch bei Prüfung des gesamten Repos kein Treffer gefunden)';
      return;
    }
    const [owner, repo] = repoId.split('/');
    const file = await githubFetch(`/repos/${owner}/${repo}/contents/${confirmed[0].path}`, token);
    if (!file.content) throw new Error('Datei zu groß oder nicht lesbar.');
    const code = normalizeCode(atob(file.content.replace(/\n/g, '')));
    const body = extractNamedFunctionBody(code, name);
    codeEl.textContent = body ? formatCode(body) : '(Funktionskörper konnte nicht extrahiert werden)';
    entry.functions.push({ name: confirmed[0].name, path: confirmed[0].path });
    showResults(sortedResults(repoMatches), searchItems);
  } catch (e) {
    codeEl.textContent = e.message === 'RATE_LIMIT'
      ? 'GitHub Rate-Limit erreicht – bitte kurz warten und erneut versuchen.'
      : `Fehler beim Laden: ${e.message}`;
  }
}

/**
 * @param {MouseEvent} e - click event bubbling up from the results section
 */
function handleUnmatchedFunctionToggleClick(e) {
  const btn = e.target.closest('[data-unmatched-function-toggle]');
  if (!btn) return;
  const content = btn.nextElementSibling;
  toggleAccordionElement(btn, content);
  if (content.classList.contains('accordion__content--open') && !content.dataset.loaded) {
    loadUnmatchedFunctionCode(btn, content);
  }
}

/**
 * @param {MouseEvent} e - click event bubbling up from the results section
 */
function handleDetailCheckClick(e) {
  const btn = e.target.closest('[data-detail-check]');
  if (!btn || !lastSearchContext) return;
  const { repoMatches, searchItems, token } = lastSearchContext;
  const repoId = btn.dataset.repo;
  const entry = repoMatches.get(repoId);
  if (!entry) return;
  const missing = findMissingItemsForRepo(searchItems, entry);
  runDetailCheck(btn, entry, repoId, missing, token);
}

/**
 * @param {HTMLElement} btn - the clicked "Detail Check" button
 * @param {{functions: object[]}} entry - this repo's match data, updated in place
 * @param {string} repoId - "owner/repo" being checked
 * @param {object[]} missing - search items not yet confirmed for this repo
 * @param {string} token - personal access token
 */
async function runDetailCheck(btn, entry, repoId, missing, token) {
  const status = btn.parentElement.querySelector('[data-detail-status]');
  btn.disabled = true;
  btn.innerHTML = '<span class="result-card__detail-spinner"></span>Prüfe...';
  const onProgress = (current, total) => {
    if (status) status.textContent = `Prüfe Datei ${current}/${total}...`;
  };
  try {
    const confirmed = await verifyItemsInRepo(repoId, missing, token, onProgress);
    for (const c of confirmed) {
      entry.functions.push({ name: c.name, path: c.path });
    }
    lastSearchContext.checkedRepoIds.add(repoId);
    showResults(sortedResults(lastSearchContext.repoMatches), lastSearchContext.searchItems);
  } catch (e) {
    btn.disabled = false;
    btn.textContent = 'Detail Check';
    if (status) {
      status.textContent = e.message === 'RATE_LIMIT'
        ? 'GitHub Rate-Limit erreicht – bitte kurz warten und erneut versuchen.'
        : `Fehler: ${e.message}`;
      status.classList.add('result-card__detail-status--error');
    }
  }
}
