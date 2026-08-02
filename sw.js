/* Service worker de Cuadrantes.
   Sube VERSION en cada despliegue: al cambiar, el navegador detecta el
   service worker nuevo, descarga los archivos y avisa al usuario. */
const VERSION = 'v25';
const CACHE = 'cuadrantes-' + VERSION;

const ARCHIVOS = [
  './',
  './index.html',
  './app.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-180.png',
  './icon-maskable-512.png',
  './js/app.js',
  './js/auth.js',
  './js/supabase.js',
  './js/pwa.js',
  './js/ui/toast.js',
  './js/ui/tema.js',
  './js/ui/confirmar.js',
  './js/ui/hoy.js',
  './js/ui/cuadrante.js',
  './js/ui/equipo.js',
  './js/ui/programadas.js',
  './js/ui/ajustes.js',
  './js/ui/avisos.js',
  './js/ui/tareas.js',
  './js/ui/exportar.js',
  './js/ui/migracion.js',
  './js/ui/privacidad.js',
  './js/ui/notificaciones.js',
  './js/ui/push.js',
  './js/ui/push-bienvenida.js',
  './js/data/migracion.js',
  './js/ui/solicitudes.js',
  './js/ui/empleado.js',
  './js/ui/ajustes-empleado.js',
  './js/data/equipo.js',
  './js/data/semanas.js',
  './js/data/empleado.js',
  './js/data/invitaciones.js',
  './js/data/solicitudes.js',
  './js/data/avisos.js',
  './js/data/tareas.js',
  './js/data/notificaciones.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll falla entero si un archivo falla; los añadimos uno a uno
      .then((c) => Promise.allSettled(ARCHIVOS.map((a) => c.add(a))))
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const nombres = await caches.keys();
    await Promise.all(nombres
      .filter((n) => n.startsWith('cuadrantes-') && n !== CACHE)
      .map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

/* La app pide activar la versión nueva sin esperar a cerrar pestañas */
self.addEventListener('message', (e) => {
  if (e.data === 'ACTIVAR_YA') self.skipWaiting();
});

/* Estrategia: la red manda; la caché es la red de seguridad.
   Así nunca se sirve código viejo teniendo conexión, y sin conexión
   la app sigue abriéndose. Las llamadas a Supabase no se cachean. */
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // Supabase, CDN: a la red

  e.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.status === 200) {
        const copia = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copia));
      }
      return res;
    } catch (_) {
      const cacheado = await caches.match(req);
      if (cacheado) return cacheado;
      if (req.mode === 'navigate') {
        const inicio = await caches.match('./index.html');
        if (inicio) return inicio;
      }
      throw new Error('Sin conexión y sin copia guardada');
    }
  })());
});

/* =========================================================
   Notificaciones push (Entrega B)
   ========================================================= */
self.addEventListener('push', (e) => {
  let datos = { title: 'StaffPoint', body: '', tab: '' };
  try { if (e.data) datos = { ...datos, ...e.data.json() }; } catch (_) {}
  const opciones = {
    body: datos.body,
    icon: './icon-192.png',
    badge: './icon-192.png',
    data: { tab: datos.tab || '' },
    vibrate: [80, 40, 80],
  };
  e.waitUntil(self.registration.showNotification(datos.title, opciones));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const tab = (e.notification.data && e.notification.data.tab) || '';
  const destino = self.location.origin + self.location.pathname.replace(/sw\.js$/, '')
    + (tab ? '#tab=' + tab : '');
  e.waitUntil((async () => {
    const clientes = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of clientes) {
      if (c.url.includes(self.location.pathname.replace(/sw\.js$/, '')) && 'focus' in c) {
        c.postMessage({ tipo: 'abrir-tab', tab });
        return c.focus();
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(destino);
  })());
});
