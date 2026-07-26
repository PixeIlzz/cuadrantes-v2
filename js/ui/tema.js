// Tema claro / oscuro / automático. Se recuerda en el dispositivo.
const CLAVE = 'staffpoint-tema';
const $ = (id) => document.getElementById(id);

export function aplicarTemaGuardado() {
  aplicar(leer());
}

function leer() {
  try { return localStorage.getItem(CLAVE) || 'auto'; } catch (_) { return 'auto'; }
}

function aplicar(modo) {
  const oscuro = (modo === 'oscuro')
    || (modo === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-tema', oscuro ? 'oscuro' : 'claro');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', oscuro ? '#0a0e17' : '#182135');
}

/* Si está en automático, sigue los cambios del sistema al momento */
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (leer() === 'auto') aplicar('auto');
});

/* Monta los botones de un contenedor concreto (gestor y empleado) */
export function initTema(contenedorId) {
  const cont = $(contenedorId);
  if (!cont) return;
  const opciones = [
    { v: 'claro',  l: 'Claro' },
    { v: 'oscuro', l: 'Oscuro' },
    { v: 'auto',   l: 'Automático' },
  ];
  cont.innerHTML = '';
  const actual = leer();
  for (const o of opciones) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tema-btn' + (actual === o.v ? ' activo' : '');
    b.innerHTML = '<span class="tema-muestra ' + o.v + '"></span><span></span>';
    b.querySelector('span:last-child').textContent = o.l;
    b.addEventListener('click', () => {
      try { localStorage.setItem(CLAVE, o.v); } catch (_) {}
      aplicar(o.v);
      // Refresca la marca de activo en todos los selectores de la app
      document.querySelectorAll('.tema-opciones').forEach((c) => {
        if (c.id) initTema(c.id);
      });
    });
    cont.appendChild(b);
  }
}
