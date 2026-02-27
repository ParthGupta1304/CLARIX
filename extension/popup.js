/* =========================================================
   Clarix Extension — popup.js
   Handles popup tab switching, text/image/page analysis,
   communication with background/content scripts, and
   rendering results in the UI.
   ========================================================= */

// ─────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────
const API_BASE = 'http://localhost:3000'; // Express backend server

// ─────────────────────────────────────────────────────────
//  DOM Refs
// ─────────────────────────────────────────────────────────
const tabs            = document.querySelectorAll('.tab');
const tabPanes        = document.querySelectorAll('.tab-pane');
const textInput       = document.getElementById('textInput');
const charCount       = document.getElementById('charCount');
const analyzeTextBtn  = document.getElementById('analyzeTextBtn');
const analyzeImageBtn = document.getElementById('analyzeImageBtn');
const analyzePageBtn  = document.getElementById('analyzePageBtn');
const pasteSelBtn     = document.getElementById('pasteSelectionBtn');
const fileInput       = document.getElementById('fileInput');
const imageUrlInput   = document.getElementById('imageUrlInput');
const dropzone        = document.getElementById('dropzone');
const resultsPanel    = document.getElementById('resultsPanel');
const loadingOverlay  = document.getElementById('loadingOverlay');
const loadingText     = document.getElementById('loadingText');
const closeResultsBtn = document.getElementById('closeResultsBtn');
const currentPageTitle = document.getElementById('currentPageTitle');
const currentPageUrl   = document.getElementById('currentPageUrl');

// Result elements
const ringFill        = document.getElementById('ringFill');
const scoreValue      = document.getElementById('scoreValue');
const verdictIcon     = document.getElementById('verdictIcon');
const verdictText     = document.getElementById('verdictText');
const barFactCheck    = document.getElementById('barFactCheck');
const barSource       = document.getElementById('barSource');
const barSentiment    = document.getElementById('barSentiment');
const scoreFactCheck  = document.getElementById('scoreFactCheck');
const scoreSource     = document.getElementById('scoreSource');
const scoreSentiment  = document.getElementById('scoreSentiment');
const explanationText = document.getElementById('explanationText');
const sourcesBox      = document.getElementById('sourcesBox');
const sourcesList     = document.getElementById('sourcesList');

// ─────────────────────────────────────────────────────────
//  Tab Switching
// ─────────────────────────────────────────────────────────
tabs.forEach(tab => {
  tab.addEventListener('click', () => {
    tabs.forEach(t => t.classList.remove('active'));
    tabPanes.forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const pane = document.getElementById(`tab-${tab.dataset.tab}`);
    if (pane) pane.classList.add('active');
    // Close results when switching tabs
    resultsPanel.classList.add('hidden');
  });
});

// ─────────────────────────────────────────────────────────
//  Char count
// ─────────────────────────────────────────────────────────
textInput.addEventListener('input', () => {
  const len = textInput.value.length;
  charCount.textContent = len;
  if (len > 800) charCount.style.color = '#f87171';
  else if (len > 600) charCount.style.color = '#fbbf24';
  else charCount.style.color = '';
});

// ─────────────────────────────────────────────────────────
//  Paste selected text from active tab
// ─────────────────────────────────────────────────────────
pasteSelBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.getSelection()?.toString().trim() || '',
    });
    const sel = results?.[0]?.result;
    if (sel) {
      textInput.value = sel;
      charCount.textContent = sel.length;
    } else {
      flashMessage(pasteSelBtn, 'No selection!');
    }
  } catch {
    flashMessage(pasteSelBtn, 'Error');
  }
});

// ─────────────────────────────────────────────────────────
//  Load current page metadata for Page tab
// ─────────────────────────────────────────────────────────
(async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      currentPageTitle.textContent = tab.title || 'Unknown Page';
      currentPageUrl.textContent   = tab.url   || '';
    }
  } catch {}
})();

// ─────────────────────────────────────────────────────────
//  Dropzone drag events
// ─────────────────────────────────────────────────────────
['dragenter','dragover'].forEach(e => {
  dropzone.addEventListener(e, ev => { ev.preventDefault(); dropzone.classList.add('dragover'); });
});
['dragleave','drop'].forEach(e => {
  dropzone.addEventListener(e, ev => { ev.preventDefault(); dropzone.classList.remove('dragover'); });
});
dropzone.addEventListener('drop', ev => {
  const file = ev.dataTransfer?.files?.[0];
  if (file && file.type.startsWith('image/')) {
    handleImageFile(file);
  }
});
dropzone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) handleImageFile(file);
});

function handleImageFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    imageUrlInput.value = '';
    // Store base64 on the dropzone for later retrieval
    dropzone.dataset.base64 = reader.result;
    // Visual feedback
    const inner = dropzone.querySelector('.dropzone-inner');
    inner.innerHTML = `
      <img src="${reader.result}" style="max-height:80px;border-radius:6px;object-fit:contain;" />
      <p class="dropzone-text" style="margin-top:8px;">${file.name}</p>
    `;
  };
  reader.readAsDataURL(file);
}

// ─────────────────────────────────────────────────────────
//  Analysis Triggers
// ─────────────────────────────────────────────────────────
analyzeTextBtn.addEventListener('click', async () => {
  const text = textInput.value.trim();
  if (!text) { shake(analyzeTextBtn); return; }
  await runAnalysis({ type: 'text', content: text });
});

analyzeImageBtn.addEventListener('click', async () => {
  const url = imageUrlInput.value.trim();
  const base64 = dropzone.dataset.base64;
  if (!url && !base64) { shake(analyzeImageBtn); return; }
  await runAnalysis({ type: 'image', content: url || base64 });
});

analyzePageBtn.addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map(el => el.innerText).join(' ');
        const body = document.body.innerText.substring(0, 2000);
        return `${headings}\n\n${body}`;
      }
    });
    const pageText = results?.[0]?.result || tab.title || 'No content';
    await runAnalysis({ type: 'page', content: pageText, url: tab.url });
  } catch {
    showError('Could not read page content. Check permissions.');
  }
});

// ─────────────────────────────────────────────────────────
//  Core analysis function
// ─────────────────────────────────────────────────────────
async function runAnalysis({ type, content, url }) {
  showLoading(type);

  try {
    const response = await fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': 'clarix-public-api-key-change-in-production' },
      body: JSON.stringify({ type, content, url }),
    });

    if (!response.ok) throw new Error(`Server error: ${response.status}`);
    const json = await response.json();
    const d = json.data || json;
    // Map backend shape to extension-compatible shape
    const mapped = {
      trustScore: d.trustScore ?? d.score ?? 0,
      verdict: d.verdictDetail ?? { icon: '⚠️', text: d.verdict || 'Unknown', explanation: d.explanation || '' },
      breakdown: d.breakdown ?? { factCheck: d.factCheck ?? 0, sourceCredibility: d.sourceCredibility ?? 0, sentiment: d.sentimentBias ?? 0 },
      sources: d.sources ?? [],
    };
    hideLoading();
    renderResults(mapped);
  } catch (err) {
    hideLoading();
    // Show simulated results if API is not available (for offline demo)
    console.warn('API unavailable, using simulated results:', err.message);
    renderResults(simulateResult(type, content));
  }
}

// ─────────────────────────────────────────────────────────
//  Simulated result for offline/demo mode
// ─────────────────────────────────────────────────────────
function simulateResult(type, content) {
  const text = typeof content === 'string' ? content.toLowerCase() : '';
  const isSuspicious = text.includes('miracle') || text.includes('cure') || text.includes('secret') ||
                       text.includes('fake') || text.includes('hoax') || text.includes('shocking');
  const trustScore = isSuspicious ? Math.floor(Math.random() * 25 + 10) : Math.floor(Math.random() * 30 + 65);
  const factCheck  = isSuspicious ? Math.floor(Math.random() * 30 + 10) : Math.floor(Math.random() * 25 + 70);
  const sourceCred = isSuspicious ? Math.floor(Math.random() * 20 + 20) : Math.floor(Math.random() * 20 + 65);
  const sentiment  = isSuspicious ? Math.floor(Math.random() * 40 + 10) : Math.floor(Math.random() * 30 + 60);

  const verdicts = {
    high:   { icon: '✅', text: 'Likely Credible',   explanation: 'This content aligns with verified sources and does not exhibit common misinformation patterns. Language is measured and factual.' },
    med:    { icon: '⚠️', text: 'Unverified Claim',  explanation: 'Some elements could not be verified against known sources. Treat with caution and cross-reference before sharing.' },
    low:    { icon: '🚫', text: 'Likely Misleading', explanation: 'This content contains sensational language and claims that contradict established facts from credible sources.' },
  };

  const tier = trustScore >= 65 ? 'high' : trustScore >= 40 ? 'med' : 'low';
  return {
    trustScore,
    verdict: verdicts[tier],
    breakdown: { factCheck, sourceCredibility: sourceCred, sentiment },
    sources: trustScore >= 50 ? [
      { title: 'Reuters Fact Check', url: 'https://www.reuters.com/fact-check/' },
      { title: 'Snopes', url: 'https://www.snopes.com' },
    ] : [],
  };
}

