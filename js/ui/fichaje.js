// Interfaz del fichaje. Empleado: botón central + hoy. Gestor: equipo + detalle.
import { toast } from './toast.js';
import { confirmar } from './confirmar.js';
import { ctx } from '../auth.js';
import {
  fichar, misFichajesHoy, miEstado, fichajesHoyEquipo, fichajesDe,
  horarioNegocio, guardarHorarioFichaje, corregirFichaje, borrarFichaje,
  datosLegales, guardarDatosLegales, estadoDeWorker,
  suscribirFichajes, jornadaHoy,
} from '../data/fichaje.js';
import { listarEquipo } from '../data/equipo.js';
import { pintarArbolRegistro } from './registro-arbol.js';
import { etiquetaSemana, lunesDe, sumarDias, isoDe } from '../data/semanas.js';

const $ = (id) => document.getElementById(id);
const DIAS = ['lun','mar','mie','jue','vie','sab','dom'];
const DIAS_LARGO = { lun:'Lunes',mar:'Martes',mie:'Miércoles',jue:'Jueves',vie:'Viernes',sab:'Sábado',dom:'Domingo' };

let relojTimer = null;

/* Hora legible desde un timestamp */
function hora(iso) {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZone: 'Atlantic/Canary' });
}
function minutosDelDia(iso) {
  const d = new Date(iso);
  const s = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Atlantic/Canary' });
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}
function hhmmAMin(hhmm) {
  if (!hhmm) return null;
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

// ==========================================================
//  EMPLEADO
// ==========================================================
export async function abrirFichajeEmpleado() {
  const cont = $('emp-fichaje');
  if (!cont) return;
  cont.innerHTML = '<span class="empty-note">Cargando…</span>';
  try {
    await pintarFichajeEmpleado(cont);
  } catch (err) {
    cont.innerHTML = '<span class="empty-note">' + err.message + '</span>';
  }
}

async function pintarFichajeEmpleado(cont) {
  const estado = await miEstado();
  const hoy = await misFichajesHoy();

  cont.innerHTML = '';

  // Tarjeta con el botón central
  const tarjeta = document.createElement('div');
  tarjeta.className = 'fich-tarjeta';

  const reloj = document.createElement('div');
  reloj.className = 'fich-reloj';
  tarjeta.appendChild(reloj);

  const estadoTxt = document.createElement('div');
  estadoTxt.className = 'fich-estado ' + (estado.dentro ? 'dentro' : 'fuera');
  estadoTxt.textContent = estado.dentro ? 'Estás trabajando' : 'No has fichado';
  tarjeta.appendChild(estadoTxt);

  if (estado.dentro && estado.desde) {
    const desde = document.createElement('div');
    desde.className = 'fich-desde';
    desde.textContent = 'Entrada a las ' + hora(estado.desde);
    tarjeta.appendChild(desde);
  }

  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'fich-boton ' + (estado.dentro ? 'salida' : 'entrada');
  boton.innerHTML = estado.dentro ? '⏹<span>Fichar salida</span>' : '▶<span>Fichar entrada</span>';
  boton.addEventListener('click', async () => {
    boton.disabled = true;
    try {
      const r = await fichar();
      toast((r.tipo === 'entrada' ? 'Entrada' : 'Salida') + ' registrada a las ' + hora(r.momento));
      await pintarFichajeEmpleado(cont);
    } catch (err) {
      toast(err.message);
      boton.disabled = false;
    }
  });
  tarjeta.appendChild(boton);
  cont.appendChild(tarjeta);

  // Reloj en vivo
  const tick = () => {
    reloj.textContent = new Date().toLocaleTimeString('es-ES',
      { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Atlantic/Canary' });
  };
  tick();
  if (relojTimer) clearInterval(relojTimer);
  relojTimer = setInterval(tick, 1000);

  // Fichajes de hoy + total trabajado
  const panel = document.createElement('div');
  panel.className = 'panel';
  const h = document.createElement('h2');
  h.textContent = 'Mis fichajes de hoy';
  panel.appendChild(h);

  if (hoy.length === 0) {
    panel.appendChild(nota('Todavía no has fichado hoy.'));
  } else {
    const lista = document.createElement('div');
    lista.className = 'fich-lista';
    for (const f of hoy) {
      const fila = document.createElement('div');
      fila.className = 'fich-fila ' + f.tipo + (f.estimado ? ' estimado' : '');
      fila.innerHTML = '<span class="ff-tipo">' + (f.tipo === 'entrada' ? '▶ Entrada' : '⏹ Salida')
        + '</span><span class="ff-hora">' + hora(f.momento)
        + (f.estimado ? ' <em>(estimado)</em>' : '') + '</span>';
      lista.appendChild(fila);
    }
    panel.appendChild(lista);

    const total = totalTrabajado(hoy);
    const tot = document.createElement('div');
    tot.className = 'fich-total';
    tot.innerHTML = 'Trabajado hoy: <b>' + total + '</b>';
    panel.appendChild(tot);
  }
  cont.appendChild(panel);
}

/* Suma tramos entrada->salida. Devuelve "Xh Ym". */
function totalSeg(fichajes) {
  let s = 0, entrada = null;
  for (const f of fichajes) {
    if (f.tipo === 'entrada') entrada = new Date(f.momento);
    else if (f.tipo === 'salida' && entrada) {
      s += Math.round((new Date(f.momento) - entrada) / 1000);
      entrada = null;
    }
  }
  if (entrada) s += Math.round((Date.now() - entrada) / 1000);
  return s;
}
function segAHMS(seg) {
  const t = Math.max(0, Math.floor(seg));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
  const p = (n) => String(n).padStart(2, '0');
  return p(h) + ':' + p(m) + ':' + p(s);
}
function totalTrabajado(fichajes) { return segAHMS(totalSeg(fichajes)); }

// ==========================================================
//  GESTOR
// ==========================================================
let equipoCache = [];

export async function abrirFichajeGestor() {
  if (detEstadoTimer) { clearInterval(detEstadoTimer); detEstadoTimer = null; }
  vistaActual = 'lista';
  const cont = $('fichaje-gestor');
  if (!cont) return;
  if (!canalGestor && ctx.business) canalGestor = suscribirFichajes(ctx.business.id, onCambioGestor);
  cont.innerHTML = '<span class="empty-note">Cargando…</span>';
  try {
    equipoCache = await listarEquipo();
    await pintarEquipoHoy(cont);
  } catch (err) {
    cont.innerHTML = '<span class="empty-note">' + err.message + '</span>';
  }
}

async function pintarEquipoHoy(cont) {
  let estado;
  try { estado = await jornadaHoy(); }
  catch (e) { cont.innerHTML = '<span class="empty-note">' + e.message + '</span>'; return; }
  cont.innerHTML = '';

  const h = document.createElement('h2');
  h.className = 'fich-h2';
  h.textContent = 'Hoy · ' + new Date().toLocaleDateString('es-ES',
    { weekday: 'long', day: 'numeric', month: 'long' });
  cont.appendChild(h);

  const lista = document.createElement('div');
  lista.className = 'fich-equipo';

  const cfg = horarioNegocio();

  for (const e of estado) {
    const dentro = !!e.dentro;
    const desde = e.desde || '';
    const tramos = e.tramos || [];                 // SU turno de hoy
    const maxMin = minEstablecidoDia(cfg, tramos);
    const tarde = (dentro && desde)
      ? !!calcularRetraso({ tipo: 'entrada', momento: desde }, tramos, cfg) : false;
    const segHoy = Number(e.seg_hoy) || 0;

    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'fich-emp';
    card.dataset.dentro = dentro ? '1' : '';
    card.dataset.desde = desde || '';
    card.dataset.tarde = tarde ? '1' : '';
    card.dataset.max = String(maxMin);

    const txt = !dentro && segHoy === 0 ? 'Sin fichar'
      : (dentro ? 'Trabajando desde ' + hora(desde) : 'Jornada terminada');
    card.innerHTML = '<div class="fe-nombre"></div>'
      + '<div class="fe-estado">' + txt + '</div>'
      + '<div class="fe-timer"></div>'
      + '<div class="fe-total">Hoy: ' + (segHoy > 0 ? segAHMS(segHoy) : '—') + '</div>';
    card.dataset.seghoy = String(segHoy);
    card.querySelector('.fe-nombre').textContent = e.name;
    const w = equipoCache.find((x) => x.id === e.worker_id) || { id: e.worker_id, name: e.name };
    card.addEventListener('click', () => abrirDetalleEmpleado(w));
    lista.appendChild(card);
  }
  cont.appendChild(lista);

  actualizarEquipoHoy();
  if (equipoTimer) clearInterval(equipoTimer);
  equipoTimer = setInterval(actualizarEquipoHoy, 1000);
}

/* Actualiza color y timer de sesión de cada tarjeta de "Hoy" */
function actualizarEquipoHoy() {
  const cont = $('fichaje-gestor');
  if (!cont) return;
  const cards = cont.querySelectorAll('.fich-emp');
  if (!cards.length) { if (equipoTimer) { clearInterval(equipoTimer); equipoTimer = null; } return; }
  for (const card of cards) {
    const timer = card.querySelector('.fe-timer');
    if (card.dataset.dentro === '1' && card.dataset.desde) {
      const ms = Date.now() - new Date(card.dataset.desde).getTime();
      const max = Number(card.dataset.max) || 0;
      const rojo = card.dataset.tarde === '1' || (max > 0 && ms / 60000 > max);
      if (timer) timer.textContent = segAHMS(Math.floor(ms / 1000));
      card.classList.toggle('activo', !rojo);
      card.classList.toggle('rojo', rojo);
    } else {
      const seg = Number(card.dataset.seghoy) || 0;
      if (timer) timer.textContent = seg > 0 ? segAHMS(seg) : '';
      card.classList.remove('activo', 'rojo');
      card.classList.toggle('hecho', seg > 0);
    }
  }
}

/* Detalle de un empleado con navegación día/semana/mes */
let detWorker = null;
let detEstadoTimer = null, equipoTimer = null;
let canalGestor = null, vistaActual = 'lista', rtPend = null;

async function abrirDetalleEmpleado(w) {
  if (equipoTimer) { clearInterval(equipoTimer); equipoTimer = null; }
  vistaActual = 'detalle';
  detWorker = w;
  await pintarDetalle();
}

/* Realtime: al llegar un fichaje, refresca lo que esté a la vista (con anti-rebote) */
function onCambioGestor() {
  clearTimeout(rtPend);
  rtPend = setTimeout(() => {
    const cont = $('fichaje-gestor');
    if (!cont || cont.offsetParent === null) return;   // pestaña no visible
    if (vistaActual === 'lista') pintarEquipoHoy(cont);
    else rellenarEstadoDetalle();
  }, 250);
}

async function pintarDetalle() {
  const cont = $('fichaje-gestor');
  cont.innerHTML = '';

  // Cabecera: volver + nombre
  const cab = document.createElement('div');
  cab.className = 'fich-det-cab';
  const volver = document.createElement('button');
  volver.type = 'button'; volver.className = 'btn small';
  volver.textContent = '\u2039 Volver';
  volver.addEventListener('click', () => abrirFichajeGestor());
  const nom = document.createElement('h2');
  nom.className = 'fich-det-nombre';
  nom.textContent = detWorker.name;
  cab.append(volver, nom);
  cont.appendChild(cab);

  // Estado actual del empleado
  const box = document.createElement('div');
  box.className = 'reg-estado'; box.id = 'det-estado';
  box.innerHTML = '<div class="re-fecha"></div><div class="re-timer">00:00:00</div>'
    + '<div class="re-estado-txt">Comprobando\u2026</div><div class="re-sub"></div>';
  cont.appendChild(box);
  rellenarEstadoDetalle();

  // Árbol del registro: Año > Mes > Semana > Día, con export en cada nivel
  const tit = document.createElement('h3');
  tit.className = 'arb-titulo';
  tit.textContent = 'Registro de jornada';
  cont.appendChild(tit);

  const caja = document.createElement('div');
  caja.id = 'det-arbol';
  cont.appendChild(caja);
  await pintarArbolRegistro(caja, detWorker.id, { worker: detWorker, exportar: true });
}

/* Retraso: si la entrada es más tarde que el inicio previsto de ese día */
function calcularRetraso(f, claveDia, cfg) {
  if (f.tipo !== 'entrada') return null;
  const tramos = Array.isArray(claveDia) ? claveDia
    : ((cfg.horarios && cfg.horarios[claveDia]) || []);
  if (tramos.length === 0) return null;
  const minFich = minutosDelDia(f.momento);
  // Buscamos el tramo cuyo inicio esté más cerca por debajo del fichaje
  let mejor = null;
  for (const t of tramos) {
    const ini = hhmmAMin(t.desde);
    if (ini == null) continue;
    // margen de 90 min para asociar el fichaje a ese tramo
    if (minFich >= ini - 30 && minFich <= ini + 240) {
      if (mejor === null || Math.abs(minFich - ini) < Math.abs(minFich - mejor)) mejor = ini;
    }
  }
  if (mejor === null) return null;
  const diff = minFich - mejor;
  // Margen de cortesía configurable en Ajustes (por defecto 5 min)
  const margen = Math.round((Number(cfg.margen_seg) || 300) / 60);
  if (diff > margen) return '+' + diff + ' min tarde';
  return null;
}

function minEstablecidoDia(cfg, claveDia) {
  const tramos = Array.isArray(claveDia) ? claveDia
    : ((cfg.horarios && cfg.horarios[claveDia]) || []);
  let t = 0;
  for (const x of tramos) {
    const a = hhmmAMin(x.desde), b = hhmmAMin(x.hasta);
    // Un tramo que cruza medianoche (20:00-01:00) cuenta hasta el día siguiente
    if (a != null && b != null) t += (b > a) ? (b - a) : (b + 1440 - a);
  }
  return t;
}
function totalMin(fichajes) {
  let mins = 0, e = null;
  for (const f of fichajes) {
    if (f.tipo==='entrada') e = new Date(f.momento);
    else if (f.tipo==='salida' && e) { mins += Math.round((new Date(f.momento)-e)/60000); e=null; }
  }
  if (e) mins += Math.round((Date.now()-e)/60000);
  return mins;
}
function minAHoras(mins) {
  const h = Math.floor(mins/60), m = mins%60;
  return h + 'h ' + String(m).padStart(2,'0') + 'm';
}

async function rellenarEstadoDetalle() {
  let est;
  try { est = await estadoDeWorker(detWorker.id); }
  catch (_) { est = { dentro: false, desde: null }; }
  const box = $('det-estado');
  if (!box) return;
  const cfg = horarioNegocio();
  const claveDia = DIAS[(new Date().getDay() + 6) % 7];
  const tarde = (est.dentro && est.desde)
    ? !!calcularRetraso({ tipo: 'entrada', momento: est.desde }, claveDia, cfg) : false;
  box.dataset.dentro = est.dentro ? '1' : '';
  box.dataset.desde = est.desde || '';
  box.dataset.tarde = tarde ? '1' : '';
  box.dataset.max = String(minEstablecidoDia(cfg, claveDia));
  box.querySelector('.re-fecha').textContent =
    new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  box.querySelector('.re-sub').textContent =
    (est.dentro && est.desde) ? ('Entrada a las ' + hora(est.desde)) : '';
  actualizarEstadoDetalle();
  if (detEstadoTimer) clearInterval(detEstadoTimer);
  detEstadoTimer = setInterval(actualizarEstadoDetalle, 1000);
}
function actualizarEstadoDetalle() {
  const box = $('det-estado');
  if (!box) return;
  const txt = box.querySelector('.re-estado-txt'), timer = box.querySelector('.re-timer');
  if (box.dataset.dentro === '1' && box.dataset.desde) {
    const ms = Date.now() - new Date(box.dataset.desde).getTime();
    const max = Number(box.dataset.max) || 0;
    const rojo = box.dataset.tarde === '1' || (max > 0 && ms / 60000 > max);
    timer.textContent = segAHMS(Math.floor(ms / 1000));
    txt.textContent = rojo
      ? (box.dataset.tarde === '1' ? 'Trabajando · fichó tarde' : 'Trabajando · exceso de horas')
      : 'Trabajando ahora';
    box.className = 'reg-estado ' + (rojo ? 'rojo' : 'activo');
  } else {
    timer.textContent = '—';
    txt.textContent = 'No está fichado';
    box.className = 'reg-estado';
  }
}

// ==========================================================
//  EXPORTAR registro (PDF imprimible + CSV)
// ==========================================================
function esc(t) {
  return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ==========================================================
//  AJUSTES: datos legales (razón social + CIF)
// ==========================================================
export function pintarDatosLegales() {
  const cont = $('datos-legales');
  if (!cont) return;
  const leg = datosLegales();
  const rs = $('leg-razon'), cif = $('leg-cif');
  if (rs) rs.value = leg.razon_social || '';
  if (cif) cif.value = leg.cif || '';
  const b = $('btn-guardar-legal');
  if (b) b.onclick = async () => {
    try {
      await guardarDatosLegales({
        razon_social: (rs.value || '').trim(),
        cif: (cif.value || '').trim().toUpperCase(),
      });
      toast('Datos guardados');
    } catch (e) { toast(e.message); }
  };
}

// ==========================================================
//  AJUSTES: horario previsto por día
// ==========================================================
export function pintarAjustesFichaje() {
  const cfg = horarioNegocio();
  const cont = $('fichaje-horarios');

  // El editor de tramos ya no se muestra: el horario de cada turno se
  // define en el cuadrante (Días y columnas). Se conserva como respaldo
  // en la configuración existente, pero no se edita aquí.
  if (cont) for (const d of DIAS) {
    const fila = document.createElement('div');
    fila.className = 'fh-dia';
    const tit = document.createElement('div');
    tit.className = 'fh-dia-tit';
    tit.textContent = DIAS_LARGO[d];
    fila.appendChild(tit);

    const tramos = (cfg.horarios && cfg.horarios[d]) || [];
    const cajaTramos = document.createElement('div');
    cajaTramos.className = 'fh-tramos';
    cajaTramos.dataset.dia = d;

    const pintarTramos = () => {
      cajaTramos.innerHTML = '';
      const lista = (cfg.horarios && cfg.horarios[d]) || [];
      lista.forEach((t, i) => {
        const tr = document.createElement('div');
        tr.className = 'fh-tramo';
        tr.innerHTML = '<input type="time" value="' + (t.desde||'') + '" class="fh-desde">'
          + '<span>a</span><input type="time" value="' + (t.hasta||'') + '" class="fh-hasta">'
          + '<button type="button" class="fh-quitar">✕</button>';
        tr.querySelector('.fh-desde').addEventListener('change', (e) => { t.desde = e.target.value; });
        tr.querySelector('.fh-hasta').addEventListener('change', (e) => { t.hasta = e.target.value; });
        tr.querySelector('.fh-quitar').addEventListener('click', () => {
          cfg.horarios[d].splice(i, 1); pintarTramos();
        });
        cajaTramos.appendChild(tr);
      });
    };

    const add = document.createElement('button');
    add.type = 'button'; add.className = 'btn small'; add.textContent = '+ Tramo';
    add.addEventListener('click', () => {
      cfg.horarios = cfg.horarios || {};
      (cfg.horarios[d] ||= []).push({ desde:'', hasta:'' });
      pintarTramos();
    });

    fila.appendChild(cajaTramos);
    fila.appendChild(add);
    cont.appendChild(fila);
    pintarTramos();
  }

  // --- Margen de cortesía y avisos (se guardan en segundos) ---
  const marIn = $('fichaje-margen');
  if (marIn) marIn.value = Math.round((Number(cfg.margen_seg) || 300) / 60);

  // Reparte unos segundos en la unidad más legible (h > m > s)
  const aUnidad = (seg) => {
    const n = Number(seg) || 0;
    if (n === 0) return { v: 0, u: 'm' };
    if (n % 3600 === 0) return { v: n / 3600, u: 'h' };
    if (n % 60 === 0) return { v: n / 60, u: 'm' };
    return { v: n, u: 's' };
  };
  const aSeg = (v, u) => {
    const n = Math.max(0, parseInt(v, 10) || 0);
    return u === 'h' ? n * 3600 : (u === 'm' ? n * 60 : n);
  };

  const segSalida = (cfg.recordar_salida_seg != null)
    ? cfg.recordar_salida_seg
    : ((cfg.recordar_h != null ? cfg.recordar_h : 9) * 3600);
  const ent = aUnidad(cfg.recordar_entrada_seg || 0);
  const sal = aUnidad(segSalida);
  if ($('fichaje-av-ent'))   $('fichaje-av-ent').value = ent.v;
  if ($('fichaje-av-ent-u')) $('fichaje-av-ent-u').value = ent.u;
  if ($('fichaje-av-sal'))   $('fichaje-av-sal').value = sal.v;
  if ($('fichaje-av-sal-u')) $('fichaje-av-sal-u').value = sal.u;

  // --- Cierre automático de jornadas olvidadas (migración 40) ---
  // Lo ejecuta el cron cada media hora; aquí solo se enciende y se afina.
  const swCierre = $('fichaje-cierre-auto');
  if (swCierre) swCierre.checked = (cfg.cierre_auto_activo === true);
  if ($('fichaje-cierre-margen')) {
    $('fichaje-cierre-margen').value = (cfg.cierre_margen_h != null) ? cfg.cierre_margen_h : 2;
  }
  if ($('fichaje-cierre-max')) {
    $('fichaje-cierre-max').value = (cfg.cierre_max_h != null) ? cfg.cierre_max_h : 12;
  }

  // Guardar
  const guardar = $('btn-guardar-fichaje');
  if (guardar) {
    guardar.onclick = async () => {
      guardar.disabled = true;
      try {
        // Limpiar tramos vacíos
        for (const d of DIAS) {
          if (cfg.horarios && cfg.horarios[d]) {
            cfg.horarios[d] = cfg.horarios[d].filter((t) => t.desde && t.hasta);
            if (cfg.horarios[d].length === 0) delete cfg.horarios[d];
          }
        }
        // Margen y avisos, normalizados a segundos
        const mar = parseInt(($('fichaje-margen') || {}).value, 10);
        cfg.margen_seg = (mar >= 0 && mar <= 120) ? mar * 60 : 300;
        cfg.recordar_entrada_seg = aSeg(($('fichaje-av-ent') || {}).value,
                                        ($('fichaje-av-ent-u') || {}).value);
        cfg.recordar_salida_seg  = aSeg(($('fichaje-av-sal') || {}).value,
                                        ($('fichaje-av-sal-u') || {}).value);
        delete cfg.recordar_h;   // migrado al nuevo campo en segundos

        // Cierre automático. Al encenderlo se avisa de lo que implica: en la
        // siguiente pasada del cron se cierra TODO lo que lleve abierto, y a
        // cada trabajador afectado le llega un aviso.
        const quiereCierre = !!($('fichaje-cierre-auto') || {}).checked;
        if (quiereCierre && cfg.cierre_auto_activo !== true) {
          const ok = await confirmar(
            'Se cerrarán las jornadas que ya estén abiertas, incluidas las de días '
            + 'pasados, y cada persona afectada recibirá un aviso. Si hay jornadas '
            + 'viejas sin cerrar, revísalas antes en el registro. ¿Activar igualmente?',
            { textoOk: 'Activar', textoNo: 'Ahora no' });
          if (!ok) { guardar.disabled = false; return; }
        }
        cfg.cierre_auto_activo = quiereCierre;

        const cMar = parseInt(($('fichaje-cierre-margen') || {}).value, 10);
        cfg.cierre_margen_h = (cMar >= 0 && cMar <= 24) ? cMar : 2;
        const cMax = parseInt(($('fichaje-cierre-max') || {}).value, 10);
        cfg.cierre_max_h = (cMax >= 1 && cMax <= 24) ? cMax : 12;

        await guardarHorarioFichaje(cfg);
        toast('Ajustes de fichaje guardados');
      } catch (err) { toast(err.message); }
      finally { guardar.disabled = false; }
    };
  }
}

function nota(txt) {
  const d = document.createElement('div');
  d.className = 'empty-note'; d.textContent = txt;
  return d;
}
