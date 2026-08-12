// "Mi registro" del empleado.
//  · Pantalla general: estado actual de hoy (timer en vivo) + fichajes de hoy.
//  · Botón "Ver mi registro": historial por semana / mes / año.
// Se actualiza en tiempo real cuando ficha en el kiosco. v2
import { ctx } from '../auth.js';
import {
  fichajesDe, horarioNegocio, miEstado, misFichajesHoy,
  suscribirFichajes, cerrarCanal, turnoPrevisto, diaDe,
} from '../data/fichaje.js';
import { isoDe, lunesDe, sumarDias, etiquetaSemana } from '../data/semanas.js';

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
  volver.textContent = '‹ Volver';
  volver.addEventListener('click', () => { vista = 'general'; pintar(); });
  cont.appendChild(volver);

  const barra = document.createElement('div');
  barra.className = 'reg-barra';
  barra.innerHTML =
    '<div class="reg-modos">' +
      ['semana', 'mes', 'anio'].map((m) =>
        '<button type="button" class="reg-modo' + (m === modo ? ' activo' : '') +
        '" data-modo="' + m + '">' + ETI[m] + '</button>').join('') +
    '</div>' +
    '<div class="reg-nav">' +
      '<button type="button" class="reg-flecha" id="reg-ant">&lsaquo;</button>' +
      '<span class="reg-etiqueta" id="reg-etiqueta"></span>' +
      '<button type="button" class="reg-flecha" id="reg-sig">&rsaquo;</button>' +
    '</div>';
  cont.appendChild(barra);

  const lista = document.createElement('div');
  lista.id = 'reg-lista';
  cont.appendChild(lista);

  barra.querySelectorAll('.reg-modo').forEach((b) => {
    b.onclick = () => { modo = b.dataset.modo; ancla = new Date(); pintarLista(); };
  });
  $('reg-ant').onclick = () => mover(-1);
  $('reg-sig').onclick = () => mover(1);

  await pintarLista();
}

function mover(dir) {
  const d = new Date(ancla);
  if (modo === 'semana') d.setDate(d.getDate() + dir * 7);
  else if (modo === 'mes') d.setMonth(d.getMonth() + dir);
  else d.setFullYear(d.getFullYear() + dir);
  ancla = d;
  pintarLista();
}

function rango() {
  const a = new Date(ancla);
  if (modo === 'semana') { const l = isoDe(lunesDe(a)); return { desde: l, hasta: sumarDias(l, 6) }; }
  if (modo === 'mes') {
    const y = a.getFullYear(), m = a.getMonth();
    return { desde: isoDe(new Date(y, m, 1)), hasta: isoDe(new Date(y, m + 1, 0)) };
  }
  const y = a.getFullYear();
  return { desde: y + '-01-01', hasta: y + '-12-31' };
}

function etiqueta() {
  const a = new Date(ancla);
  if (modo === 'semana') return etiquetaSemana(isoDe(lunesDe(a)));
  if (modo === 'mes') return MESES[a.getMonth()] + ' ' + a.getFullYear();
  return String(a.getFullYear());
}

async function pintarLista() {
  const lista = $('reg-lista');
  const et = $('reg-etiqueta');
  if (et) et.textContent = etiqueta();
  if (!lista) return;
  lista.innerHTML = '<div class="panel"><span class="empty-note">Cargando…</span></div>';

  const { desde, hasta } = rango();
  let fich = [];
  try {
    fich = await fichajesDe(ctx.workerId, desde, hasta);
  } catch (e) {
    lista.innerHTML = '<div class="panel"><span class="empty-note">'
      + (e.message || 'No se pudo cargar') + '</span></div>';
    return;
  }

  const porDia = {};
  for (const f of fich) (porDia[diaDe(f.momento)] ||= []).push(f);
  const dias = Object.keys(porDia).sort();

  lista.innerHTML = '';
  if (dias.length === 0) {
    lista.innerHTML = '<div class="panel"><span class="empty-note">'
      + 'Sin fichajes en este periodo.</span></div>';
    return;
  }

  const cfg = horarioNegocio();
  const tramosPorDia = {};
  await Promise.all(dias.map(async (d) => {
    try { tramosPorDia[d] = await turnoPrevisto(ctx.workerId, d); }
    catch (_) { tramosPorDia[d] = []; }
  }));

  let totalPeriodo = 0;
  for (const clave of dias) {
    const items = porDia[clave];
    const fecha = new Date(clave + 'T12:00:00');
    const tramos = tramosPorDia[clave] || [];

    const panel = document.createElement('div');
    panel.className = 'panel reg-dia';

    const tit = document.createElement('div');
    tit.className = 'reg-dia-tit';
    tit.textContent = fecha.toLocaleDateString('es-ES',
      { weekday: 'long', day: 'numeric', month: 'short' });
    if (tramos.length) {
      const h = document.createElement('span');
      h.className = 'reg-dia-hor';
      h.textContent = tramos.map((t) => t.desde + ' – ' + t.hasta).join(' · ');
      tit.appendChild(h);
    }
    panel.appendChild(tit);

    for (const f of items) panel.appendChild(filaFichaje(f, tramos, cfg));

    const seg = totalSeg(items);
    totalPeriodo += seg;
    const tot = document.createElement('div');
    tot.className = 'reg-dia-total';
    tot.innerHTML = 'Total del día: <b>' + fmtHMS(seg) + '</b>';
    panel.appendChild(tot);
    lista.appendChild(panel);
  }

  const resumen = document.createElement('div');
  resumen.className = 'reg-resumen';
  resumen.innerHTML = 'Total del periodo: <b>' + fmtHMS(totalPeriodo) + '</b>';
  lista.appendChild(resumen);
}

/* ========================= AUXILIARES ========================= */
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
    if (a != null && b != null && b > a) t += b - a;
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
