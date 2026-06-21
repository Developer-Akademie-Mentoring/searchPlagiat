const searchBtn = document.getElementById('searchBtn');
const repoUrlInput = document.getElementById('repoUrl');
const tokenInput = document.getElementById('githubToken');
const resultsSection = document.getElementById('results');
const tokenInfoBtn = document.getElementById('tokenInfoBtn');
const tokenInfoContent = document.getElementById('tokenInfo');

searchBtn.addEventListener('click', searchPlagiarism);
tokenInfoBtn.addEventListener('click', toggleAccordion);

const GENERIC_WORDS = new Set([
  'get', 'set', 'add', 'remove', 'delete', 'create', 'update', 'fetch', 'load',
  'save', 'send', 'render', 'show', 'hide', 'toggle', 'open', 'close', 'init',
  'start', 'stop', 'run', 'build', 'reset', 'clear', 'check', 'validate', 'parse',
  'format', 'calculate', 'compute', 'process', 'handle', 'increase', 'decrease',
  'increment', 'decrement', 'change', 'convert', 'filter', 'sort', 'find',
  'submit', 'cancel', 'apply', 'enable', 'disable', 'select', 'refresh', 'reload',
  'data', 'item', 'items', 'list', 'value', 'values', 'result', 'results',
  'total', 'count', 'amount', 'price', 'sum', 'number', 'index', 'quantity',
  'name', 'text', 'label', 'title', 'message', 'content', 'type', 'status',
  'state', 'option', 'options', 'user', 'users', 'order', 'orders', 'account',
  'product', 'products', 'cart', 'basket', 'payment', 'address', 'info',
  'button', 'input', 'form', 'field', 'menu', 'modal', 'page', 'view',
  'container', 'event', 'handler', 'error', 'errors', 'response', 'request',
]);

const CODE_EXTENSIONS = [
  '.js', '.ts', '.py', '.java', '.php', '.rb', '.go', '.cs', '.cpp', '.vue', '.jsx', '.tsx',
];

let searchState = null;
let countdownInterval = null;

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * @param {string} url - GitHub repo URL to parse into owner and repo name
 * @returns {{owner: string, repo: string}|null}
 */
