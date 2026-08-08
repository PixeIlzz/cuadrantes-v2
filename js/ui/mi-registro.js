// Vista "Mi registro" del empleado: sus fichajes por día / semana / mes / año.
// Reutiliza el mismo estilo visual que "mis turnos". v1
import { ctx } from '../auth.js';
import { fichajesDe, horarioNegocio, miEstado, misFichajesHoy, suscribirFichajes, cerrarCanal } from '../data/fichaje.js';
import { isoDe, lunesDe, sumarDias, etiquetaSemana } from '../data/semanas.js';

const $ = (id) => document.getElementById(id);
const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ETI = { dia: 'Día', semana: 'Semana', mes: 'Mes', anio: 'Año' };

let modo = 'semana';
let ancla = new Date();
let headerTimer = null;
let canalRt = null;

export async function abrirMiRegistro() {
  const cont = $('emp-fichaje');
  if (!cont) return;

  // Limpiamos timers/canal de una apertura anterior
  if (headerTimer) { clearInterval(headerTimer); headerTimer = null; }
  if (canalRt) { cerrarCanal(canalRt); canalRt = null; }

  cont.innerHTML = '';

  // --- Cabecera: estado actual del fichaje (siempre arriba) ---
  const estado = document.createElement('div');
  estado.id = 'reg-estado';
  estado.className = 'reg-estado';
  estado.innerHTML =
    '<div class="re-fecha"></div>' +
    '<div class="re-timer">00:00:00</div>' +
    '<div class="re-estado-txt"></div>' +
    '<div class="re-sub"></div>';
  cont.appendChild(estado);

  const barra = document.createElement('div');
  barra.className = 'reg-barra';
  barra.innerHTML =
    '<div class="reg-modos">' +
      ['dia', 'semana', 'mes', 'anio'].map((m) =>
        '<button type="button" class="reg-modo' + (m === modo ? ' activo' : '') +
        '" data-modo="' + m + '">' + ETI[m] + '</button>').join('') +
    '</div>' +
    '<div class="reg-nav">' +
      '<button type="button" class="reg-flecha" id="reg-ant">‹</button>' +
      '<span class="reg-etiqueta" id="reg-etiqueta"></span>' +
      '<button type="button" class="reg-flecha" id="reg-sig">›</button>' +
    '</div>';
  cont.appendChild(barra);

  const lista = document.createElement('div');
  lista.id = 'reg-lista';
  cont.appendChild(lista);

  barra.querySelectorAll('.reg-modo').forEach((b) => {
    b.onclick = () => { modo = b.dataset.modo; ancla = new Date(); abrirMiRegistro(); };
  });
  $('reg-ant').onclick = () => { mover(-1); };
  $('reg-sig').onclick = () => { mover(1); };

  await pintarEstadoActual();
  await pintarLista();

  // Timer en vivo (1 s) y Realtime (se repinta al fichar en el kiosco)
  headerTimer = setInterval(actualizarEstadoHeader, 1000);
  if (ctx.business) {
    canalRt = suscribirFichajes(ctx.business.id, () => {
      pintarEstadoActual();
      pintarLista();
    });
  }
}

/* ---------- Cabecera de estado actual ---------- */
async function pintarEstadoActual() {
  const cont = $('reg-estado');
  if (!cont) return;
  let estado, hoy;
  try { estado = await miEstado(); hoy = await misFichajesHoy(); }
  catch (_) { return; }

  const cfg = horarioNegocio();
  const claveDia = DIAS[(new Date().getDay() + 6) % 7];
  const tarde = (estado.dentro && estado.desde)
    ? !!calcularRetraso({ tipo: 'entrada', momento: estado.desde }, claveDia, cfg) : false;

  cont.dataset.dentro = estado.dentro ? '1' : '';
  cont.dataset.desde = estado.desde || '';
  cont.dataset.tarde = tarde ? '1' : '';
  cont.dataset.max = String(minEstablecido(cfg, claveDia));
  cont.dataset.hoymin = String(totalMin(hoy));

  cont.querySelector('.re-fecha').textContent =
    new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  cont.querySelector('.re-sub').textContent =
    (estado.dentro && estado.desde) ? ('Entrada a las ' + hora(estado.desde)) : '';

  actualizarEstadoHeader();
}

function actualizarEstadoHeader() {
  const cont = $('reg-estado');
  if (!cont) return;
  const txt = cont.querySelector('.re-estado-txt');
  const timer = cont.querySelector('.re-timer');
  if (!txt || !timer) return;

  if (cont.dataset.dentro === '1' && cont.dataset.desde) {
    const ms = Date.now() - new Date(cont.dataset.desde).getTime();
    const max = Number(cont.dataset.max) || 0;
    const exceso = max > 0 && (ms / 60000) > max;
    const rojo = cont.dataset.tarde === '1' || exceso;
    timer.textContent = fmtDurHMS(ms);
    txt.textContent = rojo
      ? (cont.dataset.tarde === '1' ? 'Trabajando · fichaste tarde' : 'Trabajando · exceso de horas')
      : 'Estás trabajando';
    cont.className = 'reg-estado ' + (rojo ? 'rojo' : 'activo');
  } else {
    const hoymin = Number(cont.dataset.hoymin) || 0;
    timer.textContent = hoymin > 0 ? minAHoras(hoymin) : '00:00:00';
    txt.textContent = hoymin > 0 ? 'No estás fichado · hoy llevas' : 'No has fichado hoy';
    cont.className = 'reg-estado';
  }
}

