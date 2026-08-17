// Árbol del registro de fichajes: Año → Meses → Semanas → Días.
// Todo son desplegables. En el gestor cada nivel lleva botones PDF/CSV.
// Lo usan la vista del gestor y la del empleado (esta sin botones). v1
import { ctx } from '../auth.js';
import { fichajesPorJornada, diaDe, datosLegales, horarioNegocio, turnoPrevisto } from '../data/fichaje.js';
import { toast } from './toast.js';

const MESES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

/* ================= utilidades de tiempo ================= */
function hora(iso) {
  return new Date(iso).toLocaleTimeString('es-ES',
    { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Atlantic/Canary' });
}
function segDe(fichajes) {
  let s = 0, e = null;
  for (const f of fichajes) {
    if (f.tipo === 'entrada') e = new Date(f.momento);
    else if (f.tipo === 'salida' && e) { s += Math.round((new Date(f.momento) - e) / 1000); e = null; }
  }
  if (e) s += Math.round((Date.now() - e) / 1000);
  return s;
}
function hms(seg) {
  const t = Math.max(0, Math.floor(seg));
  const p = (n) => String(n).padStart(2, '0');
  return p(Math.floor(t / 3600)) + ':' + p(Math.floor((t % 3600) / 60)) + ':' + p(t % 60);
}
function hhmmAMin(hhmm) {
  if (!hhmm) return null;
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}
function minutosDelDia(iso) {
  const t = new Date(iso).toLocaleTimeString('es-ES',
    { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Atlantic/Canary' });
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}
/* Minutos previstos de una lista de tramos */
function minDeTramos(tramos) {
  let t = 0;
  for (const x of (tramos || [])) {
    const a = hhmmAMin(x.desde), b = hhmmAMin(x.hasta);
    // Un tramo que cruza medianoche (20:00-01:00) cuenta hasta el día siguiente
    if (a != null && b != null) t += (b > a) ? (b - a) : (b + 1440 - a);
  }
  return t;
}
/* Minutos de retraso de la primera entrada del día (0 si es puntual) */
function minRetraso(items, tramos, margenMin) {
  const ent = items.find((f) => f.tipo === 'entrada');
  if (!ent || !(tramos || []).length) return 0;
  const minFich = minutosDelDia(ent.momento);
  let mejor = null;
  for (const t of tramos) {
    const ini = hhmmAMin(t.desde);
    if (ini == null) continue;
    if (minFich >= ini - 30 && minFich <= ini + 240) {
      if (mejor === null || Math.abs(minFich - ini) < Math.abs(minFich - mejor)) mejor = ini;
    }
  }
  if (mejor === null) return 0;
  const diff = minFich - mejor;
  return diff > margenMin ? diff : 0;
}
/* Texto compacto del saldo: +1h 20m / −45m */
function fmtSaldo(seg) {
  const abs = Math.abs(Math.round(seg));
  const h = Math.floor(abs / 3600), m = Math.round((abs % 3600) / 60);
  const txt = h > 0 ? (h + 'h ' + String(m).padStart(2, '0') + 'm') : (m + 'm');
  return (seg >= 0 ? '+' : '\u2212') + txt;
}
function fmtRetraso(min) {
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 ? (h + 'h ' + String(m).padStart(2, '0') + 'm') : (m + ' min');
}

function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
/* Nombre para la documentación legal: el completo si lo hay, si no el del cuadrante */
function nombreLegal(worker) {
  return (worker && (worker.full_name || worker.name)) || '';
}
/* Marca de un fichaje para la columna de observaciones */
function marcaDe(f) {
  if (f.estimado) return 'Estimado';
  if (f.origen === 'gestor') return 'Corregido';
  if (f.origen === 'kiosco') return 'Kiosco';
  if (f.origen === 'auto') return 'Automático';
  return '';
}
/* Lunes de la semana a la que pertenece una fecha ISO */
function lunesIso(iso) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
function fmtDia(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-ES',
    { weekday: 'long', day: 'numeric', month: 'short' });
}
function fmtCorto(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-ES',
    { day: '2-digit', month: '2-digit' });
}

/* ================= construir el árbol ================= */
/* Devuelve: [{ anio, seg, meses:[{ mes, seg, semanas:[{ lunes, seg, dias:[{iso, seg, items}] }] }] }] */
function construirArbol(fichajes, previstos, margenMin) {
  const porDia = {};
  for (const f of fichajes) (porDia[f.dia || diaDe(f.momento)] ||= []).push(f);

  const anios = new Map();
  for (const iso of Object.keys(porDia).sort()) {
    const items = porDia[iso];
    const seg = segDe(items);
    const tramos = previstos[iso] || [];
    const est = minDeTramos(tramos) * 60;          // previsto en segundos
    const ret = minRetraso(items, tramos, margenMin);
    const anio = iso.slice(0, 4);
    const mes = iso.slice(0, 7);
    const lun = lunesIso(iso);

    if (!anios.has(anio)) anios.set(anio, { anio, seg: 0, est: 0, ret: 0, retDias: 0, meses: new Map() });
    const A = anios.get(anio);
    A.seg += seg; A.est += est; A.ret += ret; if (ret) A.retDias += 1;

    if (!A.meses.has(mes)) A.meses.set(mes, { mes, seg: 0, est: 0, ret: 0, retDias: 0, semanas: new Map() });
    const M = A.meses.get(mes);
    M.seg += seg; M.est += est; M.ret += ret; if (ret) M.retDias += 1;

    if (!M.semanas.has(lun)) M.semanas.set(lun, { lunes: lun, seg: 0, est: 0, ret: 0, retDias: 0, dias: [] });
    const S = M.semanas.get(lun);
    S.seg += seg; S.est += est; S.ret += ret; if (ret) S.retDias += 1;
    S.dias.push({ iso, seg, est, ret, items });
  }

  return [...anios.values()].sort((a, b) => b.anio.localeCompare(a.anio)).map((A) => ({
    ...A,
    meses: [...A.meses.values()].sort((a, b) => b.mes.localeCompare(a.mes)).map((M) => ({
      ...M,
      semanas: [...M.semanas.values()].sort((a, b) => b.lunes.localeCompare(a.lunes)),
    })),
  }));
}

/* Todos los fichajes contenidos en un nodo (para exportar) */
function fichajesDeNodo(nodo, tipo) {
  if (tipo === 'dia') return nodo.items;
  if (tipo === 'semana') return nodo.dias.flatMap((d) => d.items);
  if (tipo === 'mes') return nodo.semanas.flatMap((s) => s.dias.flatMap((d) => d.items));
  return nodo.meses.flatMap((m) => m.semanas.flatMap((s) => s.dias.flatMap((d) => d.items)));
}

/* ================= exportar ================= */
/* Hoja de estilo del documento imprimible.
   Paleta heredada de la app (tinta #182135, acento #2456c8), pero sobria:
   poca mancha de tinta y todo legible aunque se imprima en blanco y negro. */
const CSS_PDF = `
@page{size:A4;margin:15mm 14mm}
*{box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,Helvetica,sans-serif;
     color:#182135;font-size:11px;line-height:1.45;margin:0;padding:0;
     -webkit-print-color-adjust:exact;print-color-adjust:exact}
.cab{border-bottom:2.5px solid #2456c8;padding-bottom:9px;margin-bottom:14px;
     display:flex;align-items:flex-end;justify-content:space-between;gap:12px}
.cab h1{font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.09em;margin:0}
.cab .sub{font-size:10px;color:#5a6478;margin-top:2px}
.cab .marca{font-size:10px;color:#5a6478;text-align:right;white-space:nowrap}
.ident{width:100%;border-collapse:collapse;margin-bottom:12px;table-layout:fixed}
.ident td{vertical-align:top;padding:0;width:50%}
.ident td:first-child{padding-right:10px}
.bloque{border:1px solid #dde2ea;border-radius:6px;padding:8px 10px;height:100%}
.bloque h2{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#5a6478;
           margin:0 0 5px;padding-bottom:4px;border-bottom:1px solid #dde2ea;font-weight:700}
.campo{display:flex;gap:6px;margin-bottom:2px}
.campo .et{color:#5a6478;flex:0 0 78px}
.campo .va{font-weight:600}
.periodo{background:#f2f4f7;border-radius:6px;padding:7px 10px;margin-bottom:12px;font-size:11px}
.periodo .et{color:#5a6478;text-transform:uppercase;font-size:9px;letter-spacing:.08em}
.periodo .va{font-weight:700;margin-left:6px}
table.reg{width:100%;border-collapse:collapse}
table.reg th{background:#182135;color:#fff;font-size:9px;text-transform:uppercase;
             letter-spacing:.06em;padding:6px 8px;text-align:left;font-weight:700}
table.reg td{padding:5px 8px;border-bottom:1px solid #e6eaf1;vertical-align:top}
table.reg .fecha{border-right:1px solid #dde2ea;white-space:nowrap;width:24%}
table.reg .fecha .dow{color:#5a6478;font-size:9px;text-transform:capitalize;display:block}
table.reg .fecha .num{font-weight:700}
table.reg .hora{font-variant-numeric:tabular-nums;white-space:nowrap;width:16%}
table.reg .obs{color:#5a6478;font-size:9px;width:20%}
table.reg .ev{width:18%}
table.reg .ev b{font-weight:600}
table.reg tr.dia-tot td{background:#f7f9fc;font-weight:700;border-bottom:1px solid #dde2ea}
table.reg tbody.dia{page-break-inside:avoid}
table.reg tr.total td{background:#182135;color:#fff;font-weight:700;font-size:12px;
                      padding:8px;border:none}
.firmas{margin-top:26px;width:100%;border-collapse:collapse;page-break-inside:avoid}
.firmas td{width:50%;padding-top:34px;font-size:10px;color:#5a6478;vertical-align:bottom}
.firmas td span{display:block;border-top:1px solid #182135;padding-top:4px;margin-right:20px}
.pie{margin-top:18px;padding-top:8px;border-top:1px solid #dde2ea;
     font-size:9px;color:#5a6478;display:flex;justify-content:space-between;gap:10px}
`;

function campo(etiqueta, valor) {
  return '<div class="campo"><span class="et">' + esc(etiqueta) + '</span>'
    + '<span class="va">' + esc(valor || '—') + '</span></div>';
}

function exportarPDF(worker, titulo, fichajes) {
  const leg = datosLegales();
  const porDia = {};
  for (const f of fichajes) (porDia[f.dia || diaDe(f.momento)] ||= []).push(f);

  let cuerpo = '', total = 0;
  for (const iso of Object.keys(porDia).sort()) {
    const items = porDia[iso];
    const d = new Date(iso + 'T12:00:00');
    const dow = d.toLocaleDateString('es-ES', { weekday: 'long' });
    const num = d.toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });

    // Un <tbody> por día: la fecha ocupa todas sus filas y el día no se parte entre páginas
    let filas = '';
    items.forEach((f, i) => {
      const fechaCel = i === 0
        ? '<td class="fecha" rowspan="' + (items.length + 1) + '">'
          + '<span class="dow">' + esc(dow) + '</span>'
          + '<span class="num">' + esc(num) + '</span></td>'
        : '';
      filas += '<tr>' + fechaCel
        + '<td class="ev"><b>' + (f.tipo === 'entrada' ? 'Entrada' : 'Salida') + '</b></td>'
        + '<td class="hora">' + hora(f.momento) + '</td>'
        + '<td class="obs">' + esc(marcaDe(f)) + '</td></tr>';
    });
    const s = segDe(items); total += s;
    filas += '<tr class="dia-tot"><td class="ev">Total del día</td>'
      + '<td class="hora">' + hms(s) + '</td><td class="obs"></td></tr>';
    cuerpo += '<tbody class="dia">' + filas + '</tbody>';
  }

  const win = window.open('', '_blank');
  if (!win) { toast('Permite las ventanas emergentes para exportar'); return; }
  const generado = new Date().toLocaleString('es-ES', { timeZone: 'Atlantic/Canary' });

  win.document.write(
    '<!doctype html><html lang="es"><head><meta charset="utf-8">'
    + '<title>Registro de jornada · ' + esc(nombreLegal(worker)) + '</title>'
    + '<style>' + CSS_PDF + '</style></head><body>'

    + '<div class="cab"><div>'
    + '<h1>Registro de jornada laboral</h1>'
    + '<div class="sub">Artículo 34.9 del Estatuto de los Trabajadores</div>'
    + '</div><div class="marca">StaffPoint</div></div>'

    + '<table class="ident"><tr>'
    + '<td><div class="bloque"><h2>Empresa</h2>'
    + campo('Razón social', leg.razon_social || ctx.business.name)
    + campo('CIF', leg.cif)
    + '</div></td>'
    + '<td><div class="bloque"><h2>Trabajador</h2>'
    + campo('Nombre', nombreLegal(worker))
    + campo('NIF', worker.nif)
    + campo('Nº S.S.', worker.nss)
    + '</div></td>'
    + '</tr></table>'

    + '<div class="periodo"><span class="et">Periodo</span>'
    + '<span class="va">' + esc(titulo) + '</span></div>'

    + '<table class="reg"><thead><tr>'
    + '<th>Fecha</th><th>Evento</th><th>Hora</th><th>Observaciones</th>'
    + '</tr></thead>' + cuerpo
    + '<tbody><tr class="total"><td colspan="2">TOTAL DEL PERIODO</td>'
    + '<td colspan="2">' + hms(total) + '</td></tr></tbody></table>'

    + '<table class="firmas"><tr>'
    + '<td><span>Firma de la empresa</span></td>'
    + '<td><span>Firma del trabajador</span></td>'
    + '</tr></table>'

    + '<div class="pie"><span>Generado el ' + esc(generado) + '</span>'
    + '<span>Conservación obligatoria: 4 años</span></div>'

    + '</body></html>');
  win.document.close();
  win.focus();
  setTimeout(() => { try { win.print(); } catch (_) {} }, 300);
}

