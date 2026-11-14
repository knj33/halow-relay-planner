// documentElement may not exist yet when document_start runs.
function markPlanner() {
  document.documentElement.dataset.halowEngineExtension = '1';
  window.dispatchEvent(new CustomEvent('halow-engine-extension'));
}
if (document.documentElement) markPlanner();
else document.addEventListener('DOMContentLoaded', markPlanner, { once: true });
