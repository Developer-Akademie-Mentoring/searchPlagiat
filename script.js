const searchBtn = document.getElementById('searchBtn');
const repoUrlInput = document.getElementById('repoUrl');
const tokenInput = document.getElementById('githubToken');
const resultsSection = document.getElementById('results');
const tokenInfoBtn = document.getElementById('tokenInfoBtn');
const tokenInfoContent = document.getElementById('tokenInfo');

searchBtn.addEventListener('click', searchPlagiarism);
tokenInfoBtn.addEventListener('click', toggleAccordion);

const COMMON_NAMES = new Set([
  'main', 'init', 'render', 'update', 'get', 'set', 'run', 'start', 'stop',
  'load', 'save', 'create', 'delete', 'remove', 'add', 'show', 'hide', 'open',
  'close', 'handle', 'fetch', 'parse', 'format', 'check', 'validate', 'test',
  'log', 'error', 'warn', 'info', 'send', 'reset', 'clear', 'build', 'execute',
  'connect', 'read', 'write', 'index', 'next', 'prev', 'click', 'submit',
]);

const CODE_EXTENSIONS = ['.js', '.ts', '.py', '.java', '.php', '.rb', '.go', '.cs', '.cpp', '.vue', '.jsx', '.tsx'];

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
 * @param {string} endpoint - GitHub API path (e.g. /repos/owner/repo/...)
 * @param {string} token - optional personal access token
 * @returns {Promise<any>}
 */
async function githubFetch(endpoint, token) {
  const headers = { Accept: 'application/vnd.github.v3+json' };
  if (token) headers.Authorization = `token ${token}`;
  const res = await fetch(`https://api.github.com${endpoint}`, { headers });
  if (res.status === 401) throw new Error('GitHub Token ungültig oder abgelaufen. Bitte einen neuen Token eintragen oder das Feld leer lassen.');
  if (res.status === 403) throw new Error('Rate-Limit erreicht. Bitte GitHub Token eintragen oder kurz warten.');
  if (res.status === 404) throw new Error('Repository nicht gefunden. Bitte URL prüfen.');
  if (!res.ok) throw new Error(`GitHub API Fehler: ${res.status}`);
  return res.json();
}

/**
 * @param {string} base64Content - base64-encoded file content as returned by GitHub API
 * @returns {string[]} list of distinct, non-generic function names found in the file
 */
function extractFunctionNames(base64Content) {
  const code = atob(base64Content.replace(/\n/g, ''));
  const patterns = [
    /function\s+([a-zA-Z_$][a-zA-Z0-9_$]+)\s*\(/g,
    /(?:const|let|var)\s+([a-zA-Z_$][a-zA-Z0-9_$]+)\s*=\s*(?:async\s+)?(?:function|\([^)]*\)\s*=>)/g,
    /([a-zA-Z_$][a-zA-Z0-9_$]+)\s*:\s*(?:async\s+)?function/g,
    /def\s+([a-zA-Z_][a-zA-Z0-9_]+)\s*\(/g,
    /(?:public|private|protected)\s+(?:static\s+)?(?:\w+\s+)?([a-zA-Z_][a-zA-Z0-9_]+)\s*\(/g,
  ];

  const names = new Set();
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      const name = match[1];
      if (name.length >= 5 && !COMMON_NAMES.has(name.toLowerCase())) {
        names.add(name);
      }
    }
  }
  return [...names];
}

/**
 * @param {number} ms - milliseconds to pause
 * @returns {Promise<void>}
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @param {string} functionName - function name to search for on GitHub
 * @param {string} excludeRepo - repo in "owner/name" format to skip in results
 * @param {string} token - optional personal access token
 * @returns {Promise<any[]>} list of matching code search result items
 */
async function searchForFunction(functionName, excludeRepo, token) {
  const query = `"${functionName}" in:file NOT repo:${excludeRepo}`;
  const data = await githubFetch(`/search/code?q=${encodeURIComponent(query)}&per_page=20`, token);
  return data.items || [];
}

/**
 * @param {string} repoId - "owner/repo" identifier string
 * @param {{count: number, names: string[], url: string, description: string}} data - match data
 * @param {number} rank - 1-based position in the result list
 * @returns {string} HTML markup for a single result card
 */
function buildResultCard(repoId, data, rank) {
  const tags = data.names.map(n => `<code class="result-card__tag">${n}</code>`).join(' ');
  const desc = data.description
    ? `<p class="result-card__description">${escapeHtml(data.description)}</p>`
    : '';
  return `
    <article class="result-card">
      <span class="result-card__rank">#${rank}</span>
      <div class="result-card__body">
        <a class="result-card__link" href="${data.url}" target="_blank" rel="noopener noreferrer">${escapeHtml(repoId)}</a>
        ${desc}
        <p class="result-card__reason">
          <strong>${data.names.length} übereinstimmende Funktionsnamen:</strong> ${tags}
        </p>
      </div>
    </article>
  `;
}

