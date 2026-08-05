// Campanita de notificaciones + centro de preferencias en Ajustes.
import { toast } from './toast.js';
import { confirmar } from './confirmar.js';
import {
  listarNotificaciones, contarNoLeidas, marcarLeida, marcarTodasLeidas, borrarTodas,
  leerPreferencias, guardarPreferencia, TIPOS_GESTOR, TIPOS_EMPLEADO,
} from '../data/notificaciones.js';

const $ = (id) => document.getElementById(id);
let irAPestana = null;
let sondeo = null;

const ICONO = {
  request_new: '📩', request_resolved: '✅',
  week_published: '📅', announcement: '📣',
  employee_joined: '👤', week_changed: '✏️', other: '🔔',
};

function haceCuanto(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return 'hace ' + Math.floor(s / 60) + ' min';
  if (s < 86400) return 'hace ' + Math.floor(s / 3600) + ' h';
  const d = Math.floor(s / 86400);
  if (d < 7) return 'hace ' + d + (d === 1 ? ' día' : ' días');
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export function initNotificaciones(navegar) {
  irAPestana = navegar;
  const btn = $('btn-campana');
  if (btn) btn.addEventListener('click', abrirPanel);
  document.addEventListener('click', (e) => {
    const panel = $('panel-notif');
    const camp = $('btn-campana');
    if (panel && !panel.hidden && !panel.contains(e.target) && e.target !== camp
        && !camp.contains(e.target)) {
      panel.hidden = true;
    }
  });
  refrescarBadge();
  // Sondeo suave cada 60 s mientras la app está abierta y visible
  if (sondeo) clearInterval(sondeo);
  sondeo = setInterval(() => {
    if (document.visibilityState === 'visible') refrescarBadge();
  }, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refrescarBadge();
  });
}

export async function refrescarBadge() {
  try {
    const n = await contarNoLeidas();
    const b = $('badge-campana');
    if (b) { b.textContent = n > 9 ? '9+' : n; b.hidden = (n === 0); }
  } catch (_) {}
}

async function abrirPanel() {
  const panel = $('panel-notif');
  if (!panel) return;
  if (!panel.hidden) { panel.hidden = true; return; }
  panel.hidden = false;
  const lista = $('notif-lista');
  lista.innerHTML = '<div class="notif-vacio">Cargando…</div>';
  try {
    const items = await listarNotificaciones();
    lista.innerHTML = '';
    if (items.length === 0) {
      lista.innerHTML = '<div class="notif-vacio">No tienes notificaciones.</div>';
      return;
    }
    for (const n of items) lista.appendChild(fila(n));
  } catch (err) {
    lista.innerHTML = '<div class="notif-vacio">No se pudieron cargar.</div>';
  }
}

function fila(n) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'notif-item' + (n.read_at ? '' : ' no-leida');
  el.innerHTML =
    '<span class="notif-ico">' + (ICONO[n.type] || '🔔') + '</span>' +
    '<span class="notif-txt">' +
      '<span class="notif-tit"></span>' +
      (n.body ? '<span class="notif-body"></span>' : '') +
      '<span class="notif-time">' + haceCuanto(n.created_at) + '</span>' +
    '</span>';
  el.querySelector('.notif-tit').textContent = n.title;
  if (n.body) el.querySelector('.notif-body').textContent = n.body;
  el.addEventListener('click', async () => {
    try { if (!n.read_at) { await marcarLeida(n.id); refrescarBadge(); } } catch (_) {}
    $('panel-notif').hidden = true;
    if (n.link_tab && irAPestana) irAPestana(n.link_tab);
  });
  return el;
}

export async function accionBorrarTodas() {
  const ok = await confirmar('¿Borrar todas tus notificaciones? No se puede deshacer.',
    { textoOk: 'Borrar', peligro: true });
  if (!ok) return;
  try {
    await borrarTodas();
    refrescarBadge();
    const lista = $('notif-lista');
    if (lista) lista.innerHTML = '<div class="notif-vacio">No tienes notificaciones.</div>';
    toast('Notificaciones borradas');
  } catch (err) { toast(err.message); }
}

export async function accionMarcarTodas() {
  try {
    await marcarTodasLeidas();
    refrescarBadge();
    const lista = $('notif-lista');
    if (lista) lista.querySelectorAll('.no-leida').forEach((e) => e.classList.remove('no-leida'));
    toast('Todas marcadas como leídas');
  } catch (err) { toast(err.message); }
}

/* ---------- Centro de preferencias (Ajustes) ---------- */
export async function pintarPreferencias(contenedorId, esGestor) {
  const cont = $(contenedorId);
  if (!cont) return;
  cont.innerHTML = '<span class="empty-note">Cargando…</span>';
  try {
    const { prefs } = await leerPreferencias();
    const tipos = esGestor ? TIPOS_GESTOR : TIPOS_EMPLEADO;
    cont.innerHTML = '';
    for (const t of tipos) {
      const activo = (prefs && t.id in prefs) ? prefs[t.id] !== false : true;
      const fila = document.createElement('label');
      fila.className = 'pref-fila';
      const txt = document.createElement('span');
      txt.className = 'pref-label';
      txt.textContent = t.label;
      const sw = document.createElement('input');
      sw.type = 'checkbox';
      sw.className = 'pref-switch';
      sw.checked = activo;
      sw.addEventListener('change', async () => {
        try { await guardarPreferencia(t.id, sw.checked); }
        catch (err) { sw.checked = !sw.checked; toast(err.message); }
      });
      fila.append(txt, sw);
      cont.appendChild(fila);
    }
  } catch (err) {
    cont.innerHTML = '<span class="empty-note">No se pudieron cargar las preferencias.</span>';
  }
}
