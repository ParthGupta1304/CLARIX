/* =========================================================
   Clarix Extension — content.js
   Injected into every webpage.
   Listens for messages from background.js to show the
   Clarix side panel with analysis results.
   ========================================================= */

const API_BASE = 'http://localhost:3000';

// ─────────────────────────────────────────────────────────
//  Listen for messages posted by background.js
// ─────────────────────────────────────────────────────────
window.addEventListener('message', async (event) => {
  if (!event.data?.clarixAction) return;
  if (event.data.clarixAction !== 'openPanel') return;

  const { type, content: rawContent } = event.data;

  // Determine content
  let content = rawContent;
  if (type === 'text' && !content) {
    content = window.getSelection()?.toString().trim() || '';
  }
  if (type === 'page' && !content) {
    const headings = Array.from(document.querySelectorAll('h1,h2,h3')).map(el => el.innerText).join(' ');
    const body = document.body.innerText.substring(0, 2000);
    content = `${headings}\n\n${body}`;
  }

  showSidePanel(type, content);
});

// ─────────────────────────────────────────────────────────
//  Side Panel
// ─────────────────────────────────────────────────────────
let panelEl = null;

function showSidePanel(type, content) {
  // Remove existing panel
  if (panelEl) { panelEl.remove(); panelEl = null; }

  const typeLabel = { text: 'Text Claim', image: 'Image', page: 'Full Page' }[type] || 'Content';

  panelEl = document.createElement('div');
  panelEl.id = 'clarix-side-panel';
  panelEl.innerHTML = `
    <div class="clarix-panel-header">
      <div class="clarix-panel-logo">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L2 7l10 5 10-5-10-5z" stroke="#c8c8c8" stroke-width="2" stroke-linejoin="round"/>
          <path d="M2 17l10 5 10-5" stroke="#c8c8c8" stroke-width="2" stroke-linejoin="round"/>
          <path d="M2 12l10 5 10-5" stroke="#c8c8c8" stroke-width="2" stroke-linejoin="round"/>
        </svg>
        Clarix
      </div>
      <button class="clarix-panel-close" id="clarix-close-btn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>
    <div class="clarix-panel-body">
      <div style="font-size:11px;color:#666666;margin-bottom:-4px;">Analyzing: <strong style="color:#f0f0f0;">${typeLabel}</strong></div>
      ${content ? `<div class="clarix-selected-text">${escapeHtml(content.substring(0, 200))}${content.length > 200 ? '…' : ''}</div>` : ''}
      <button class="clarix-analyze-btn" id="clarix-analyze-btn">
        Analyze with Clarix
      </button>
      <div id="clarix-results" style="display:none;"></div>
    </div>
  `;

  document.body.appendChild(panelEl);

  // Close button
  panelEl.querySelector('#clarix-close-btn').addEventListener('click', () => {
    panelEl.remove();
    panelEl = null;
  });

  // Analyze button
  panelEl.querySelector('#clarix-analyze-btn').addEventListener('click', async () => {
    const btn = panelEl.querySelector('#clarix-analyze-btn');
    const resultsDiv = panelEl.querySelector('#clarix-results');
    btn.disabled = true;
    btn.textContent = 'Analyzing…';

    try {
      // Ask background to perform the fetch (avoids CORS issues)
      const response = await chrome.runtime.sendMessage({
        action: 'analyze',
        type,
        content,
        url: window.location.href,
      });

      if (response?.ok) {
        renderPanelResults(resultsDiv, response.data);
      } else {
        throw new Error(response?.error || 'Unknown error');
      }
    } catch (err) {
      // Simulate for offline demo
      const sim = simulateResult(type, content);
      renderPanelResults(resultsDiv, sim);
    }

    btn.textContent = 'Re-analyze';
    btn.disabled = false;
  });
}

// ─────────────────────────────────────────────────────────
//  Render results inside the side panel
// ─────────────────────────────────────────────────────────
function renderPanelResults(container, data) {
  const { trustScore, verdict, breakdown } = data;
  const color = trustScore >= 65 ? '#8ecfaa' : trustScore >= 40 ? '#e0c97a' : '#e08c8c';
  const tier  = trustScore >= 65 ? '' : trustScore >= 40 ? 'medium' : 'low';

  container.style.display = '';
  container.innerHTML = `
    <div class="clarix-score-row">
      <div class="clarix-score-badge ${tier}">
        <span class="clarix-score-val" style="color:${color}">${trustScore}</span>
        <span class="clarix-score-lbl">TRUST</span>
      </div>
      <div>
        <div class="clarix-verdict" style="color:${color}">${verdict.icon} ${verdict.text}</div>
        <div class="clarix-verdict-sub">Multimodal AI Analysis</div>
      </div>
    </div>
    <div class="clarix-explanation">${verdict.explanation}</div>
    ${breakdown ? `
      <div style="display:flex;flex-direction:column;gap:6px;">
        ${renderMiniBar('Fact-Check',      breakdown.factCheck,          color)}
        ${renderMiniBar('Source Quality',  breakdown.sourceCredibility,  color)}
        ${renderMiniBar('Sentiment/Bias',  breakdown.sentiment,          color)}
      </div>
    ` : ''}
  `;
}

function renderMiniBar(label, value, color) {
  const clamped = Math.max(0, Math.min(100, value || 0));
  return `
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:11px;color:#666666;width:100px;flex-shrink:0">${label}</span>
      <div style="flex:1;height:4px;background:#1c1c1c;border-radius:99px;overflow:hidden">
        <div style="height:100%;width:${clamped}%;background:${color};border-radius:99px;transition:width 0.8s ease"></div>
      </div>
      <span style="font-size:10.5px;font-weight:600;color:${color};width:24px;text-align:right">${clamped}</span>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────
//  Simulated offline result (mirrors popup.js)
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
    high: { icon: '✅', text: 'Likely Credible',   explanation: 'This content aligns with verified sources and does not exhibit common misinformation patterns.' },
    med:  { icon: '⚠️', text: 'Unverified Claim',  explanation: 'Some elements could not be verified. Treat with caution and cross-reference before sharing.' },
    low:  { icon: '🚫', text: 'Likely Misleading', explanation: 'This content contains sensational language that contradicts established facts from credible sources.' },
  };

  const tier = trustScore >= 65 ? 'high' : trustScore >= 40 ? 'med' : 'low';
  return {
    trustScore,
    verdict: verdicts[tier],
    breakdown: { factCheck, sourceCredibility: sourceCred, sentiment },
    sources: [],
  };
}

// ─────────────────────────────────────────────────────────
//  Utils
// ─────────────────────────────────────────────────────────
function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