/**
 * @param {string} str - raw string to make safe for HTML output
 * @returns {string}
 */
function escapeHtml(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * @param {Array<[string, object]>} matches - sorted pairs of [repoId, matchData]
 */
function showResults(matches) {
  if (matches.length === 0) {
    resultsSection.innerHTML = '<p class="results__empty">Keine ähnlichen Repositories gefunden.</p>';
    return;
  }
  const cards = matches.map(([id, data], i) => buildResultCard(id, data, i + 1)).join('');
  resultsSection.innerHTML = `<h2 class="results__title">Ähnliche Repositories (${matches.length})</h2>${cards}`;
}

/** @param {string} msg - error text to display in the results area */
function showError(msg) {
  resultsSection.innerHTML = `<p class="results__error">${escapeHtml(msg)}</p>`;
}

/** @param {string} msg - status text shown alongside the loading spinner */
function showStatus(msg) {
  resultsSection.innerHTML = `<div class="results__loading"><span class="results__spinner"></span>${escapeHtml(msg)}</div>`;
}

/** Toggles the GitHub token info accordion open and closed */
function toggleAccordion() {
  const isOpen = tokenInfoContent.classList.contains('accordion__content--open');
  tokenInfoContent.classList.toggle('accordion__content--open', !isOpen);
  tokenInfoBtn.setAttribute('aria-expanded', String(!isOpen));
  tokenInfoBtn.querySelector('.accordion__icon').classList.toggle('accordion__icon--open', !isOpen);
}

/** Fetches the repo, extracts function names, searches GitHub for matches, and renders results */
async function searchPlagiarism() {
  const url = repoUrlInput.value.trim();
  const token = tokenInput.value.trim();

  const parsed = parseGithubUrl(url);
  if (!parsed) {
    showError('Ungültige GitHub-URL. Beispiel: https://github.com/user/repository');
    return;
  }

  const repoId = `${parsed.owner}/${parsed.repo}`;
  searchBtn.disabled = true;

  try {
    showStatus('Lade Dateistruktur...');
    const tree = await githubFetch(
      `/repos/${parsed.owner}/${parsed.repo}/git/trees/HEAD?recursive=1`,
      token
    );

    const codeFiles = (tree.tree || [])
      .filter(f => f.type === 'blob' && CODE_EXTENSIONS.some(ext => f.path.endsWith(ext)))
      .slice(0, 10);

    if (codeFiles.length === 0) {
      showError('Keine Code-Dateien im Repository gefunden.');
      return;
    }

    showStatus(`Analysiere ${codeFiles.length} Code-Dateien...`);
    const allNames = new Set();

    for (const file of codeFiles) {
      try {
        const content = await githubFetch(
          `/repos/${parsed.owner}/${parsed.repo}/contents/${file.path}`,
          token
        );
        if (content.content) {
          extractFunctionNames(content.content).forEach(n => allNames.add(n));
        }
      } catch (_) { /* skip unreadable or binary files */ }
    }

    const candidates = [...allNames].slice(0, token ? 8 : 4);

    if (candidates.length === 0) {
      showError('Keine markanten Funktionsnamen gefunden. Bitte ein anderes Repository versuchen.');
      return;
    }

    const repoMatches = new Map();
    const waitMs = token ? 2500 : 7000;

    for (let i = 0; i < candidates.length; i++) {
      showStatus(`Suche nach Übereinstimmungen... (${i + 1}/${candidates.length})`);
      if (i > 0) await delay(waitMs);

      try {
        const items = await searchForFunction(candidates[i], repoId, token);
        for (const item of items) {
          const id = item.repository.full_name;
          if (!repoMatches.has(id)) {
            repoMatches.set(id, {
              count: 0,
              names: [],
              url: item.repository.html_url,
              description: item.repository.description || '',
            });
          }
          const entry = repoMatches.get(id);
          entry.count++;
          if (!entry.names.includes(candidates[i])) entry.names.push(candidates[i]);
        }
      } catch (e) {
        showError(e.message);
        return;
      }
    }

    const sorted = [...repoMatches.entries()]
      .sort((a, b) => b[1].names.length - a[1].names.length || b[1].count - a[1].count)
      .slice(0, 10);

    showResults(sorted);
  } catch (e) {
    showError(e.message);
  } finally {
    searchBtn.disabled = false;
  }
}
