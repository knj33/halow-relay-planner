/**
 * The extension is plumbing, not the accelerator. It only reports whether the
 * native helper is alive and can mark a planner tab as engine-aware.
 */

const ENGINE_HEALTH = 'http://127.0.0.1:8765/health';

async function probe() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const res = await fetch(ENGINE_HEALTH, { cache: 'no-store', signal: controller.signal });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const info = await res.json();
    return info && info.ok ? { ok: true, info } : { ok: false, error: 'Unexpected response' };
  } catch (err) {
    return { ok: false, error: err && err.name === 'AbortError' ? 'Timed out' : 'Not running' };
  } finally {
    clearTimeout(timer);
  }
}

function badge(ok) {
  chrome.action.setBadgeText({ text: ok ? 'ON' : 'OFF' });
  chrome.action.setBadgeBackgroundColor({ color: ok ? '#1f7a52' : '#4a5263' });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message && message.type === 'probe') {
    probe().then((result) => {
      badge(result.ok);
      sendResponse(result);
    });
    return true;
  }
  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  probe().then((result) => badge(result.ok));
});
