/* Pinta la versión de la app donde haga falta.

   Rellena los elementos con clase .app-version (cabecera y Ajustes) y los
   .sw-version (solo Ajustes). APP_VERSION y VERSION de sw.js son SIEMPRE
   el mismo número: si no coinciden, el navegador sigue sirviendo código
   cacheado y se enseña el aviso .version-desfase. */
import { APP_VERSION } from '../version.js';
import { versionSW } from '../pwa.js';

export async function pintarVersion() {
  document.querySelectorAll('.app-version').forEach((e) => { e.textContent = APP_VERSION; });

  const sw = await versionSW();
  document.querySelectorAll('.sw-version').forEach((e) => { e.textContent = sw || '—'; });

  // Solo si el service worker contestó: sin él no hay nada que comparar.
  const desfase = !!sw && sw !== APP_VERSION;
  document.querySelectorAll('.version-desfase').forEach((e) => { e.hidden = !desfase; });
}
