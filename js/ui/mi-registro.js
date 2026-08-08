// Vista "Mi registro" del empleado: sus fichajes por día / semana / mes / año.
// Reutiliza el mismo estilo visual que "mis turnos". v1
import { ctx } from '../auth.js';
import { fichajesDe, horarioNegocio } from '../data/fichaje.js';
import { isoDe, lunesDe, sumarDias, etiquetaSemana } from '../data/semanas.js';

const $ = (id) => document.getElementById(id);
const DIAS = ['lun', 'mar', 'mie', 'jue', 'vie', 'sab', 'dom'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const ETI = { dia: 'Día', semana: 'Semana', mes: 'Mes', anio: 'Año' };

let modo = 'semana';
let ancla = new Date();

export async function abrirMiRegistro() {
  const cont = $('emp-fichaje');
  if (!cont) return;

  cont.innerHTML = '';
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

  await pintarLista();
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
