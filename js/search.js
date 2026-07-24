const CODE_EXTENSIONS = [
  '.js', '.ts', '.py', '.java', '.php', '.rb', '.go', '.cs', '.cpp', '.vue', '.jsx', '.tsx',
];

// ── Repository analysis ───────────────────────────────────────────────────────

/**
 * @param {{owner: string, repo: string}} parsed - parsed repo owner and name
 * @param {string} token - personal access token
 * @returns {Promise<object[]>} all code file objects from the recursive repo tree, unfiltered by count
 */
async function fetchAllCodeFilePaths(parsed, token) {
  const tree = await githubFetch(
    `/repos/${parsed.owner}/${parsed.repo}/git/trees/HEAD?recursive=1`,
    token
  );
  return (tree.tree || [])
    .filter(f => f.type === 'blob' && CODE_EXTENSIONS.some(ext => f.path.endsWith(ext)));
}

/**
 * @param {{owner: string, repo: string}} parsed - parsed repo owner and name
 * @param {string} token - personal access token
 * @returns {Promise<object[]>} the first 15 code file objects, used for the initial broad repo scan
 */
async function fetchCodeFiles(parsed, token) {
  return (await fetchAllCodeFilePaths(parsed, token)).slice(0, 15);
}

/**
 * @param {string} filePath - repo-relative path of the file to analyze
 * @param {{owner: string, repo: string}} parsed - parsed repo owner and name
 * @param {string} token - personal access token
 * @returns {Promise<object[]>} extracted functions tagged with file path
 */
async function extractFromFile(filePath, parsed, token) {
  const content = await githubFetch(
    `/repos/${parsed.owner}/${parsed.repo}/contents/${filePath}`,
    token
  );
  if (!content.content) return [];
  const code = normalizeCode(atob(content.content.replace(/\n/g, '')));
  return extractFunctionsFromCode(code).map(f => ({ ...f, file: filePath }));
}

/**
 * @param {{owner: string, repo: string}} parsed - parsed repo owner and name
 * @param {string} token - personal access token
 * @returns {Promise<object[]>} the 15 most humanlike functions across all files
 */
async function analyzeRepoFiles(parsed, token) {
  showStatus('Lade Dateistruktur...');
  const codeFiles = await fetchCodeFiles(parsed, token);
  if (codeFiles.length === 0) throw new Error('Keine Code-Dateien im Repository gefunden.');

  const allFunctions = [];
  for (let i = 0; i < codeFiles.length; i++) {
    showStatus(`Analysiere Dateien... (${i + 1}/${codeFiles.length})`);
    try {
      allFunctions.push(...await extractFromFile(codeFiles[i].path, parsed, token));
    } catch (_) { /* skip unreadable files */ }
  }

  const dedupe = arr => [...new Map(arr.map(x => [x.name, x])).values()];
  return dedupe(allFunctions).sort((a, b) => b.score - a.score).slice(0, 15);
}

// ── Plagiarism search ─────────────────────────────────────────────────────────

/**
 * @param {string} name - identifier to search for in GitHub code
 * @param {string} excludeRepo - "owner/repo" to exclude from results
 * @param {string} token - personal access token
 * @returns {Promise<any[]>} matching code search result items
 */
async function searchCodeOnGitHub(name, excludeRepo, token) {
  const q = encodeURIComponent(`"${name}" in:file NOT repo:${excludeRepo}`);
  const data = await githubFetch(`/search/code?q=${q}&per_page=10`, token);
  return data.items || [];
}

/**
 * @param {Map} repoMatches - accumulated match results to sort and cap
 * @returns {Array<[string, object]>} top 10 entries sorted by match score
 */
function sortedResults(repoMatches) {
  return [...repoMatches.entries()]
    .sort((a, b) => b[1].functions.length - a[1].functions.length)
    .slice(0, 10);
}

/**
 * @param {object[]} searchItems - all items that were searched
 * @param {Map} repoMatches - match results to check against (one or more repos)
 * @returns {{functions: string[]}} names with no match in any of the given repos
 */
function findUnmatchedItems(searchItems, repoMatches) {
  const matchedNames = new Set();
  for (const entry of repoMatches.values()) {
    entry.functions.forEach(f => matchedNames.add(f.name));
  }
  return { functions: searchItems.filter(item => !matchedNames.has(item.name)).map(item => item.name) };
}

/**
 * @param {object} result - a single GitHub code search result item
 * @param {{name: string}} item - the search item that produced this result
 * @param {Map} repoMatches - match accumulator to update in place
 */
function processSearchResult(result, item, repoMatches) {
  const id = result.repository.full_name;
  if (!repoMatches.has(id)) {
    repoMatches.set(id, {
      functions: [],
      url: result.repository.html_url,
      description: result.repository.description || '',
    });
  }
  const entry = repoMatches.get(id);
  if (!entry.functions.some(f => f.name === item.name)) {
    entry.functions.push({ name: item.name, path: result.path });
  }
}

/**
 * @param {object[]} searchItems - items with name and kind to search for
 * @param {string} repoId - "owner/repo" to exclude from all searches
 * @param {string} token - personal access token
 * @param {number} startIndex - item index to resume from (0 for a fresh start)
 * @param {Map} repoMatches - existing match results to extend
 * @returns {Promise<boolean|null>} true once all items were searched, or null if paused by rate limit
 */