function parseGithubUrl(url) {
  const match = url.match(/github\.com\/([^/?#]+)\/([^/?#]+)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

/**
 * @param {string} endpoint - GitHub API path
 * @param {string} token - personal access token
 * @returns {Promise<any>}
 */
async function githubFetch(endpoint, token) {
  const headers = { Accept: 'application/vnd.github.v3+json', Authorization: `token ${token}` };
  const res = await fetch(`https://api.github.com${endpoint}`, { headers });
  if (res.status === 401) throw new Error('GitHub Token ungültig oder abgelaufen. Bitte Token prüfen.');
  if (res.status === 403) throw new Error('RATE_LIMIT');
  if (res.status === 404) throw new Error('Repository nicht gefunden. Bitte URL prüfen.');
  if (!res.ok) throw new Error(`GitHub API Fehler: ${res.status}`);
  return res.json();
}

/**
 * @param {number} ms - milliseconds to pause execution
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Name analysis ─────────────────────────────────────────────────────────────

/**
 * @param {string} name - camelCase or snake_case identifier to split
 * @returns {string[]} lowercase word segments
 */
function splitIntoSegments(name) {
  return name
    .replace(/_/g, ' ')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(s => s.length > 0);
}

/**
 * @param {string} name - identifier to score
 * @returns {number} higher score means more likely to be an individually chosen name
 */
function humanLikenessScore(name) {
  const segments = splitIntoSegments(name);
  const nonGeneric = segments.filter(s => s.length > 2 && !GENERIC_WORDS.has(s));
  return Math.min(name.length / 4, 5) + segments.length + nonGeneric.length * 2;
}

/**
 * @param {string} name - identifier to test for human-likeness
 * @returns {boolean} true if at least one segment is domain-specific rather than generic
 */
function isHumanLike(name) {
  if (name.length < 8) return false;
  const segments = splitIntoSegments(name);
  if (segments.length < 2) return false;
  return segments.some(s => s.length > 2 && !GENERIC_WORDS.has(s));
}

// ── Code extraction ───────────────────────────────────────────────────────────

/**
 * @param {string} code - source code starting with the opening brace
 * @param {number} startIdx - index of the opening '{' character
 * @returns {string|null} the complete braced block, or null if unmatched
 */
function extractBracedBlock(code, startIdx) {
  let depth = 0;
  const limit = Math.min(startIdx + 3000, code.length);
  for (let i = startIdx; i < limit; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') {
      depth--;
      if (depth === 0) return code.slice(startIdx, i + 1);
    }
  }
  return null;
}

/**
 * @param {string} raw - raw source code to normalize
 * @returns {string} code with comments removed and whitespace collapsed
 */
function normalizeCode(raw) {
  return raw
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @param {string} code - normalized source code
 * @param {RegExpExecArray} m - regex match with function name at index 1
 * @returns {{name: string, body: string, score: number}|null} entry or null if name is not humanlike
 */
function buildFunctionEntry(code, m) {
  const name = m[1];
  if (!isHumanLike(name)) return null;
  const body = extractBracedBlock(code, m.index + m[0].length - 1);
  if (!body || body.length < 15) return null;
  return { name, body: body.slice(0, 400), score: humanLikenessScore(name) };
}

/**
 * @param {string} code - normalized source code
 * @returns {Array<{name: string, body: string, score: number}>} humanlike functions sorted by score
 */
function extractFunctionsFromCode(code) {
  const patterns = [
    /function\s+([a-zA-Z_$][a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/g,
    /(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{/g,
    /(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]+)\s*=\s*(?:async\s+)?function\s*\([^)]*\)\s*\{/g,
  ];
  const found = new Map();
  for (const re of patterns) {
    let m;
    while ((m = re.exec(code)) !== null) {
      if (!found.has(m[1])) {
        const entry = buildFunctionEntry(code, m);
        if (entry) found.set(m[1], entry);
      }
    }
  }
  return [...found.values()].sort((a, b) => b.score - a.score);
}

/**
 * @param {string} code - normalized source code
 * @returns {Array<{name: string, declaration: string, score: number}>} humanlike variables sorted by score
 */
function extractVariablesFromCode(code) {
  const re = /(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]+)\s*=\s*([^{;\n][^;\n]{0,80})/g;
  const found = new Map();
  let m;
  while ((m = re.exec(code)) !== null) {
    const name = m[1];
    const declaration = m[2].trim();
    if (!isHumanLike(name) || found.has(name)) continue;
    if (declaration.includes('=>') || declaration.startsWith('function')) continue;
    found.set(name, { name, declaration: declaration.slice(0, 100), score: humanLikenessScore(name) });
  }
  return [...found.values()].sort((a, b) => b.score - a.score);
}

// ── Repository analysis ───────────────────────────────────────────────────────

/**
 * @param {{owner: string, repo: string}} parsed - parsed repo owner and name
 * @param {string} token - personal access token
 * @returns {Promise<object[]>} code file objects from the recursive repo tree
 */
async function fetchCodeFiles(parsed, token) {
  const tree = await githubFetch(
    `/repos/${parsed.owner}/${parsed.repo}/git/trees/HEAD?recursive=1`,
    token
  );
  return (tree.tree || [])
    .filter(f => f.type === 'blob' && CODE_EXTENSIONS.some(ext => f.path.endsWith(ext)))
    .slice(0, 15);
}

/**
 * @param {string} filePath - repo-relative path of the file to analyze
 * @param {{owner: string, repo: string}} parsed - parsed repo owner and name
 * @param {string} token - personal access token
 * @returns {Promise<{functions: object[], variables: object[]}>} extracted identifiers tagged with file path
 */
async function extractFromFile(filePath, parsed, token) {
  const content = await githubFetch(
    `/repos/${parsed.owner}/${parsed.repo}/contents/${filePath}`,
    token
  );
  if (!content.content) return { functions: [], variables: [] };
  const code = normalizeCode(atob(content.content.replace(/\n/g, '')));
  return {
    functions: extractFunctionsFromCode(code).map(f => ({ ...f, file: filePath })),
    variables: extractVariablesFromCode(code).map(v => ({ ...v, file: filePath })),
  };
}

/**
 * @param {{owner: string, repo: string}} parsed - parsed repo owner and name
 * @param {string} token - personal access token
 * @returns {Promise<{functions: object[], variables: object[]}>} top humanlike identifiers across all files
 */
async function analyzeRepoFiles(parsed, token) {
  showStatus('Lade Dateistruktur...');
  const codeFiles = await fetchCodeFiles(parsed, token);
  if (codeFiles.length === 0) throw new Error('Keine Code-Dateien im Repository gefunden.');

  const all = { functions: [], variables: [] };
  for (let i = 0; i < codeFiles.length; i++) {
    showStatus(`Analysiere Dateien... (${i + 1}/${codeFiles.length})`);
    try {
      const { functions, variables } = await extractFromFile(codeFiles[i].path, parsed, token);
      all.functions.push(...functions);
      all.variables.push(...variables);
    } catch (_) { /* skip unreadable files */ }
  }

  const dedupe = arr => [...new Map(arr.map(x => [x.name, x])).values()];
  return {
    functions: dedupe(all.functions).sort((a, b) => b.score - a.score).slice(0, 8),
    variables: dedupe(all.variables).sort((a, b) => b.score - a.score).slice(0, 7),
  };
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
    .sort((a, b) => {
      const score = e => e[1].functions.length * 2 + e[1].variables.length;
      return score(b) - score(a);
    })
    .slice(0, 10);
}

/**
 * @param {object} result - a single GitHub code search result item
 * @param {{name: string, kind: string}} item - the search item that produced this result
 * @param {Map} repoMatches - match accumulator to update in place
 */
function processSearchResult(result, item, repoMatches) {
  const id = result.repository.full_name;
  if (!repoMatches.has(id)) {
    repoMatches.set(id, {
      functions: [], variables: [],
      url: result.repository.html_url,
      description: result.repository.description || '',
    });
  }
  const entry = repoMatches.get(id);
  const list = item.kind === 'function' ? entry.functions : entry.variables;
  if (!list.includes(item.name)) list.push(item.name);
}

/**
 * @param {object[]} searchItems - items with name and kind to search for
 * @param {string} repoId - "owner/repo" to exclude from all searches
 * @param {string} token - personal access token
 * @param {number} startIndex - item index to resume from (0 for a fresh start)
 * @param {Map} repoMatches - existing match results to extend
 * @returns {Promise<Array<[string, object]>|null>} sorted results, or null if paused by rate limit
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
        showPausedState(repoMatches, searchItems.length - i);
        return null;
      }
    }
  }
  return sortedResults(repoMatches);
}

// ── Pause / Resume ────────────────────────────────────────────────────────────

/**
 * @param {Map} repoMatches - results accumulated so far
 * @param {number} remaining - number of searches still pending after the pause
 */
function showPausedState(repoMatches, remaining) {
  const partial = sortedResults(repoMatches);
  const partialHtml = partial.length > 0
    ? `<h2 class="results__title">Bisherige Ergebnisse (${partial.length})</h2>${
        partial.map(([id, data], i) => buildResultCard(id, data, i + 1)).join('')
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
  const result = await runSearch(searchItems, repoId, token, startIndex, repoMatches);
  if (result !== null) showResults(result);
  searchBtn.disabled = false;
}

// ── Display ───────────────────────────────────────────────────────────────────

/**
 * @param {string} str - raw string to escape for safe HTML output
 * @returns {string}
 */
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * @param {string} label - section label shown in bold (e.g. "übereinstimmende Funktionen")
 * @param {string[]} items - identifier names to render as inline code tags
 * @returns {string} HTML paragraph, or empty string if items is empty
 */
function buildReasonSection(label, items) {
  if (!items || items.length === 0) return '';
  const tags = items.map(n => `<code class="result-card__tag">${escapeHtml(n)}</code>`).join(' ');
  return `<p class="result-card__reason"><strong>${items.length} ${escapeHtml(label)}:</strong> ${tags}</p>`;
}

/**
 * @param {string} repoId - "owner/repo" string used as the card title link
 * @param {{functions: string[], variables: string[], url: string, description: string}} data - match data
 * @param {number} rank - 1-based position in the result list
 * @returns {string} HTML markup for a single result card
 */
function buildResultCard(repoId, data, rank) {
  const desc = data.description
    ? `<p class="result-card__description">${escapeHtml(data.description)}</p>`
    : '';
  return `
    <article class="result-card">
      <span class="result-card__rank">#${rank}</span>
      <div class="result-card__body">
        <a class="result-card__link" href="${data.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(repoId)}</a>
        ${desc}
        ${buildReasonSection('übereinstimmende Funktionen', data.functions)}
        ${buildReasonSection('übereinstimmende Variablen', data.variables)}
      </div>
    </article>
  `;
}

/**
 * @param {Array<[string, object]>} matches - sorted [repoId, matchData] pairs to render
 */
function showResults(matches) {
  if (matches.length === 0) {
    resultsSection.innerHTML = '<p class="results__empty">Keine ähnlichen Repositories gefunden.</p>';
    return;
  }
  const cards = matches.map(([id, data], i) => buildResultCard(id, data, i + 1)).join('');
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

/** Toggles the token info accordion between open and closed */
function toggleAccordion() {
  const isOpen = tokenInfoContent.classList.contains('accordion__content--open');
  tokenInfoContent.classList.toggle('accordion__content--open', !isOpen);
  tokenInfoBtn.setAttribute('aria-expanded', String(!isOpen));
  tokenInfoBtn.querySelector('.accordion__icon').classList.toggle('accordion__icon--open', !isOpen);
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * @returns {{parsed: object, token: string}|{error: string}} validated inputs or an error object
 */
function getSearchInputs() {
  const token = tokenInput.value.trim();
  if (!token) return { error: 'Ein GitHub Token ist erforderlich. Bitte Token eintragen.' };
  const parsed = parseGithubUrl(repoUrlInput.value.trim());
  if (!parsed) return { error: 'Ungültige GitHub-URL. Beispiel: https://github.com/user/repository' };
  return { parsed, token };
}

/** Orchestrates repo analysis, GitHub search, and result display */
async function searchPlagiarism() {
  const { error, parsed, token } = getSearchInputs();
  if (error) { showError(error); return; }

  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  searchState = null;
  searchBtn.disabled = true;

  try {
    const { functions, variables } = await analyzeRepoFiles(parsed, token);
    if (functions.length === 0 && variables.length === 0) {
      showError('Keine auffälligen Funktions- oder Variablennamen gefunden.');
      return;
    }
    const repoId = `${parsed.owner}/${parsed.repo}`;
    const searchItems = [
      ...functions.map(f => ({ ...f, kind: 'function' })),
      ...variables.map(v => ({ ...v, kind: 'variable' })),
    ];
    const result = await runSearch(searchItems, repoId, token, 0, new Map());
    if (result !== null) showResults(result);
  } catch (e) {
    showError(e.message);
  } finally {
    searchBtn.disabled = false;
  }
}
