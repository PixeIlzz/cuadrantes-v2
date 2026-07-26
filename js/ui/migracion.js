// Pantalla de importación y copias de seguridad (Ajustes del gestor).
import { toast } from './toast.js';
import { confirmar } from './confirmar.js';
import { ctx } from '../auth.js';
import { etiquetaSemana } from '../data/semanas.js';
import {
  identificar, analizar, importarV1, exportarTodo, restaurarBackup,
} from '../data/migracion.js';

const $ = (id) => document.getElementById(id);
let planActual = null;
let backupActual = null;

export function initMigracion() {
  $('btn-elegir-v1').addEventListener('click', () => $('file-v1').click());
  $('file-v1').addEventListener('change', leerArchivosV1);
  $('btn-importar-v1').addEventListener('click', ejecutarImportacion);
  $('btn-exportar-v2').addEventListener('click', descargarBackup);
  $('btn-elegir-backup').addEventListener('click', () => $('file-backup').click());
  $('file-backup').addEventListener('change', leerBackup);
  $('btn-restaurar').addEventListener('click', ejecutarRestauracion);
}

/* ---------- Importar de la v1 ---------- */
async function leerArchivosV1(e) {
  const files = [...e.target.files];
  e.target.value = '';
  if (files.length === 0) return;

  const resumen = $('v1-resumen');
  resumen.innerHTML = '<span class="empty-note">Leyendo archivos…</span>';
  $('btn-importar-v1').hidden = true;

  try {
    const archivos = [];
    for (const f of files) {
      const txt = await f.text();
      let json;
      try { json = JSON.parse(txt); }
      catch (_) { throw new Error('«' + f.name + '» no es un archivo JSON válido.'); }
      const tipo = identificar(json);
      if (!tipo) throw new Error('«' + f.name + '» no parece un archivo de la v1 ni una copia de StaffPoint.');
      if (tipo === 'v2') throw new Error('«' + f.name + '» es una copia de StaffPoint. Úsala en «Restaurar copia».');
      archivos.push({ nombre: f.name, json, tipo });
    }

    planActual = analizar(archivos);
    pintarResumen(archivos);
  } catch (err) {
    resumen.innerHTML = '';
    planActual = null;
    toast(err.message);
  }
}

function pintarResumen(archivos) {
  const c = $('v1-resumen');
  c.innerHTML = '';

  const tipos = {
    'v1-backup': 'copia de seguridad (equipo, vacaciones, ajustes y semana en curso)',
    'v1-programadas': 'semanas programadas',
    'v1-publicada': 'semana publicada',
  };
  const lista = document.createElement('div');
  lista.className = 'mig-archivos';
  for (const a of archivos) {
    const el = document.createElement('div');
    el.className = 'mig-archivo';
    el.innerHTML = '<b></b><span></span>';
    el.querySelector('b').textContent = a.nombre;
    el.querySelector('span').textContent = tipos[a.tipo] || a.tipo;
    lista.appendChild(el);
  }
  c.appendChild(lista);

  const caja = document.createElement('div');
  caja.className = 'mig-plan';

  const bloques = [];
  if (planActual.config) {
    bloques.push(['Ajustes', (planActual.config.days || []).length + ' columnas de día · '
      + (planActual.config.roles || []).length + ' puestos']);
  }
  bloques.push(['Equipo', planActual.trabajadores.length
    + (planActual.trabajadores.length === 1 ? ' trabajador' : ' trabajadores')]);
  const totalVacs = planActual.trabajadores.reduce((n, t) => n + t.vacaciones.length, 0);
  bloques.push(['Vacaciones', totalVacs + (totalVacs === 1 ? ' periodo' : ' periodos')]);
  bloques.push(['Semanas', planActual.semanas.length
    + (planActual.semanas.length === 1 ? ' semana' : ' semanas')]);

  for (const [t, v] of bloques) {
    const f = document.createElement('div');
    f.className = 'mig-fila';
    f.innerHTML = '<span class="mig-et"></span><span class="mig-val"></span>';
    f.querySelector('.mig-et').textContent = t;
    f.querySelector('.mig-val').textContent = v;
    caja.appendChild(f);
  }
  c.appendChild(caja);

  if (planActual.trabajadores.length) {
    const n = document.createElement('div');
    n.className = 'mig-detalle';
    n.textContent = 'Equipo: ' + planActual.trabajadores
      .map((t) => t.nombre + ' (' + t.turnos + ')').join(' · ');
    c.appendChild(n);
  }
  if (planActual.semanas.length) {
    const n = document.createElement('div');
    n.className = 'mig-detalle';
    n.innerHTML = 'Semanas:<br>' + planActual.semanas
      .map((s) => '· ' + etiquetaSemana(s.startIso) + ' — ' + s.origen).join('<br>');
    c.appendChild(n);
  }
  for (const av of planActual.avisos) {
    const a = document.createElement('div');
    a.className = 'mig-aviso';
    a.textContent = '⚠ ' + av;
    c.appendChild(a);
  }

  const nota = document.createElement('div');
  nota.className = 'mig-detalle';
  nota.textContent = 'Las semanas se importan ocultas: el equipo no las verá hasta que tú las muestres.';
  c.appendChild(nota);

  $('btn-importar-v1').hidden = false;
}

