// Exportar el cuadrante a imagen PNG y preparar la impresión.
// El PNG se dibuja a mano en un canvas: así el resultado es idéntico en
// cualquier navegador y no depende de librerías externas.
import { toast } from './toast.js';
import { etiquetaSemana, sumarDias } from '../data/semanas.js';

const ALL_ID = 'ALL';

/* Paleta fija del PNG (siempre claro, aunque la app esté en modo oscuro:
   se imprime o se manda por WhatsApp, y el fondo oscuro gasta tinta) */
const C = {
  fondo:   '#ffffff',
  tinta:   '#182135',
  suave:   '#5a6478',
  linea:   '#dde2ea',
  cabDia:  '#182135',
  cabNoche:'#3a4460',
  roles: [
    { txt: '#2456c8', bg: '#e8eefb' },
    { txt: '#c2491d', bg: '#fdece4' },
    { txt: '#1d7a4f', bg: '#e4f5ec' },
  ],
  malo:    '#c62838',
  maloBg:  '#fdeaec',
  bien:    '#1d7a4f',
  nota:    '#fffdf2',
  notaBrd: '#ecd98a',
  vac:     '#12657a',
  vacBg:   '#eaf7fa',
};

/* Reparte un texto en varias líneas que quepan en un ancho dado */
function partir(ctx, texto, ancho) {
  const palabras = String(texto).split(/\s+/);
  const lineas = [];
  let actual = '';
  for (const p of palabras) {
    const prueba = actual ? actual + ' ' + p : p;
    if (ctx.measureText(prueba).width <= ancho) actual = prueba;
    else { if (actual) lineas.push(actual); actual = p; }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

function redondeado(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/* ---------------------------------------------------------------
   Dibuja la semana completa y devuelve el canvas
   datos = { negocio, startDate, DAYS, ROLES, cells, notas, nombre(id), vacDe(id, iso) }
   --------------------------------------------------------------- */
export function dibujarCuadrante(datos, escala = 2) {
  const { negocio, startDate, DAYS, ROLES, cells, notas } = datos;

  const COL = 200, GAP = 10, MARGEN = 28;
  const ALTO_CAB = 96;
  const ALTO_DIA = 40;
  const ALTO_ROL_CAB = 26;
  const ALTO_CHIP = 30;
  const ALTO_NOTA_MIN = 0;

  // Altura necesaria por columna
  const medidas = DAYS.map((d) => {
    const tieneAll = ROLES.some((r) => (cells[d.id + '|' + r.id] || []).includes(ALL_ID));
    let alto = ALTO_DIA;
    if (tieneAll) alto += 120;
    else {
      for (const r of ROLES) {
        const n = (cells[d.id + '|' + r.id] || []).length;
        alto += ALTO_ROL_CAB + Math.max(1, n) * (ALTO_CHIP + 4) + 8;
      }
    }
    return { alto, tieneAll };
  });

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  ctx.font = '600 13px system-ui, sans-serif';

  // Altura de las notas (se calcula con el contexto ya creado)
  const altoNotas = DAYS.map((d) => {
    const t = notas[d.id];
    if (!t) return 0;
    ctx.font = '12px system-ui, sans-serif';
    return 14 + partir(ctx, t, COL - 20).length * 15;
  });

  const altoCuerpo = Math.max(...medidas.map((m, i) => m.alto + altoNotas[i]));
  const ancho = MARGEN * 2 + DAYS.length * COL + (DAYS.length - 1) * GAP;
  const alto = ALTO_CAB + altoCuerpo + MARGEN + 30;

  canvas.width = ancho * escala;
  canvas.height = alto * escala;
  ctx.scale(escala, escala);

  // Fondo
  ctx.fillStyle = C.fondo;
  ctx.fillRect(0, 0, ancho, alto);

  // Cabecera
  ctx.fillStyle = C.tinta;
  ctx.font = '700 22px "Arial Narrow", system-ui, sans-serif';
  ctx.fillText(String(negocio).toUpperCase(), MARGEN, 40);
  ctx.fillStyle = C.suave;
  ctx.font = '600 14px system-ui, sans-serif';
  ctx.fillText(etiquetaSemana(startDate), MARGEN, 62);
  const fin = sumarDias(startDate, 6);
  ctx.font = '12px system-ui, sans-serif';
  ctx.fillText(fechaCorta(startDate) + ' – ' + fechaCorta(fin), MARGEN, 80);

  // Columnas
  let x = MARGEN;
  DAYS.forEach((d, di) => {
    let y = ALTO_CAB;
    const m = medidas[di];

    // Marco de la columna
    ctx.strokeStyle = C.linea;
    ctx.lineWidth = 1;
    redondeado(ctx, x, y, COL, m.alto + altoNotas[di], 8);
    ctx.stroke();

    // Nombre del día
    ctx.save();
    redondeado(ctx, x, y, COL, ALTO_DIA, 8);
    ctx.clip();
    ctx.fillStyle = d.night ? C.cabNoche : C.cabDia;
    ctx.fillRect(x, y, COL, ALTO_DIA);
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 14px "Arial Narrow", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(d.label.toUpperCase(), x + COL / 2, y + 26);
    ctx.textAlign = 'left';
    y += ALTO_DIA;

    if (m.tieneAll) {
      ctx.fillStyle = C.tinta;
      redondeado(ctx, x + 14, y + 30, COL - 28, 44, 8);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.font = '700 16px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('TODOS', x + COL / 2, y + 58);
      ctx.fillStyle = C.suave;
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText('DÍA COMPLETO', x + COL / 2, y + 92);
      ctx.textAlign = 'left';
      y += 120;
    } else {
      ROLES.forEach((r, ri) => {
        const col = C.roles[ri % 3];
        const lista = cells[d.id + '|' + r.id] || [];
        const ok = lista.length >= r.min;

        ctx.fillStyle = col.txt;
        ctx.font = '700 11px system-ui, sans-serif';
        ctx.fillText(r.label.toUpperCase(), x + 12, y + 17);

        // Contador mínimo
        const cnt = lista.length + '/' + r.min;
        ctx.font = '700 10px system-ui, sans-serif';
        const w = ctx.measureText(cnt).width + 12;
        ctx.fillStyle = ok ? '#e4f5ec' : C.maloBg;
        redondeado(ctx, x + COL - 12 - w, y + 6, w, 15, 7);
        ctx.fill();
        ctx.fillStyle = ok ? C.bien : C.malo;
        ctx.textAlign = 'center';
        ctx.fillText(cnt, x + COL - 12 - w / 2, y + 17);
        ctx.textAlign = 'left';
        y += ALTO_ROL_CAB;

        if (lista.length === 0) {
          ctx.fillStyle = col.bg;
          redondeado(ctx, x + 10, y, COL - 20, ALTO_CHIP - 4, 6);
          ctx.fill();
          y += ALTO_CHIP;
        } else {
          for (const id of lista) {
            const nombre = id === ALL_ID ? 'TODOS' : datos.nombre(id);
            const iso = fechaDeDia(startDate, DAYS, d.id);
            const enVac = id !== ALL_ID && iso && datos.vacDe(id, iso);

            ctx.fillStyle = enVac ? C.vacBg : col.bg;
            redondeado(ctx, x + 10, y, COL - 20, ALTO_CHIP - 4, 6);
            ctx.fill();
            ctx.strokeStyle = enVac ? C.vac : col.bg;
            ctx.lineWidth = enVac ? 1.2 : 1;
            ctx.stroke();

            ctx.fillStyle = enVac ? C.vac : C.tinta;
            ctx.font = '600 13px system-ui, sans-serif';
            const txt = (enVac ? '🏖 ' : '') + nombre;
            ctx.fillText(recortar(ctx, txt, COL - 32), x + 18, y + 18);
            y += ALTO_CHIP;
          }
        }
        y += 8;
      });
    }

    // Nota del día
    if (altoNotas[di] > 0) {
      const t = notas[d.id];
      ctx.font = '12px system-ui, sans-serif';
      const lineas = partir(ctx, t, COL - 24);
      ctx.fillStyle = C.nota;
      redondeado(ctx, x + 8, y + 4, COL - 16, altoNotas[di] - 6, 6);
      ctx.fill();
      ctx.strokeStyle = C.notaBrd;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = C.suave;
      lineas.forEach((l, i) => ctx.fillText(l, x + 16, y + 22 + i * 15));
    }

    x += COL + GAP;
  });

  // Pie
  ctx.fillStyle = C.suave;
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillText('Generado con StaffPoint · ' + fechaCorta(hoyIso()), MARGEN, alto - 14);

  return canvas;
}

function recortar(ctx, txt, ancho) {
  if (ctx.measureText(txt).width <= ancho) return txt;
  let t = txt;
  while (t.length > 3 && ctx.measureText(t + '…').width > ancho) t = t.slice(0, -1);
  return t + '…';
}
function hoyIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function fechaCorta(iso) {
  const [a, m, d] = iso.split('-');
  return d + '/' + m + '/' + a;
}
function fechaDeDia(startDate, DAYS, dayId) {
  const base = DAYS.filter((x) => !x.night);
  const i = base.findIndex((b) => b.id === dayId.replace(/N$/, ''));
  return i < 0 ? null : sumarDias(startDate, i);
}

/* ---------------------------------------------------------------
   Acciones
   --------------------------------------------------------------- */
export function descargarPNG(datos) {
  try {
    const canvas = dibujarCuadrante(datos, 2);
    const nombre = 'cuadrante-' + datos.startDate + '.png';
    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = nombre;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Imagen descargada');
    }, 'image/png');
  } catch (err) {
    toast('No se pudo generar la imagen: ' + err.message);
  }
}

/* Compartir por WhatsApp y demás, si el dispositivo lo permite */
export async function compartirPNG(datos) {
  try {
    const canvas = dibujarCuadrante(datos, 2);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
    const archivo = new File([blob], 'cuadrante-' + datos.startDate + '.png',
      { type: 'image/png' });
    if (navigator.canShare && navigator.canShare({ files: [archivo] })) {
      await navigator.share({
        files: [archivo],
        title: 'Cuadrante ' + etiquetaSemana(datos.startDate),
      });
      return true;
    }
    return false;
  } catch (err) {
    if (err && err.name === 'AbortError') return true;   // el usuario canceló
    return false;
  }
}

export function imprimir(datos) {
  const canvas = dibujarCuadrante(datos, 2);
  const url = canvas.toDataURL('image/png');
  const v = window.open('', '_blank');
  if (!v) { toast('El navegador ha bloqueado la ventana de impresión'); return; }
  v.document.write(
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<title>Cuadrante ' + etiquetaSemana(datos.startDate) + '</title>' +
    '<style>@page{size:landscape;margin:8mm}' +
    'body{margin:0;display:flex;align-items:center;justify-content:center}' +
    'img{max-width:100%;height:auto}</style></head><body>' +
    '<img src="' + url + '" onload="window.focus();window.print();"></body></html>');
  v.document.close();
}
