// "Mi registro" del empleado.
//  · Pantalla general: estado actual de hoy (timer en vivo) + fichajes de hoy.
//  · Botón "Ver mi registro": historial por semana / mes / año.
// Se actualiza en tiempo real cuando ficha en el kiosco. v2
import { ctx } from '../auth.js';
import {
  fichajesDe, horarioNegocio, miEstado, misFichajesHoy,
  suscribirFichajes, cerrarCanal, turnoPrevisto, diaDe,
} from '../data/fichaje.js';
import { pintarArbolRegistro } from './registro-arbol.js';
import { pedirCorreccion } from './correccion.js';
import { misSolicitudes, retirarSolicitud } from '../data/solicitudes.js';
import { confirmar } from './confirmar.js';
import { toast } from './toast.js';

const $ = (id) => document.getElementById(id);
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ETI = { semana: 'Semana', mes: 'Mes', anio: 'Año' };

let vista = 'general';        // 'general' | 'registro'
let modo = 'semana';
let ancla = new Date();
let headerTimer = null;
let canalRt = null;

/* ============================ ENTRADA ============================ */
export async function abrirMiRegistro() {
  const cont = $('emp-fichaje');
  if (!cont) return;

  if (headerTimer) { clearInterval(headerTimer); headerTimer = null; }
  if (canalRt) { cerrarCanal(canalRt); canalRt = null; }

  vista = 'general';
  await pintar();

  headerTimer = setInterval(actualizarTimer, 1000);
  if (ctx.business) {
    canalRt = suscribirFichajes(ctx.business.id, () => { pintar(); });
  }
}

async function pintar() {
  const cont = $('emp-fichaje');
  if (!cont) return;
  cont.innerHTML = '';
  if (vista === 'general') await pintarGeneral(cont);
  else await pintarRegistro(cont);
}

/* ========================= PANTALLA GENERAL ========================= */
async function pintarGeneral(cont) {
  const box = document.createElement('div');
  box.className = 'reg-estado';
  box.id = 'reg-estado';
  box.innerHTML = '<div class="re-fecha"></div><div class="re-timer">00:00:00</div>'
    + '<div class="re-estado-txt">Comprobando…</div><div class="re-sub"></div>';
  cont.appendChild(box);

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn primary reg-ver-btn';
  btn.textContent = '📅 Ver mi registro';
  btn.addEventListener('click', () => {
    vista = 'registro'; modo = 'semana'; ancla = new Date(); pintar();
  });
  cont.appendChild(btn);

  const hoyBox = document.createElement('div');
  hoyBox.className = 'panel';
  hoyBox.innerHTML = '<h2>Hoy</h2><div id="reg-hoy"><span class="empty-note">Cargando…</span></div>';
  cont.appendChild(hoyBox);

  let estado = { dentro: false, desde: null };
  let hoy = [];
  try { estado = await miEstado(); } catch (_) {}
  try { hoy = await misFichajesHoy(); } catch (_) {}

  const cfg = horarioNegocio();
  const hoyIso = diaDe(new Date());
  let tramosHoy = [];
  try { tramosHoy = await turnoPrevisto(ctx.workerId, hoyIso); } catch (_) {}

  const tarde = (estado.dentro && estado.desde)
    ? !!calcularRetraso({ tipo: 'entrada', momento: estado.desde }, tramosHoy, cfg) : false;

  box.dataset.dentro = estado.dentro ? '1' : '';
  box.dataset.desde = estado.desde || '';
  box.dataset.tarde = tarde ? '1' : '';
  box.dataset.max = String(minDeTramos(tramosHoy));
  box.dataset.hoyseg = String(totalSeg(hoy));
  box.querySelector('.re-fecha').textContent =
    new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

  const previsto = tramosHoy.length
    ? tramosHoy.map((t) => t.desde + ' – ' + t.hasta).join(' · ') : '';
  box.querySelector('.re-sub').textContent = (estado.dentro && estado.desde)
    ? ('Entrada a las ' + hora(estado.desde) + (previsto ? ' · previsto ' + previsto : ''))
    : (previsto ? 'Horario previsto hoy: ' + previsto : 'Hoy no tienes turno previsto');

  actualizarTimer();

  const lista = $('reg-hoy');
  lista.innerHTML = '';
  if (hoy.length === 0) {
    lista.innerHTML = '<span class="empty-note">Aún no has fichado hoy.</span>';
  } else {
    for (const f of hoy) lista.appendChild(filaFichaje(f, tramosHoy, cfg));
    const tot = document.createElement('div');
    tot.className = 'reg-dia-total';
    tot.innerHTML = 'Total de hoy: <b>' + fmtHMS(totalSeg(hoy)) + '</b>';
    lista.appendChild(tot);
  }
}

