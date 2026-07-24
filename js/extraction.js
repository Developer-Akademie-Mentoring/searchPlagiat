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
    /(?<![\w$.])([a-zA-Z_$][a-zA-Z0-9_$]+)\s*\([^)]*\)\s*\{/g,
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
 * @param {string} code - normalized source code to search
 * @param {string} name - exact identifier name to locate a function definition for
 * @returns {string|null} the matching function body, or null if none of the patterns match
 */
function extractNamedFunctionBody(code, name) {
  const safeName = escapeRegExp(name);
  const patterns = [
    new RegExp(`function\\s+${safeName}\\s*\\([^)]*\\)\\s*\\{`),
    new RegExp(`(?:const|let|var)\\s+${safeName}\\s*=\\s*(?:async\\s+)?\\([^)]*\\)\\s*=>\\s*\\{`),
    new RegExp(`(?:const|let|var)\\s+${safeName}\\s*=\\s*(?:async\\s+)?function\\s*\\([^)]*\\)\\s*\\{`),
    new RegExp(`(?<![\\w$])${safeName}\\s*\\([^)]*\\)\\s*\\{`),
  ];
  for (const re of patterns) {
    const m = re.exec(code);
    if (!m) continue;
    const body = extractBracedBlock(code, m.index + m[0].length - 1);
    if (body) return body.slice(0, 400);
  }
  return null;
}

/**
 * @param {string} code - single-line, whitespace-collapsed source code to reformat
 * @returns {string} the code split across multiple lines with basic brace-based indentation
 */
function formatCode(code) {
  let out = '';
  let indent = 0;
  let quote = null;
  let parenDepth = 0;
  const pad = () => '  '.repeat(indent);
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    if (quote) {
      out += ch;
      if (ch === quote && code[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; out += ch; continue; }
    if (ch === '(') { parenDepth++; out += ch; continue; }
    if (ch === ')') { parenDepth = Math.max(parenDepth - 1, 0); out += ch; continue; }
    if (ch === '{') {
      indent++;
      out = out.replace(/[ \t]+$/, '') + ' {\n' + pad();
      while (code[i + 1] === ' ') i++;
      continue;
    }
    if (ch === '}') {
      indent = Math.max(indent - 1, 0);
      out = out.replace(/[ \t]+$/, '');
      if (!out.endsWith('\n')) out += '\n';
      out += pad() + '}\n' + pad();
      while (code[i + 1] === ' ') i++;
      continue;
    }
    if (ch === ';' && parenDepth === 0) {
      out += ';\n' + pad();
      while (code[i + 1] === ' ') i++;
      continue;
    }
    out += ch;
  }
  return out.trim();
}