function minEstablecido(cfg, claveDia) {
  const tramos = (cfg.horarios && cfg.horarios[claveDia]) || [];
  let t = 0;
  for (const x of tramos) {
    const a = hhmmAMin(x.desde), b = hhmmAMin(x.hasta);
    if (a != null && b != null && b > a) t += b - a;
  }
  return t;
}
function fmtDurHMS(ms) {
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p = (n) => String(n).padStart(2, '0');
  return p(h) + ':' + p(m) + ':' + p(s);
}

function mover(dir) {
  const d = new Date(ancla);
  if (modo === 'dia') d.setDate(d.getDate() + dir);
  else if (modo === 'semana') d.setDate(d.getDate() + dir * 7);
  else if (modo === 'mes') d.setMonth(d.getMonth() + dir);
  else d.setFullYear(d.getFullYear() + dir);
  ancla = d;
  pintarLista();
}

function rango() {
  const a = new Date(ancla);
  if (modo === 'dia') { const i = isoDe(a); return { desde: i, hasta: i }; }
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
  if (modo === 'dia') return a.toLocaleDateString('es-ES',
    { weekday: 'long', day: 'numeric', month: 'short' });
  if (modo === 'semana') return etiquetaSemana(isoDe(lunesDe(a)));
  if (modo === 'mes') return MESES[a.getMonth()] + ' ' + a.getFullYear();
  return String(a.getFullYear());
}

async function pintarLista() {
  const lista = $('reg-lista');
  const et = $('reg-etiqueta');
  if (et) et.textContent = etiqueta();
  if (!lista) return;
  lista.innerHTML = '<span class="empty-note">Cargando…</span>';

  const { desde, hasta } = rango();
  let fich;
  try { fich = await fichajesDe(ctx.workerId, desde, hasta); }
  catch (e) { lista.innerHTML = '<span class="empty-note">' + e.message + '</span>'; return; }

  // Agrupar por día (clave yyyy-mm-dd en hora de Canarias)
  const porDia = {};
  for (const f of fich) {
    const clave = new Date(f.momento).toLocaleDateString('en-CA', { timeZone: 'Atlantic/Canary' });
    (porDia[clave] ||= []).push(f);
  }
  const dias = Object.keys(porDia).sort();

  lista.innerHTML = '';
  if (dias.length === 0) {
    lista.innerHTML = '<div class="panel"><span class="empty-note">Sin fichajes en este periodo.</span></div>';
    return;
  }

  const cfg = horarioNegocio();
  let totalPeriodo = 0;

  for (const clave of dias) {
    const items = porDia[clave];
    const fecha = new Date(clave + 'T12:00:00');
    const claveDia = DIAS[(fecha.getDay() + 6) % 7];

    const panel = document.createElement('div');
    panel.className = 'panel reg-dia';

    const tit = document.createElement('div');
    tit.className = 'reg-dia-tit';
    tit.textContent = fecha.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
    panel.appendChild(tit);

    for (const f of items) {
      const tarde = calcularRetraso(f, claveDia, cfg);
      const fila = document.createElement('div');
      fila.className = 'reg-fila ' + f.tipo;
      fila.innerHTML =
        '<span class="reg-tipo">' + (f.tipo === 'entrada' ? '▶ Entrada' : '⏹ Salida') + '</span>' +
        '<span class="reg-hora">' + hora(f.momento) +
          (f.estimado ? ' <em>(estimado)</em>' : '') +
          (f.origen === 'gestor' ? ' <em>(corregido)</em>' : '') + '</span>' +
        (tarde ? '<span class="reg-tarde">' + tarde + '</span>' : '');
      panel.appendChild(fila);
    }

    const min = totalMin(items);
    totalPeriodo += min;
    const tot = document.createElement('div');
    tot.className = 'reg-dia-total';
    tot.innerHTML = 'Total del día: <b>' + minAHoras(min) + '</b>';
    panel.appendChild(tot);
    lista.appendChild(panel);
  }

  const resumen = document.createElement('div');
  resumen.className = 'reg-resumen';
  resumen.innerHTML = 'Total del periodo: <b>' + minAHoras(totalPeriodo) + '</b>';
  lista.appendChild(resumen);
}

/* ---------- helpers ---------- */
function hora(iso) {
  return new Date(iso).toLocaleTimeString('es-ES',
    { hour: '2-digit', minute: '2-digit', timeZone: 'Atlantic/Canary' });
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
function totalMin(fichajes) {
  let mins = 0, e = null;
  for (const f of fichajes) {
    if (f.tipo === 'entrada') e = new Date(f.momento);
    else if (f.tipo === 'salida' && e) { mins += Math.round((new Date(f.momento) - e) / 60000); e = null; }
  }
  if (e) mins += Math.round((Date.now() - e) / 60000);
  return mins;
}
function minAHoras(mins) {
  const h = Math.floor(mins / 60), m = mins % 60;
  return h + 'h ' + String(m).padStart(2, '0') + 'm';
}
function calcularRetraso(f, claveDia, cfg) {
  if (f.tipo !== 'entrada') return null;
  const tramos = (cfg.horarios && cfg.horarios[claveDia]) || [];
  if (!tramos.length) return null;
  const minFich = minutosDelDia(f.momento);
  let mejor = null;
  for (const t of tramos) {
    const ini = hhmmAMin(t.desde);
    if (ini == null) continue;
    if (minFich >= ini - 30 && minFich <= ini + 240) {
      if (mejor === null || Math.abs(minFich - ini) < Math.abs(minFich - mejor)) mejor = ini;
    }
  }
  if (mejor === null) return null;
  const diff = minFich - mejor;
  return diff > 5 ? ('+' + diff + ' min tarde') : null;
}