function exportarCSV(worker, titulo, fichajes) {
  const leg = datosLegales();
  const sep = ';';
  const L = [];
  L.push(['Razón social', leg.razon_social || ctx.business.name || ''].join(sep));
  L.push(['CIF', leg.cif || ''].join(sep));
  L.push(['Trabajador', nombreLegal(worker)].join(sep));
  L.push(['NIF', worker.nif || ''].join(sep));
  L.push(['Nº Seguridad Social', worker.nss || ''].join(sep));
  L.push(['Periodo', titulo].join(sep));
  L.push('');
  L.push(['Fecha', 'Evento', 'Hora', 'Origen'].join(sep));

  const porDia = {};
  for (const f of fichajes) (porDia[f.dia || diaDe(f.momento)] ||= []).push(f);
  let total = 0;
  for (const iso of Object.keys(porDia).sort()) {
    for (const f of porDia[iso]) {
      L.push([iso, f.tipo, hora(f.momento), f.origen || ''].join(sep));
    }
    const s = segDe(porDia[iso]); total += s;
    L.push(['', 'Total del día', hms(s), ''].join(sep));
  }
  L.push('');
  L.push(['', 'TOTAL PERIODO', hms(total), ''].join(sep));

  const blob = new Blob(['\ufeff' + L.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'registro_' + nombreLegal(worker).replace(/\s+/g, '_') + '_'
    + titulo.replace(/[^\w]+/g, '_') + '.csv';
  a.click();
  URL.revokeObjectURL(url);
}

/* ================= pintar el árbol ================= */
/* opciones: { worker, exportar:boolean, onCorregir:(dia, items)=>void }
   onCorregir solo lo pasa la vista del empleado: añade el botón de corrección
   en el nivel de día. En año, mes y semana no tiene sentido corregir nada. */
export async function pintarArbolRegistro(cont, workerId, opciones = {}) {
  const { worker = null, exportar = false, onCorregir = null } = opciones;
  cont.innerHTML = '<span class="empty-note">Cargando registro…</span>';

  let fich = [];
  try {
    // Rango amplio: desde 2 años atrás hasta hoy
    const hoy = new Date();
    const desde = (hoy.getFullYear() - 2) + '-01-01';
    const hasta = hoy.toISOString().slice(0, 10);
    fich = await fichajesPorJornada(workerId, desde, hasta);
  } catch (e) {
    cont.innerHTML = '<span class="empty-note">' + (e.message || 'No se pudo cargar') + '</span>';
    return;
  }

  // Turno previsto de cada día con fichajes (para saldo y retrasos)
  const dias = [...new Set(fich.map((f) => f.dia || diaDe(f.momento)))];
  const previstos = {};
  await Promise.all(dias.map(async (d) => {
    try { previstos[d] = await turnoPrevisto(workerId, d); }
    catch (_) { previstos[d] = []; }
  }));
  const margenMin = Math.round((Number(horarioNegocio().margen_seg) || 300) / 60);

  const arbol = construirArbol(fich, previstos, margenMin);
  cont.innerHTML = '';
  if (arbol.length === 0) {
    cont.innerHTML = '<div class="panel"><span class="empty-note">'
      + 'Todavía no hay fichajes registrados.</span></div>';
    return;
  }

  for (const A of arbol) {
    cont.appendChild(nodoAnio(A, worker, exportar, onCorregir));
  }
}

function botonesExport(worker, titulo, fichajes) {
  const acc = document.createElement('span');
  acc.className = 'arb-acc';
  const pdf = document.createElement('button');
  pdf.type = 'button'; pdf.className = 'arb-btn'; pdf.textContent = 'PDF';
  pdf.title = 'Exportar ' + titulo + ' en PDF';
  pdf.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    exportarPDF(worker, titulo, fichajes);
  });
  const csv = document.createElement('button');
  csv.type = 'button'; csv.className = 'arb-btn'; csv.textContent = 'CSV';
  csv.title = 'Exportar ' + titulo + ' en CSV';
  csv.addEventListener('click', (e) => {
    e.preventDefault(); e.stopPropagation();
    exportarCSV(worker, titulo, fichajes);
  });
  acc.append(pdf, csv);
  return acc;
}