async function runSearch(searchItems, repoId, token, startIndex, repoMatches) {
  for (let i = startIndex; i < searchItems.length; i++) {
    const item = searchItems[i];
    showStatus(`Suche nach „${item.name}"... (${i + 1}/${searchItems.length})`);
    if (i > startIndex) await delay(2500);
    try {
      const results = await searchCodeOnGitHub(item.name, repoId, token);
      results.forEach(r => processSearchResult(r, item, repoMatches));
    } catch (e) {
      if (e.message === 'RATE_LIMIT') {
        searchState = { searchItems, repoId, token, startIndex: i, repoMatches };
        showPausedState(repoMatches, searchItems.length - i, searchItems.slice(0, i));
        return null;
      }
    }
  }
  return true;
}

// ── Candidate verification ────────────────────────────────────────────────────

/**
 * @param {object[]} searchItems - all originally checked items
 * @param {{functions: object[]}} entry - a candidate repo's current match data
 * @returns {object[]} items not yet recorded as matching for this repo
 */
function findMissingItemsForRepo(searchItems, entry) {
  const matchedFunctionNames = new Set(entry.functions.map(f => f.name));
  return searchItems.filter(item => !matchedFunctionNames.has(item.name));
}

/**
 * @param {string} repoId - "owner/repo" of a candidate repo to verify
 * @param {object[]} missingItems - search items not yet confirmed as matching in this repo
 * @param {string} token - personal access token
 * @param {(current: number, total: number) => void} [onProgress] - called before each file is checked
 * @returns {Promise<Array<{name: string, path: string}>>} items actually found in this repo's code
 * @throws {Error} with message 'RATE_LIMIT' if GitHub rate-limits a request, so the caller can stop early
 */
async function verifyItemsInRepo(repoId, missingItems, token, onProgress) {
  const [owner, repo] = repoId.split('/');
  let codeFiles;
  try {
    codeFiles = await fetchAllCodeFilePaths({ owner, repo }, token);
  } catch (e) {
    if (e.message === 'RATE_LIMIT') throw e;
    return [];
  }
  const confirmed = [];
  for (let i = 0; i < codeFiles.length; i++) {
    if (confirmed.length === missingItems.length) break;
    if (i > 0) await delay(300);
    if (onProgress) onProgress(i + 1, codeFiles.length);
    const file = codeFiles[i];
    let code;
    try {
      const content = await githubFetch(`/repos/${owner}/${repo}/contents/${file.path}`, token);
      if (!content.content) continue;
      code = normalizeCode(atob(content.content.replace(/\n/g, '')));
    } catch (e) {
      if (e.message === 'RATE_LIMIT') throw e;
      continue;
    }
    for (const item of missingItems) {
      if (confirmed.some(c => c.name === item.name)) continue;
      if (new RegExp(`\\b${escapeRegExp(item.name)}\\b`).test(code)) {
        confirmed.push({ name: item.name, path: file.path });
      }
    }
  }
  return confirmed;
}

// ── Pause / Resume ────────────────────────────────────────────────────────────

/**
 * @param {Map} repoMatches - results accumulated so far
 * @param {number} remaining - number of searches still pending after the pause
 * @param {object[]} checkedItems - items already searched before the pause occurred
 */
function showPausedState(repoMatches, remaining, checkedItems) {
  const partial = sortedResults(repoMatches);
  const partialHtml = partial.length > 0
    ? `<h2 class="results__title">Bisherige Ergebnisse (${partial.length})</h2>${
        partial.map(([id, data], i) => buildResultCard(id, data, i + 1, checkedItems)).join('')
      }`
    : '<p class="results__empty">Noch keine Treffer gefunden.</p>';
  resultsSection.innerHTML = `
    <div class="results__pause">
      <p class="results__pause-text">Rate-Limit erreicht – noch <strong>${remaining}</strong> Suche(n) ausstehend.</p>
      <button class="results__resume-btn" id="resumeBtn" disabled>Fortsetzen in 60s</button>
    </div>
    ${partialHtml}
  `;
  startCountdown(60);
}

/** Enables the resume button and attaches the click handler to continue the search */
function activateResumeButton() {
  const btn = document.getElementById('resumeBtn');
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = 'Fortsetzen';
  btn.addEventListener('click', continueSearch, { once: true });
}

/**
 * @param {number} seconds - countdown duration before the resume button becomes active
 */
function startCountdown(seconds) {
  if (countdownInterval) clearInterval(countdownInterval);
  let remaining = seconds;
  countdownInterval = setInterval(() => {
    remaining--;
    const btn = document.getElementById('resumeBtn');
    if (!btn) { clearInterval(countdownInterval); countdownInterval = null; return; }
    if (remaining <= 0) {
      clearInterval(countdownInterval);
      countdownInterval = null;
      activateResumeButton();
    } else {
      btn.textContent = `Fortsetzen in ${remaining}s`;
    }
  }, 1000);
}

/** Resumes the paused search from the last saved position */
async function continueSearch() {
  if (!searchState) return;
  const { searchItems, repoId, token, startIndex, repoMatches } = searchState;
  searchState = null;
  searchBtn.disabled = true;
  const completed = await runSearch(searchItems, repoId, token, startIndex, repoMatches);
  if (completed) {
    showResults(sortedResults(repoMatches), searchItems);
  }
  searchBtn.disabled = false;
}