function actualizarTimer() {
  const box = $('reg-estado');
  if (!box) return;
  const txt = box.querySelector('.re-estado-txt');
  const timer = box.querySelector('.re-timer');
  if (!txt || !timer) return;

  if (box.dataset.dentro === '1' && box.dataset.desde) {
    const ms = Date.now() - new Date(box.dataset.desde).getTime();
    const max = Number(box.dataset.max) || 0;
    const exceso = max > 0 && (ms / 60000) > max;
    const rojo = box.dataset.tarde === '1' || exceso;
    timer.textContent = fmtHMS(Math.floor(ms / 1000));
    txt.textContent = rojo
      ? (box.dataset.tarde === '1' ? 'Trabajando · fichaste tarde' : 'Trabajando · exceso de horas')
      : 'Estás trabajando';
    box.className = 'reg-estado ' + (rojo ? 'rojo' : 'activo');
  } else {
    const seg = Number(box.dataset.hoyseg) || 0;
    timer.textContent = fmtHMS(seg);
    txt.textContent = seg > 0 ? 'Jornada terminada · hoy has trabajado' : 'No has fichado hoy';
    box.className = 'reg-estado' + (seg > 0 ? ' hecho' : '');
  }
}

/* ========================= HISTORIAL ========================= */
async function pintarRegistro(cont) {
  const volver = document.createElement('button');
  volver.type = 'button';
  volver.className = 'btn small reg-volver';
  volver.textContent = '\u2039 Volver';
  volver.addEventListener('click', () => { vista = 'general'; pintar(); });
  cont.appendChild(volver);

  const tit = document.createElement('h2');
  tit.className = 'arb-titulo';
  tit.textContent = 'Mi registro de fichajes';
  cont.appendChild(tit);

  // Los días sin ningún fichaje no aparecen en el árbol —se construye a partir
  // de los fichajes—, así que el olvido completo necesita su propia entrada.
  const falta = document.createElement('button');
  falta.type = 'button';
  falta.className = 'btn small reg-falta-dia';
  falta.textContent = '✎ Falta un día entero';
  falta.title = 'Un día en el que no fichaste nada y por eso no sale en la lista';
  falta.addEventListener('click', async () => {
    if (await pedirCorreccion(null, [])) pintar();
  });
  cont.appendChild(falta);

  // Estado de sus correcciones. Va aquí y no en Solicitudes porque esa pestaña
  // desaparece si el gestor apaga las solicitudes, y el trabajador tiene que
  // poder seguir sus correcciones igualmente.
  const misCorr = document.createElement('div');
  misCorr.id = 'reg-correcciones';
  cont.appendChild(misCorr);
  pintarCorrecciones(misCorr);

  const caja = document.createElement('div');
  caja.id = 'reg-lista';
  cont.appendChild(caja);

  await pintarArbolRegistro(caja, ctx.workerId, {
    exportar: false,
    onCorregir: async (dia, items) => {
      if (await pedirCorreccion(dia, items)) pintar();
    },
  });
}

/* ---- Mis correcciones: pendientes y las últimas resueltas ---- */
const ESTADO_CORR = { pending: 'Pendiente', approved: 'Aprobada', denied: 'Denegada' };

async function pintarCorrecciones(cont) {
  let lista = [];
  try {
    lista = (await misSolicitudes()).filter((s) => s.type === 'timefix');
  } catch (_) { return; }

  // Todas las pendientes, y solo las 3 últimas ya resueltas
  const pendientes = lista.filter((s) => s.status === 'pending');
  const resueltas = lista.filter((s) => s.status !== 'pending').slice(0, 3);
  const mostrar = [...pendientes, ...resueltas];
  if (mostrar.length === 0) { cont.innerHTML = ''; return; }

  const panel = document.createElement('div');
  panel.className = 'panel';
  const tit = document.createElement('h2');
  tit.textContent = 'Mis correcciones';
  panel.appendChild(tit);

  for (const s of mostrar) {
    const fila = document.createElement('div');
    fila.className = 'corr-fila corr-' + s.status;

    const txt = document.createElement('div');
    txt.className = 'corr-txt';
    txt.innerHTML = '<b></b><span class="corr-motivo"></span>';
    txt.querySelector('b').textContent =
      (s.start_date ? new Date(s.start_date + 'T12:00:00').toLocaleDateString('es-ES',
        { day: 'numeric', month: 'short' }) : '') + ' · ' + textoFix(s.fix);
    txt.querySelector('.corr-motivo').textContent = s.message || '';
    fila.appendChild(txt);

    const chip = document.createElement('span');
    chip.className = 'status-chip sol-estado-' + s.status;
    chip.textContent = ESTADO_CORR[s.status] || s.status;
    fila.appendChild(chip);

    if (s.manager_note) {
      const n = document.createElement('div');
      n.className = 'corr-respuesta';
      n.textContent = 'Respuesta: ' + s.manager_note;
      fila.appendChild(n);
    }

    if (s.status === 'pending') {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'btn small'; b.textContent = 'Retirar';
      b.addEventListener('click', async () => {
        const ok = await confirmar('Se retirará la corrección. ¿Continuar?',
          { textoOk: 'Retirar', peligro: true });
        if (!ok) return;
        try { await retirarSolicitud(s.id); toast('Corrección retirada'); pintar(); }
        catch (err) { toast(err.message); }
      });
      fila.appendChild(b);
    }

    panel.appendChild(fila);
  }

  cont.innerHTML = '';
  cont.appendChild(panel);
}