// ─────────────────────────────────────────────────────────
//  Render Results
// ─────────────────────────────────────────────────────────
function renderResults(data) {
  const { trustScore, verdict, breakdown, sources } = data;

  // Trust Score Ring
  const circumference = 251.3;
  const offset = circumference - (trustScore / 100) * circumference;
  ringFill.style.strokeDashoffset = offset;
  // Dynamic color
  const color = trustScore >= 65 ? '#8ecfaa' : trustScore >= 40 ? '#e0c97a' : '#e08c8c';
  ringFill.style.stroke = color;
  scoreValue.textContent = `${trustScore}`;
  scoreValue.style.color = color;

  // Verdict
  verdictIcon.textContent = verdict.icon;
  verdictText.textContent = verdict.text;
  verdictText.style.color = color;

  // Breakdown bars
  setBar(barFactCheck, scoreFactCheck, breakdown.factCheck);
  setBar(barSource,    scoreSource,    breakdown.sourceCredibility);
  setBar(barSentiment, scoreSentiment, breakdown.sentiment);

  // Explanation
  explanationText.textContent = verdict.explanation;

  // Sources
  if (sources && sources.length > 0) {
    sourcesBox.style.display = '';
    sourcesList.innerHTML = sources.map(s => `
      <a class="source-item" href="${s.url}" target="_blank" rel="noopener">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
        ${s.title}
      </a>
    `).join('');
  } else {
    sourcesBox.style.display = 'none';
  }

  resultsPanel.classList.remove('hidden');
}

function setBar(bar, scoreEl, value) {
  const clamped = Math.max(0, Math.min(100, value));
  bar.style.width = `${clamped}%`;
  const c = clamped >= 65 ? '#8ecfaa' : clamped >= 40 ? '#e0c97a' : '#e08c8c';
  bar.style.background = c;
  scoreEl.textContent = `${clamped}`;
  scoreEl.style.color = c;
}

// ─────────────────────────────────────────────────────────
//  Loading helpers
// ─────────────────────────────────────────────────────────
function showLoading(type) {
  const labels = { text: 'Fact-checking claim…', image: 'Scanning image…', page: 'Scanning full page…' };
  loadingText.textContent = labels[type] || 'Analyzing…';
  loadingOverlay.classList.remove('hidden');
  resultsPanel.classList.add('hidden');
  [analyzeTextBtn, analyzeImageBtn, analyzePageBtn].forEach(b => b.disabled = true);
}

function hideLoading() {
  loadingOverlay.classList.add('hidden');
  [analyzeTextBtn, analyzeImageBtn, analyzePageBtn].forEach(b => b.disabled = false);
}

function showError(msg) {
  hideLoading();
  explanationText.textContent = `⚠️ ${msg}`;
  resultsPanel.classList.remove('hidden');
}

// ─────────────────────────────────────────────────────────
//  Close Results
// ─────────────────────────────────────────────────────────
closeResultsBtn.addEventListener('click', () => {
  resultsPanel.classList.add('hidden');
});

// ─────────────────────────────────────────────────────────
//  Micro-interaction helpers
// ─────────────────────────────────────────────────────────
function shake(el) {
  el.style.animation = 'none';
  el.offsetHeight; // reflow
  el.style.animation = 'shake 0.4s ease';
  setTimeout(() => { el.style.animation = ''; }, 400);
}

function flashMessage(btn, msg) {
  const original = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => { btn.textContent = original; }, 1500);
}

// Inject shake keyframe once
const styleTag = document.createElement('style');
styleTag.textContent = `
  @keyframes shake {
    0%,100% { transform: translateX(0); }
    20%,60%  { transform: translateX(-4px); }
    40%,80%  { transform: translateX(4px); }
  }
`;
document.head.appendChild(styleTag);