function cabecera(nivel, titulo, nodo, sub, worker, exportar, fichajes) {
  const sum = document.createElement('summary');
  sum.className = 'arb-sum arb-' + nivel;

  const tit = document.createElement('span');
  tit.className = 'arb-tit';
  tit.textContent = titulo;

  const datos = document.createElement('span');
  datos.className = 'arb-datos';
  let html = '<b>' + hms(nodo.seg) + '</b>';
  // Saldo frente a lo previsto (solo si hay horario que comparar)
  if (nodo.est > 0) {
    const saldo = nodo.seg - nodo.est;
    const cls = saldo >= 0 ? 'ok' : 'bad';
    html += '<span class="arb-saldo ' + cls + '">' + fmtSaldo(saldo) + '</span>';
  }
  // Retraso acumulado
  if (nodo.ret > 0) {
    html += '<span class="arb-ret">\u23F1 ' + fmtRetraso(nodo.ret)
      + (nodo.retDias > 1 ? ' \u00B7 ' + nodo.retDias + ' d' : '') + '</span>';
  }
  if (sub) html += '<span class="arb-sub">' + sub + '</span>';
  datos.innerHTML = html;

  sum.append(tit, datos);
  if (exportar && worker) sum.appendChild(botonesExport(worker, titulo, fichajes));
  return sum;
}