async function ejecutarImportacion() {
  if (!planActual) return;
  const ok = await confirmar(
    'Se van a añadir ' + planActual.trabajadores.length + ' trabajadores y '
    + planActual.semanas.length + ' semanas a «' + ctx.business.name + '». '
    + 'Lo que ya exista con el mismo nombre o fecha no se duplica. ¿Continuar?',
    { textoOk: 'Importar' });
  if (!ok) return;

  const btn = $('btn-importar-v1');
  btn.disabled = true; btn.textContent = 'Importando…';
  try {
    const log = await importarV1(planActual, {
      aplicarConfig: $('v1-config').checked,
      importarSemanas: $('v1-semanas').checked,
    });
    $('v1-resumen').innerHTML = '<div class="mig-ok">Importación terminada</div>'
      + log.map((l) => '<div class="mig-detalle">' + l + '</div>').join('');
    btn.hidden = true;
    planActual = null;
    toast('Importación completada. Revisa Equipo y Semanas.');
  } catch (err) {
    toast('Se detuvo la importación: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Importar ahora';
  }
}

/* ---------- Copia de seguridad de la v2 ---------- */
async function descargarBackup() {
  const btn = $('btn-exportar-v2');
  btn.disabled = true; btn.textContent = 'Preparando…';
  try {
    const datos = await exportarTodo();
    const blob = new Blob([JSON.stringify(datos, null, 2)], { type: 'application/json' });
    const p = (n) => String(n).padStart(2, '0');
    const d = new Date();
    const nombre = 'staffpoint-' + (ctx.business.name || 'negocio')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      + '-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '.json';
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Copia descargada: ' + nombre);
  } catch (err) {
    toast('No se pudo exportar: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Descargar copia de seguridad';
  }
}

async function leerBackup(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  const c = $('backup-resumen');
  c.innerHTML = '<span class="empty-note">Leyendo…</span>';
  $('btn-restaurar').hidden = true;
  try {
    const json = JSON.parse(await f.text());
    if (identificar(json) !== 'v2') {
      throw new Error('Ese archivo no es una copia de StaffPoint. Si es de la v1, usa el bloque de arriba.');
    }
    backupActual = json;
    const fecha = json.exportado
      ? new Date(json.exportado).toLocaleString('es-ES') : 'fecha desconocida';
    c.innerHTML = '';
    const caja = document.createElement('div');
    caja.className = 'mig-plan';
    const filas = [
      ['Negocio', (json.negocio && json.negocio.name) || '—'],
      ['Exportada', fecha],
      ['Equipo', (json.workers || []).length + ' trabajadores'],
      ['Vacaciones', (json.vacations || []).length + ' periodos'],
      ['Semanas', (json.weeks || []).length],
      ['Turnos colocados', (json.assignments || []).length],
      ['Avisos', (json.announcements || []).length],
      ['Tareas', (json.tasks || []).length],
    ];
    for (const [t, v] of filas) {
      const el = document.createElement('div');
      el.className = 'mig-fila';
      el.innerHTML = '<span class="mig-et"></span><span class="mig-val"></span>';
      el.querySelector('.mig-et').textContent = t;
      el.querySelector('.mig-val').textContent = v;
      caja.appendChild(el);
    }
    c.appendChild(caja);
    if (json.negocio && json.negocio.name !== ctx.business.name) {
      const a = document.createElement('div');
      a.className = 'mig-aviso';
      a.textContent = '⚠ La copia es de «' + json.negocio.name
        + '» y estás en «' + ctx.business.name + '». Se restaurará aquí igualmente.';
      c.appendChild(a);
    }
    $('btn-restaurar').hidden = false;
  } catch (err) {
    c.innerHTML = '';
    backupActual = null;
    toast(err.message);
  }
}

async function ejecutarRestauracion() {
  if (!backupActual) return;
  const ok = await confirmar(
    'Se añadirá el contenido de la copia a «' + ctx.business.name + '». '
    + 'No se borra nada de lo que ya tienes: lo que coincida por nombre o fecha se respeta. ¿Continuar?',
    { textoOk: 'Restaurar' });
  if (!ok) return;

  const btn = $('btn-restaurar');
  btn.disabled = true; btn.textContent = 'Restaurando…';
  try {
    const log = await restaurarBackup(backupActual, {
      restaurarConfig: $('backup-config').checked,
    });
    $('backup-resumen').innerHTML = '<div class="mig-ok">Restauración terminada</div>'
      + log.map((l) => '<div class="mig-detalle">' + l + '</div>').join('');
    btn.hidden = true;
    backupActual = null;
    toast('Restauración completada');
  } catch (err) {
    toast('Se detuvo la restauración: ' + err.message);
  } finally {
    btn.disabled = false; btn.textContent = 'Restaurar esta copia';
  }
}
