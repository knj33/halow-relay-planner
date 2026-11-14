const dot = document.getElementById('dot');
const label = document.getElementById('label');
const detail = document.getElementById('detail');
const guide = document.getElementById('guide');

let currentOrigin = null;

function show(result) {
  if (result.ok) {
    dot.className = 'dot ok';
    label.textContent = 'Engine running';
    const i = result.info || {};
    detail.textContent = `${i.threads || '?'} threads · ${i.avx2 ? 'AVX2' : 'baseline'} · v${i.version || '?'}`;
  } else {
    dot.className = 'dot bad';
    label.textContent = 'Not detected';
    detail.textContent = `${result.error || 'Not running'}. Start the helper on 127.0.0.1:8765.`;
  }
}

function detect() {
  label.textContent = 'Checking…';
  dot.className = 'dot';
  chrome.runtime.sendMessage({ type: 'probe' }, show);
}

document.getElementById('detect').addEventListener('click', detect);

document.getElementById('mark').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.id) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        document.documentElement.dataset.halowEngineExtension = '1';
        window.dispatchEvent(new CustomEvent('halow-engine-extension'));
      },
    });
    detail.textContent = 'This tab is marked. Reload the planner if the panel does not update.';
  } catch {
    detail.textContent = 'This page does not allow the marker script.';
  }
});

chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
  if (tab && tab.url) {
    try {
      const url = new URL(tab.url);
      currentOrigin = url.origin;
      guide.href = `${url.origin}/engine/`;
    } catch {
      /* not a normal web page */
    }
  }
});

detect();
