// Catch module download/evaluation failures as well as top-level initialization errors.
// Each page finishes its own data/DOM boundary; resolving import alone is not readiness.
const pageModule = new URL(document.currentScript.dataset.pageSrc, document.baseURI);
import(pageModule.href).catch(() => globalThis.diesDuckPageLoad.fail());