function nodoAnio(A, worker, exportar, onCorregir) {
  const det = document.createElement('details');
  det.className = 'arb-nodo arb-nivel-anio';
  const nMeses = A.meses.length;
  det.appendChild(cabecera('anio', A.anio, A,
    nMeses + (nMeses === 1 ? ' mes' : ' meses'),
    worker, exportar, fichajesDeNodo(A, 'anio')));

  const body = document.createElement('div');
  body.className = 'arb-body';
  for (const M of A.meses) body.appendChild(nodoMes(M, worker, exportar, onCorregir));
  det.appendChild(body);
  return det;
}

function nodoMes(M, worker, exportar, onCorregir) {
  const det = document.createElement('details');
  det.className = 'arb-nodo arb-nivel-mes';
  const titulo = MESES[Number(M.mes.slice(5, 7)) - 1] + ' ' + M.mes.slice(0, 4);
  const n = M.semanas.length;
  det.appendChild(cabecera('mes', titulo, M,
    n + (n === 1 ? ' semana' : ' semanas'),
    worker, exportar, fichajesDeNodo(M, 'mes')));

  const body = document.createElement('div');
  body.className = 'arb-body';
  for (const S of M.semanas) body.appendChild(nodoSemana(S, worker, exportar, onCorregir));
  det.appendChild(body);
  return det;
}