function textoFix(fix) {
  const f = fix || {};
  const m = f.momento ? new Date(f.momento).toLocaleTimeString('es-ES',
    { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Atlantic/Canary' }) : '?';
  if (f.accion === 'editar') return 'cambiar una hora a las ' + m;
  if (f.accion === 'anadir') return 'añadir la ' + (f.tipo === 'entrada' ? 'entrada' : 'salida') + ' de las ' + m;
  if (f.accion === 'borrar') return 'borrar un fichaje que sobra';
  if (f.accion === 'jornada') return 'añadir la jornada entera';
  return 'corrección';
}

/* Agrupa los días según el modo activo */
/* Bloque de un día con sus fichajes */
function filaFichaje(f, tramos, cfg) {
  const tarde = calcularRetraso(f, tramos, cfg);
  const fila = document.createElement('div');
  fila.className = 'reg-fila ' + f.tipo;
  fila.innerHTML =
    '<span class="reg-tipo">' + (f.tipo === 'entrada' ? '&#9654; Entrada' : '&#9209; Salida') + '</span>' +
    '<span class="reg-hora">' + hora(f.momento) +
      (f.estimado ? ' <em>(estimado)</em>' : '') +
      (f.origen === 'gestor' ? ' <em>(corregido)</em>' : '') + '</span>' +
    (tarde ? '<span class="reg-tarde">' + tarde + '</span>' : '');
  return fila;
}

function hora(iso) {
  return new Date(iso).toLocaleTimeString('es-ES',
    { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Atlantic/Canary' });
}
function minutosDelDia(iso) {
  const s = new Date(iso).toLocaleTimeString('es-ES',
    { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Atlantic/Canary' });
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}
function hhmmAMin(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
function minDeTramos(tramos) {
  let t = 0;
  for (const x of (tramos || [])) {
    const a = hhmmAMin(x.desde), b = hhmmAMin(x.hasta);
    // Un tramo que cruza medianoche (20:00-01:00) cuenta hasta el día siguiente
    if (a != null && b != null) t += (b > a) ? (b - a) : (b + 1440 - a);
  }
  return t;
}
function totalSeg(fichajes) {
  let s = 0, e = null;
  for (const f of (fichajes || [])) {
    if (f.tipo === 'entrada') e = new Date(f.momento);
    else if (f.tipo === 'salida' && e) { s += Math.round((new Date(f.momento) - e) / 1000); e = null; }
  }
  if (e) s += Math.round((Date.now() - e) / 1000);
  return s;
}
function fmtHMS(seg) {
  const t = Math.max(0, Math.floor(seg));
  const p = (n) => String(n).padStart(2, '0');
  return p(Math.floor(t / 3600)) + ':' + p(Math.floor((t % 3600) / 60)) + ':' + p(t % 60);
}
function calcularRetraso(f, tramos, cfg) {
  if (f.tipo !== 'entrada') return null;
  const lista = tramos || [];
  if (lista.length === 0) return null;
  const minFich = minutosDelDia(f.momento);
  let mejor = null;
  for (const t of lista) {
    const ini = hhmmAMin(t.desde);
    if (ini == null) continue;
    if (minFich >= ini - 30 && minFich <= ini + 240) {
      if (mejor === null || Math.abs(minFich - ini) < Math.abs(minFich - mejor)) mejor = ini;
    }
  }
  if (mejor === null) return null;
  const diff = minFich - mejor;
  const margen = Math.round((Number(cfg.margen_seg) || 300) / 60);
  return diff > margen ? ('+' + diff + ' min tarde') : null;
}
