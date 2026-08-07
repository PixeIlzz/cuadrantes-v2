// Interfaz del fichaje. Empleado: botón central + hoy. Gestor: equipo + detalle.
import { toast } from './toast.js';
import { confirmar } from './confirmar.js';
import { ctx } from '../auth.js';
import {
  fichar, misFichajesHoy, miEstado, fichajesHoyEquipo, fichajesDe,
  horarioNegocio, guardarHorarioFichaje, corregirFichaje, borrarFichaje,
} from '../data/fichaje.js';
import { listarEquipo } from '../data/equipo.js';
import { etiquetaSemana, lunesDe, sumarDias, isoDe } from '../data/semanas.js';

const $ = (id) => document.getElementById(id);
const DIAS = ['lun','mar','mie','jue','vie','sab','dom'];
const DIAS_LARGO = { lun:'Lunes',mar:'Martes',mie:'Miércoles',jue:'Jueves',vie:'Viernes',sab:'Sábado',dom:'Domingo' };

let relojTimer = null;

/* Hora legible desde un timestamp */
function hora(iso) {
  return new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit',
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
function totalTrabajado(fichajes) {
  let mins = 0, entrada = null;
  for (const f of fichajes) {
    if (f.tipo === 'entrada') entrada = new Date(f.momento);
    else if (f.tipo === 'salida' && entrada) {
      mins += Math.round((new Date(f.momento) - entrada) / 60000);
      entrada = null;
    }
  }
  // Si sigue dentro, cuenta hasta ahora
  if (entrada) mins += Math.round((Date.now() - entrada) / 60000);
  const h = Math.floor(mins / 60), m = mins % 60;
  return h + 'h ' + String(m).padStart(2, '0') + 'm';
}

// ==========================================================
//  GESTOR
// ==========================================================
let equipoCache = [];

export async function abrirFichajeGestor() {
  const cont = $('fichaje-gestor');
  if (!cont) return;
  cont.innerHTML = '<span class="empty-note">Cargando…</span>';
  try {
    equipoCache = await listarEquipo();
    await pintarEquipoHoy(cont);
  } catch (err) {
    cont.innerHTML = '<span class="empty-note">' + err.message + '</span>';
  }
}

async function pintarEquipoHoy(cont) {
  const porWorker = await fichajesHoyEquipo();
  cont.innerHTML = '';

  const h = document.createElement('h2');
  h.className = 'fich-h2';
  h.textContent = 'Hoy · ' + new Date().toLocaleDateString('es-ES',
    { weekday: 'long', day: 'numeric', month: 'long' });
  cont.appendChild(h);

  const lista = document.createElement('div');
  lista.className = 'fich-equipo';

  for (const w of equipoCache) {
    const fs = porWorker[w.id] || [];
    const dentro = fs.length > 0 && fs[fs.length - 1].tipo === 'entrada';
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'fich-emp' + (dentro ? ' dentro' : '');
    const total = fs.length ? totalTrabajado(fs) : '—';
    const estado = fs.length === 0 ? 'Sin fichar'
      : (dentro ? 'Trabajando desde ' + hora(fs[fs.length - 1].momento) : 'Jornada terminada');
    card.innerHTML = '<div class="fe-nombre"></div>'
      + '<div class="fe-estado">' + estado + '</div>'
      + '<div class="fe-total">' + total + '</div>';
    card.querySelector('.fe-nombre').textContent = w.name;
    card.addEventListener('click', () => abrirDetalleEmpleado(w));
    lista.appendChild(card);
  }
  cont.appendChild(lista);
}

/* Detalle de un empleado con navegación día/semana/mes */
let detWorker = null, detModo = 'semana', detAncla = null;

async function abrirDetalleEmpleado(w) {
  detWorker = w; detModo = 'semana'; detAncla = new Date();
  await pintarDetalle();
}

async function pintarDetalle() {
  const cont = $('fichaje-gestor');
  cont.innerHTML = '<span class="empty-note">Cargando…</span>';

  // Rango según el modo
  let desde, hasta, etiqueta;
  if (detModo === 'dia') {
    desde = hasta = isoDe(detAncla);
    etiqueta = detAncla.toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'long' });
  } else if (detModo === 'semana') {
    const lun = lunesDe(detAncla);
    desde = lun; hasta = sumarDias(lun, 6);
    etiqueta = etiquetaSemana(lun);
  } else { // mes
    const y = detAncla.getFullYear(), m = detAncla.getMonth();
    desde = isoDe(new Date(y, m, 1));
    hasta = isoDe(new Date(y, m + 1, 0));
    etiqueta = detAncla.toLocaleDateString('es-ES', { month:'long', year:'numeric' });
  }

  let fs;
  try { fs = await fichajesDe(detWorker.id, desde, hasta); }
  catch (err) { cont.innerHTML = '<span class="empty-note">' + err.message + '</span>'; return; }

  cont.innerHTML = '';

  // Cabecera con volver
  const cab = document.createElement('div');
  cab.className = 'fich-det-cab';
  const volver = document.createElement('button');
  volver.type = 'button'; volver.className = 'btn small'; volver.textContent = '← Volver';
  volver.addEventListener('click', () => abrirFichajeGestor());
  cab.appendChild(volver);
  const nom = document.createElement('h2');
  nom.className = 'fich-det-nombre'; nom.textContent = detWorker.name;
  cab.appendChild(nom);
  cont.appendChild(cab);

  // Selector de modo
  const modos = document.createElement('div');
  modos.className = 'fich-modos';
  for (const [id, lbl] of [['dia','Día'],['semana','Semana'],['mes','Mes']]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fich-modo' + (detModo === id ? ' activo' : '');
    b.textContent = lbl;
    b.addEventListener('click', () => { detModo = id; detAncla = new Date(detAncla); pintarDetalle(); });
    modos.appendChild(b);
  }
  cont.appendChild(modos);

  // Navegación anterior/siguiente
  const nav = document.createElement('div');
  nav.className = 'fich-nav';
  const prev = document.createElement('button'); prev.type='button'; prev.className='btn small'; prev.textContent='‹';
  const et = document.createElement('span'); et.className='fich-nav-et'; et.textContent = etiqueta;
  const next = document.createElement('button'); next.type='button'; next.className='btn small'; next.textContent='›';
  prev.addEventListener('click', () => { moverAncla(-1); });
  next.addEventListener('click', () => { moverAncla(1); });
  nav.append(prev, et, next);
  cont.appendChild(nav);

  // Agrupar por día
  const porDia = {};
  for (const f of fs) {
    const dia = new Date(f.momento).toLocaleDateString('es-CA', { timeZone:'Atlantic/Canary' });
    (porDia[dia] ||= []).push(f);
  }

  if (Object.keys(porDia).length === 0) {
    cont.appendChild(nota('No hay fichajes en este periodo.'));
    return;
  }

  let totalPeriodo = 0;
  const cfg = horarioNegocio();
  for (const dia of Object.keys(porDia).sort()) {
    const bloque = document.createElement('div');
    bloque.className = 'fich-dia';
    const fecha = new Date(dia + 'T12:00:00');
    const claveDia = DIAS[(fecha.getDay() + 6) % 7];
    const th = document.createElement('div');
    th.className = 'fich-dia-tit';
    th.textContent = fecha.toLocaleDateString('es-ES', { weekday:'long', day:'numeric', month:'short' });
    bloque.appendChild(th);

    for (const f of porDia[dia]) {
      const retraso = calcularRetraso(f, claveDia, cfg);
      const fila = document.createElement('div');
      fila.className = 'fich-fila ' + f.tipo + (f.estimado ? ' estimado' : '');
      fila.innerHTML = '<span class="ff-tipo">' + (f.tipo==='entrada'?'▶ Entrada':'⏹ Salida') + '</span>'
        + '<span class="ff-hora">' + hora(f.momento)
        + (f.estimado ? ' <em>(estimado)</em>' : '')
        + (f.origen==='gestor' ? ' <em class="ff-corr">(corregido)</em>' : '') + '</span>'
        + (retraso ? '<span class="ff-retraso">' + retraso + '</span>' : '');
      bloque.appendChild(fila);
    }
    const t = totalTrabajado(porDia[dia]);
    totalPeriodo += totalMin(porDia[dia]);
    const tt = document.createElement('div');
    tt.className = 'fich-dia-total';
    tt.innerHTML = 'Total del día: <b>' + t + '</b>';
    bloque.appendChild(tt);
    cont.appendChild(bloque);
  }

  const resumen = document.createElement('div');
  resumen.className = 'fich-resumen';
  resumen.innerHTML = 'Total del periodo: <b>' + minAHoras(totalPeriodo) + '</b>';
  cont.appendChild(resumen);
}

function moverAncla(dir) {
  const d = new Date(detAncla);
  if (detModo === 'dia') d.setDate(d.getDate() + dir);
  else if (detModo === 'semana') d.setDate(d.getDate() + dir * 7);
  else d.setMonth(d.getMonth() + dir);
  detAncla = d;
  pintarDetalle();
}

/* Retraso: si la entrada es más tarde que el inicio previsto de ese día */
function calcularRetraso(f, claveDia, cfg) {
  if (f.tipo !== 'entrada') return null;
  const tramos = (cfg.horarios && cfg.horarios[claveDia]) || [];
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
  if (diff > 5) return '+' + diff + ' min tarde';   // más de 5 min de margen
  return null;
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

// ==========================================================
//  AJUSTES: horario previsto por día
// ==========================================================
export function pintarAjustesFichaje() {
  const cont = $('fichaje-horarios');
  if (!cont) return;
  const cfg = horarioNegocio();
  cont.innerHTML = '';

  for (const d of DIAS) {
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
        await guardarHorarioFichaje(cfg);
        toast('Horario de fichaje guardado');
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