function nodoSemana(S, worker, exportar, onCorregir) {
  const det = document.createElement('details');
  det.className = 'arb-nodo arb-nivel-semana';
  const dias = [...S.dias].sort((a, b) => a.iso.localeCompare(b.iso));
  const ultimo = dias[dias.length - 1].iso;
  const titulo = 'Semana ' + fmtCorto(S.lunes) + ' – ' + fmtCorto(ultimo);
  det.appendChild(cabecera('semana', titulo, S,
    dias.length + (dias.length === 1 ? ' día' : ' días'),
    worker, exportar, fichajesDeNodo(S, 'semana')));

  const body = document.createElement('div');
  body.className = 'arb-body';
  for (const D of dias) body.appendChild(nodoDia(D, worker, exportar, onCorregir));
  det.appendChild(body);
  return det;
}

function nodoDia(D, worker, exportar, onCorregir) {
  const det = document.createElement('details');
  det.className = 'arb-nodo arb-nivel-dia';
  const entradas = D.items.filter((f) => f.tipo === 'entrada').length;
  det.appendChild(cabecera('dia', fmtDia(D.iso), { ...D, retDias: D.ret ? 1 : 0 },
    entradas + (entradas === 1 ? ' jornada' : ' jornadas'),
    worker, exportar, D.items));

  const body = document.createElement('div');
  body.className = 'arb-body arb-fichajes';
  let primeraEntrada = true;
  for (const f of D.items) {
    const fila = document.createElement('div');
    fila.className = 'arb-fila ' + f.tipo;
    fila.innerHTML =
      '<span class="af-tipo">' + (f.tipo === 'entrada' ? '▶ Entrada' : '⏹ Salida') + '</span>'
      + '<span class="af-hora">' + hora(f.momento) + '</span>'
      + '<span class="af-marca">'
      + (f.estimado ? 'estimado' : (f.origen === 'gestor' ? 'corregido'
        : (f.origen === 'kiosco' ? 'kiosco' : ''))) + '</span>';
    if (f.tipo === 'entrada' && primeraEntrada && D.ret > 0) {
      const t = document.createElement('span');
      t.className = 'af-tarde';
      t.textContent = '+' + D.ret + ' min tarde';
      fila.appendChild(t);
    }
    if (f.tipo === 'entrada') primeraEntrada = false;
    body.appendChild(fila);
  }

  // Solo el empleado, y solo aquí: corregir un día concreto
  if (onCorregir) {
    const acc = document.createElement('div');
    acc.className = 'arb-corregir';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn small';
    b.textContent = '✎ Proponer una corrección';
    b.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      onCorregir(D.iso, D.items);
    });
    acc.appendChild(b);
    body.appendChild(acc);
  }

  det.appendChild(body);
  return det;
}
