/* =========================================================
   Clarix Extension — background.js (Service Worker)
   Handles context menus and message routing.
   ========================================================= */

// ─────────────────────────────────────────────────────────
//  Context Menu Setup
// ─────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(() => {
  // Verify selected text
  chrome.contextMenus.create({
    id: 'clarix-verify-text',
    title: '🔍 Verify with Clarix',
    contexts: ['selection'],
  });

  // Analyze image
  chrome.contextMenus.create({
    id: 'clarix-analyze-image',
    title: '🖼️ Analyze Image with Clarix',
    contexts: ['image'],
  });

  // Scan full page
  chrome.contextMenus.create({
    id: 'clarix-scan-page',
    title: '🌐 Scan Page with Clarix',
    contexts: ['page'],
  });
});

// ─────────────────────────────────────────────────────────
//  Context Menu Click Handler
// ─────────────────────────────────────────────────────────
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  switch (info.menuItemId) {
    case 'clarix-verify-text': {
      // Store selected text and open popup, or inject side panel
      await chrome.storage.session.set({
        clarix_pending: {
          type: 'text',
          content: info.selectionText || '',
          triggerSidePanel: true,
        }
      });
      // Inject side panel into the page
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => { window.postMessage({ clarixAction: 'openPanel', type: 'text' }, '*'); },
      });
      break;
    }
    case 'clarix-analyze-image': {
      await chrome.storage.session.set({
        clarix_pending: {
          type: 'image',
          content: info.srcUrl || '',
          triggerSidePanel: true,
        }
      });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (srcUrl) => { window.postMessage({ clarixAction: 'openPanel', type: 'image', content: srcUrl }, '*'); },
        args: [info.srcUrl || ''],
      });
      break;
    }
    case 'clarix-scan-page': {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => { window.postMessage({ clarixAction: 'openPanel', type: 'page' }, '*'); },
      });
      break;
    }
  }
});

// ─────────────────────────────────────────────────────────
//  Message relay from content script → external API
//  (allows content script to make cross-origin fetch)
// ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'analyze') {
    const { type, content, url } = message;
    analyzeViaAPI(type, content, url)
      .then(result => sendResponse({ ok: true, data: result }))
      .catch(err  => sendResponse({ ok: false, error: err.message }));
    return true; // Keep channel open for async response
  }
});

async function analyzeViaAPI(type, content, url) {
  const API_BASE = 'http://localhost:3000';
  const response = await fetch(`${API_BASE}/api/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, content, url }),
  });
  if (!response.ok) throw new Error(`Server error: ${response.status}`);
  return response.json();
}
