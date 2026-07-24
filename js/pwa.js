// Registro del service worker, aviso de versión nueva e instalación.
const $ = (id) => document.getElementById(id);

export function initPWA() {
  registrarSW();
  prepararInstalacion();
}

/* ---------- Service worker ---------- */
function registrarSW() {
  if (!('serviceWorker' in navigator)) return;

  navigator.serviceWorker.register('./sw.js').then((reg) => {
    // Si ya hay uno esperando, avisamos de inmediato
    if (reg.waiting && navigator.serviceWorker.controller) mostrarAviso(reg.waiting);

    reg.addEventListener('updatefound', () => {
      const nuevo = reg.installing;
      if (!nuevo) return;
      nuevo.addEventListener('statechange', () => {
        // 'installed' + hay controlador = es una actualización, no la primera vez
        if (nuevo.state === 'installed' && navigator.serviceWorker.controller) {
          mostrarAviso(nuevo);
        }
      });
    });

    // Comprobar actualizaciones al volver a la app
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update().catch(() => {});
    });
  }).catch((err) => console.warn('Service worker:', err));

  // Cuando el nuevo toma el control, recargamos una sola vez
  let recargando = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (recargando) return;
    recargando = true;
    location.reload();
  });
}

function mostrarAviso(worker) {
  const barra = $('barra-update');
  if (!barra) return;
  barra.hidden = false;
  const btn = $('btn-update');
  btn.onclick = () => {
    btn.disabled = true;
    btn.textContent = 'Actualizando…';
    worker.postMessage('ACTIVAR_YA');
  };
  $('btn-update-luego').onclick = () => { barra.hidden = true; };
}

/* ---------- Instalar como aplicación ---------- */
let promptInstalacion = null;

function prepararInstalacion() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    promptInstalacion = e;
    const b = $('btn-instalar');
    if (b) b.hidden = false;
  });

  window.addEventListener('appinstalled', () => {
    promptInstalacion = null;
    const b = $('btn-instalar');
    if (b) b.hidden = true;
  });

  const b = $('btn-instalar');
  if (b) {
    b.addEventListener('click', async () => {
      if (!promptInstalacion) return;
      promptInstalacion.prompt();
      await promptInstalacion.userChoice;
      promptInstalacion = null;
      b.hidden = true;
    });
  }

  // En iPhone no existe beforeinstallprompt: se explica cómo hacerlo a mano
  const esIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const yaInstalada = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;
  const ayuda = $('ayuda-ios');
  if (ayuda && esIOS && !yaInstalada) ayuda.hidden = false;
}
