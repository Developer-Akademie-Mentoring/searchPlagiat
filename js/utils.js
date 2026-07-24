// ── Utilities ─────────────────────────────────────────────────────────────────

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

/**
 * @param {string} str - raw string to embed literally inside a RegExp
 * @returns {string} the string with regex metacharacters escaped
 */
function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
