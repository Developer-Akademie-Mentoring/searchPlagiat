// ── DOM references & state ────────────────────────────────────────────────────

const searchBtn = document.getElementById('searchBtn');
const repoUrlInput = document.getElementById('repoUrl');
const tokenInput = document.getElementById('githubToken');
const resultsSection = document.getElementById('results');
const reviewSection = document.getElementById('review');
const tokenInfoBtn = document.getElementById('tokenInfoBtn');
const tokenInfoContent = document.getElementById('tokenInfo');
const infoBtn = document.getElementById('infoBtn');
const infoDialog = document.getElementById('infoDialog');
const infoDialogClose = document.getElementById('infoDialogClose');

let lastSearchContext = null;
let searchState = null;
let countdownInterval = null;

searchBtn.addEventListener('click', searchPlagiarism);
tokenInfoBtn.addEventListener('click', toggleAccordion);
resultsSection.addEventListener('click', handleResultsAccordionClick);
resultsSection.addEventListener('click', handleFunctionToggleClick);
resultsSection.addEventListener('click', handleUnmatchedFunctionToggleClick);
resultsSection.addEventListener('click', handleDetailCheckClick);
infoBtn.addEventListener('click', () => infoDialog.showModal());
infoDialogClose.addEventListener('click', () => infoDialog.close());
infoDialog.addEventListener('click', e => { if (e.target === infoDialog) infoDialog.close(); });

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

/** Orchestrates repo analysis and shows the review step before the actual search */
async function searchPlagiarism() {
  const { error, parsed, token } = getSearchInputs();
  if (error) { showError(error); return; }

  if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
  searchState = null;
  lastSearchContext = null;
  reviewSection.innerHTML = '';
  searchBtn.disabled = true;

  try {
    const functions = await analyzeRepoFiles(parsed, token);
    if (functions.length === 0) {
      showError('Keine auffälligen Funktionsnamen gefunden.');
      return;
    }
    resultsSection.innerHTML = '';
    showReviewStep(functions, parsed, token);
  } catch (e) {
    showError(e.message);
  } finally {
    searchBtn.disabled = false;
  }
}
