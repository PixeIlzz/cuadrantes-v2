// Consola de plataforma: la pantalla del dueño del servicio.
//
// Es una vista aparte a propósito. Un administrador no gestiona turnos ni
// fichajes: gestiona empresas. Reciclar los paneles del gestor habría
// mezclado dos trabajos que no tienen nada que ver, y además habría dado a
// entender que el admin "está dentro" de un negocio cuando no lo está.
//
// Para entrar en los datos de un cliente hace falta abrir una sesión de
// soporte: caduca sola, queda registrada y se le avisa al gestor.
import {
  listarNegocios, cambiarEstadoNegocio, crearCodigoAlta, listarCodigosAlta,
  detalleNegocio, abrirSoporte, cerrarSoporte, misSesionesSoporte,
  archivarNegocio, eliminarNegocio, exportarNegocio, crearDemo, borrarDemos,
} from '../data/plataforma.js';
import { toast } from './toast.js';
import { confirmar, pedirDatos, pedirTexto } from './confirmar.js';

const $ = (id) => document.getElementById(id);

/* La app normal arranca en el negocio que se deje marcado aquí */
export const CLAVE_ENTRAR = 'staffpoint-entrar-en';

function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function hace(iso) {
  if (!iso) return 'nunca';
  const d = Math.floor((Date.now() - new Date(iso)) / 86400000);
  if (d <= 0) return 'hoy';
  if (d === 1) return 'ayer';
  if (d < 30) return 'hace ' + d + ' días';
  const m = Math.floor(d / 30);
  return 'hace ' + m + (m === 1 ? ' mes' : ' meses');
}
function fecha(iso) {
  return iso ? new Date(iso).toLocaleDateString('es-ES',
    { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}
function hora(iso) {
  return iso ? new Date(iso).toLocaleTimeString('es-ES',
    { hour: '2-digit', minute: '2-digit' }) : '—';
}

/* ============ SESIONES DE SOPORTE ABIERTAS ============ */

async function pintarSoporteVivo() {
  const cont = $('cons-soporte-vivo');
  if (!cont) return;
  const vivas = await misSesionesSoporte();
  cont.innerHTML = '';
  if (!vivas.length) return;

  for (const s of vivas) {
    const av = document.createElement('div');
    av.className = 'cons-aviso';
    av.innerHTML =
      '<div><b>Sesión de soporte abierta en ' + esc(s.negocio) + '</b>'
      + '<div class="plat-meta">' + esc(s.motivo)
      + ' · caduca a las ' + hora(s.expires_at) + '</div></div>';

    const entrar = document.createElement('button');
    entrar.type = 'button'; entrar.className = 'btn small primary';
    entrar.textContent = 'Entrar';
    entrar.addEventListener('click', () => entrarEn(s.business_id));

    const cerrar = document.createElement('button');
    cerrar.type = 'button'; cerrar.className = 'btn small';
    cerrar.textContent = 'Cerrar sesión de soporte';
    cerrar.addEventListener('click', async () => {
      try {
        await cerrarSoporte(s.business_id);
        toast('Sesión de soporte cerrada');
        pintarSoporteVivo(); pintarNegocios();
      } catch (err) { toast(err.message); }
    });

    const acc = document.createElement('div');
    acc.className = 'cons-aviso-acc';
    acc.append(entrar, cerrar);
    av.appendChild(acc);
    cont.appendChild(av);
  }
}

/* Marca en qué negocio hay que entrar y recarga: el arranque lo lee */
function entrarEn(businessId) {
  try { sessionStorage.setItem(CLAVE_ENTRAR, businessId); } catch (_) {}
  location.reload();
}

/* ============ EMPRESAS ============ */

export async function pintarNegocios() {
  const cont = $('cons-negocios');
  if (!cont) return;
  cont.innerHTML = '<span class="empty-note">Cargando empresas…</span>';

  let lista = [];
  try { lista = await listarNegocios(); }
  catch (err) { cont.innerHTML = '<span class="empty-note">' + esc(err.message) + '</span>'; return; }

  pintarMetricas(lista);

  const resumen = $('cons-resumen');
  if (resumen) {
    const activas = lista.filter((n) => n.activo && !n.archivado).length;
    resumen.textContent = lista.length + ' en total · ' + activas + ' activas';
  }

  if (!lista.length) {
    cont.innerHTML = '<span class="empty-note">Todavía no hay ninguna empresa. Emite un código de alta para el primer cliente.</span>';
    return;
  }

  cont.innerHTML = '';
  for (const n of lista) cont.appendChild(filaNegocio(n));
}

/* Las cifras que quieres ver al abrir la consola, sin entrar en nada.
   Salen de la misma lista, así que no cuestan una consulta más. */
function pintarMetricas(lista) {
  const cont = $('cons-metricas');
  if (!cont) return;

  const vivas = lista.filter((n) => n.activo && !n.archivado);
  const empleados = vivas.reduce((s, n) => s + (n.n_empleados || 0), 0);
  const cuentas = vivas.reduce((s, n) => s + (n.n_cuentas || 0), 0);
  const conFichaje = vivas.filter((n) => n.fichaje_activo).length;
  // "Vivas" de verdad: alguien ha entrado en los últimos 14 días
  const limite = Date.now() - 14 * 86400000;
  const activas = vivas.filter((n) => n.ultimo_acceso && new Date(n.ultimo_acceso) > limite).length;

  const dato = (n, et, aviso) =>
    '<div class="cons-metrica' + (aviso ? ' aviso' : '') + '">'
    + '<b>' + n + '</b><span>' + et + '</span></div>';

  cont.innerHTML =
    dato(vivas.length, 'empresas')
    + dato(activas, 'con uso reciente', activas < vivas.length)
    + dato(conFichaje, 'con fichaje')
    + dato(empleados, 'trabajadores')
    + dato(cuentas, 'cuentas');
}

function filaNegocio(n) {
  const caja = document.createElement('div');
  caja.className = 'cons-negocio' + (n.activo && !n.archivado ? '' : ' suspendida');

  const fila = document.createElement('div');
  fila.className = 'plat-fila';

  const datos = document.createElement('div');
  datos.className = 'plat-datos';
  datos.innerHTML =
    '<div class="plat-nombre">' + esc(n.nombre)
    + (n.demo ? ' <span class="plat-tag">demo</span>' : '')
    + (n.archivado ? ' <span class="plat-tag">archivada</span>'
                   : (n.activo ? '' : ' <span class="plat-tag">suspendida</span>'))
    + (n.fichaje_activo ? ' <span class="plat-tag ok">fichaje</span>' : '')
    + '</div>'
    + '<div class="plat-meta">'
    + (n.n_empleados || 0) + ' empleados · ' + (n.n_cuentas || 0) + ' cuentas'
    + ' · alta ' + fecha(n.alta)
    + ' · acceso ' + esc(hace(n.ultimo_acceso))
    + ' · fichaje ' + esc(hace(n.ultimo_fichaje))
    + '</div>';

  const acc = document.createElement('div');
  acc.className = 'cons-acc';

  const bDet = document.createElement('button');
  bDet.type = 'button'; bDet.className = 'btn small';
  bDet.textContent = 'Ficha';

  const bSop = document.createElement('button');
  bSop.type = 'button'; bSop.className = 'btn small primary';
  bSop.textContent = 'Soporte';
  bSop.addEventListener('click', () => pedirSoporte(n));

  const bEst = document.createElement('button');
  bEst.type = 'button';
  bEst.className = 'btn small' + (n.activo ? ' danger' : ' primary');
  bEst.textContent = n.activo ? 'Suspender' : 'Reactivar';
  bEst.addEventListener('click', async () => {
    if (n.activo) {
      const ok = await confirmar(
        'Se cortará el acceso de ' + n.nombre + '. Los datos NO se borran: al '
        + 'reactivar vuelve todo. ¿Suspender?',
        { textoOk: 'Suspender', textoNo: 'Cancelar', peligro: true });
      if (!ok) return;
    }
    bEst.disabled = true;
    try {
      await cambiarEstadoNegocio(n.id, !n.activo);
      toast(n.activo ? 'Empresa suspendida' : 'Empresa reactivada');
      pintarNegocios();
    } catch (err) { toast(err.message); bEst.disabled = false; }
  });

  const bArch = document.createElement('button');
  bArch.type = 'button'; bArch.className = 'btn small';
  bArch.textContent = n.archivado ? 'Desarchivar' : 'Archivar';
  bArch.addEventListener('click', async () => {
    if (!n.archivado) {
      const ok = await confirmar(
        'Archivar ' + n.nombre + ' es para cuando el cliente se va: los datos se '
        + 'conservan pero la empresa sale de la lista operativa y pierde el acceso. '
        + 'Para un impago temporal usa Suspender. ¿Archivar?',
        { textoOk: 'Archivar', textoNo: 'Cancelar' });
      if (!ok) return;
    }
    bArch.disabled = true;
    try {
      await archivarNegocio(n.id, !n.archivado);
      toast(n.archivado ? 'Empresa desarchivada' : 'Empresa archivada');
      pintarNegocios();
    } catch (err) { toast(err.message); bArch.disabled = false; }
  });

  const bExp = document.createElement('button');
  bExp.type = 'button'; bExp.className = 'btn small';
  bExp.textContent = 'Exportar';
  bExp.title = 'Descargar todos los datos de la empresa';
  bExp.addEventListener('click', async () => {
    bExp.disabled = true;
    try { await descargarExport(n); }
    catch (err) { toast(err.message); }
    finally { bExp.disabled = false; }
  });

  const bDel = document.createElement('button');
  bDel.type = 'button'; bDel.className = 'btn small danger';
  bDel.textContent = 'Eliminar';
  bDel.addEventListener('click', () => pedirEliminar(n));

  acc.append(bDet, bSop, bEst, bArch, bExp, bDel);
  fila.append(datos, acc);
  caja.appendChild(fila);

  const ficha = document.createElement('div');
  ficha.className = 'cons-ficha';
  ficha.hidden = true;
  caja.appendChild(ficha);

  let cargada = false;
  bDet.addEventListener('click', async () => {
    ficha.hidden = !ficha.hidden;
    if (ficha.hidden || cargada) return;
    ficha.innerHTML = '<span class="empty-note">Cargando ficha…</span>';
    try {
      const d = await detalleNegocio(n.id);
      ficha.innerHTML = pintarFicha(d);
      cargada = true;
    } catch (err) { ficha.innerHTML = '<span class="empty-note">' + esc(err.message) + '</span>'; }
  });

  return caja;
}

function pintarFicha(d) {
  if (!d || !d.negocio) return '<span class="empty-note">Sin datos.</span>';
  const n = d.negocio;
  const a = d.actividad || {};

  const bloque = (titulo, cuerpo) =>
    '<div class="cons-bloque"><h3>' + titulo + '</h3>' + cuerpo + '</div>';

  const dato = (et, va) =>
    '<div class="cons-dato"><span>' + et + '</span><b>' + esc(va == null || va === '' ? '—' : va) + '</b></div>';

  const config = bloque('Configuración',
    dato('Zona horaria', n.tz)
    + dato('Razón social', n.razon_social)
    + dato('CIF', n.cif)
    + dato('Puestos', n.puestos)
    + dato('Columnas', n.columnas)
    + dato('Fichaje', n.fichaje_activo ? 'activo' : 'apagado')
    + dato('Cierre automático', n.cierre_auto ? 'activo' : 'apagado')
    + dato('Código de alta', d.codigo_alta ? d.codigo_alta.codigo : 'creada sin código'));

  const actividad = bloque('Actividad',
    dato('Semanas', a.semanas)
    + dato('Fichajes', a.fichajes)
    + dato('Último fichaje', hace(a.ultimo_fichaje))
    + dato('Solicitudes pendientes', a.solicitudes_pendientes));

  const cuentas = bloque('Cuentas',
    (d.cuentas || []).length
      ? (d.cuentas || []).map((c) =>
          '<div class="cons-item">' + esc(c.email)
          + ' <span class="plat-tag">' + esc(c.rol) + '</span>'
          + '<span class="plat-meta"> · ' + esc(hace(c.ultimo_acceso)) + '</span></div>').join('')
      : '<span class="empty-note">Sin cuentas.</span>');

  const equipo = bloque('Equipo (' + (d.equipo || []).length + ')',
    (d.equipo || []).length
      ? (d.equipo || []).map((w) =>
          '<div class="cons-item">' + esc(w.nombre)
          + (w.activo ? '' : ' <span class="plat-tag">baja</span>')
          + (w.tiene_cuenta ? ' <span class="plat-tag ok">cuenta</span>' : '')
          + (w.tiene_pin ? ' <span class="plat-tag ok">PIN</span>' : '')
          + '</div>').join('')
      : '<span class="empty-note">Sin trabajadores.</span>');

  const kioscos = bloque('Kioscos',
    (d.kioscos || []).length
      ? (d.kioscos || []).map((k) =>
          '<div class="cons-item">' + esc(k.nombre)
          + (k.activo ? '' : ' <span class="plat-tag">inactivo</span>')
          + (k.con_ips ? ' <span class="plat-tag">IP restringida</span>' : '')
          + '</div>').join('')
      : '<span class="empty-note">Sin kioscos emparejados.</span>');

  const soporte = bloque('Historial de soporte',
    (d.soporte || []).length
      ? (d.soporte || []).map((s) =>
          '<div class="cons-item">' + fecha(s.inicio) + ' ' + hora(s.inicio)
          + ' — ' + esc(s.motivo)
          + (s.viva ? ' <span class="plat-tag ok">abierta</span>' : '')
          + '</div>').join('')
      : '<span class="empty-note">Nunca se ha entrado en soporte.</span>');

  return '<div class="cons-ficha-grid">'
    + config + actividad + cuentas + equipo + kioscos + soporte + '</div>';
}

/* ============ EXPORTAR ============ */

async function descargarExport(n) {
  const datos = await exportarNegocio(n.id);
  const txt = JSON.stringify(datos, null, 2);
  const blob = new Blob([txt], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'staffpoint_' + (n.nombre || 'empresa').replace(/[^\w]+/g, '_')
    + '_' + new Date().toISOString().slice(0, 10) + '.json';
  a.click();
  URL.revokeObjectURL(url);

  const kb = Math.round(txt.length / 1024);
  const f = (datos && datos.fichajes) ? datos.fichajes.length : 0;
  toast('Exportado · ' + f + ' fichajes · ' + kb + ' KB');
}

/* ============ ELIMINAR ============ */
/* Dos puertas a propósito: escribir el nombre exacto, y si hay fichajes,
   una segunda confirmación. Borrar un registro de jornada no debería poder
   hacerse de un clic distraído. */
async function pedirEliminar(n) {
  const seguir = await confirmar(
    'Eliminar ' + n.nombre + ' borra la empresa y todo lo suyo: equipo, '
    + 'cuadrantes, vacaciones, solicitudes y fichajes. No se puede deshacer. '
    + 'Si el cliente simplemente se ha ido, lo correcto es Archivar.\n\n'
    + 'Se descargará primero una copia completa.',
    { textoOk: 'Continuar', textoNo: 'Cancelar', peligro: true });
  if (!seguir) return;

  // Red de seguridad: nunca se borra sin haber bajado antes la copia
  try {
    await descargarExport(n);
  } catch (err) {
    toast('No se pudo exportar, no se borra nada: ' + err.message);
    return;
  }

  const nombre = await pedirTexto(
    'Escribe el nombre exacto para confirmar: ' + n.nombre,
    '',
    { textoOk: 'Eliminar', placeholder: n.nombre, maxLength: 60 });
  if (nombre === null) return;

  try {
    let r = await eliminarNegocio(n.id, nombre, false);

    if (!r.ok && r.fichajes) {
      const ok = await confirmar(
        'Esa empresa tiene ' + r.fichajes + ' fichajes. Son registro de jornada y '
        + 'la ley obliga a conservarlo cuatro años. Si los borras, desaparecen. '
        + '¿Seguro que quieres destruirlos?',
        { textoOk: 'Sí, borrar todo', textoNo: 'Mejor archivar', peligro: true });
      if (!ok) return;
      r = await eliminarNegocio(n.id, nombre, true);
    }

    if (!r.ok) { toast(r.error || 'No se pudo eliminar.'); return; }
    toast('Empresa eliminada');
    pintarNegocios();
    pintarCodigos();
  } catch (err) { toast(err.message); }
}

/* ============ SOPORTE ============ */

async function pedirSoporte(n) {
  const r = await pedirDatos('Entrar en soporte · ' + n.nombre, [
    { clave: 'motivo', etiqueta: 'Motivo de la intervención', maxLength: 120,
      placeholder: 'Ej.: no le llegan los avisos de fichaje' },
    { clave: 'minutos', etiqueta: 'Duración en minutos (5–240)', valor: '60',
      maxLength: 3, placeholder: '60' },
  ], { textoOk: 'Abrir soporte',
       nota: 'Queda registrado quién entra, cuándo y por qué, y se avisa al gestor de la empresa. La sesión caduca sola.' });
  if (r === null) return;

  const minutos = parseInt(r.minutos, 10) || 60;
  try {
    await abrirSoporte(n.id, (r.motivo || '').trim(), minutos);
    toast('Sesión de soporte abierta');
    await pintarSoporteVivo();
    entrarEn(n.id);
  } catch (err) { toast(err.message); }
}

/* ============ ARRANQUE ============ */

export function initConsola(email, tieneNegocioPropio, businessIdPropio) {
  if ($('cons-email')) $('cons-email').textContent = email || '';

  if ($('cons-salir')) {
    $('cons-salir').addEventListener('click', () => {
      try { sessionStorage.removeItem(CLAVE_ENTRAR); } catch (_) {}
      document.dispatchEvent(new CustomEvent('staffpoint:salir'));
    });
  }

  const panelMio = $('cons-mi-negocio-panel');
  if (panelMio) panelMio.hidden = !tieneNegocioPropio;
  if ($('cons-entrar-mio') && businessIdPropio) {
    $('cons-entrar-mio').addEventListener('click', () => entrarEn(businessIdPropio));
  }

  if ($('cons-nuevo-codigo')) {
    $('cons-nuevo-codigo').addEventListener('click', async () => {
      const btn = $('cons-nuevo-codigo');
      const nota = ($('cons-nota') || {}).value || '';
      btn.disabled = true;
      try {
        const codigo = await crearCodigoAlta(nota.trim());
        if ($('cons-nota')) $('cons-nota').value = '';
        await confirmar('Código de alta: ' + codigo
          + '\n\nDáselo al cliente. Lo necesita para crear su empresa y solo sirve una vez.',
          { textoOk: 'Hecho', textoNo: 'Cerrar' });
        pintarCodigos();
      } catch (err) { toast(err.message); }
      finally { btn.disabled = false; }
    });
  }

  /* Crear una demo borra antes las anteriores: se crea una por cliente al
     que se le enseña la app, y si no se acumulan hasta ensuciar la lista. */
  if ($('cons-crear-demo')) {
    $('cons-crear-demo').addEventListener('click', async () => {
      const btn = $('cons-crear-demo');
      btn.disabled = true;
      try {
        const previas = await borrarDemos();
        const r = await crearDemo(($('cons-demo-nombre') || {}).value || '');
        if ($('cons-demo-nombre')) $('cons-demo-nombre').value = '';

        const nota = previas.borradas
          ? ' Se han borrado ' + previas.borradas
            + (previas.borradas === 1 ? ' demo anterior.' : ' demos anteriores.')
          : '';
        const entrar = await confirmar(
          'Creada «' + (r.nombre || 'la demo') + '» con equipo, cuadrante publicado '
          + 'y fichajes de los últimos días.' + nota + ' ¿Entras a verla?',
          { textoOk: 'Entrar', textoNo: 'Ahora no' });
        pintarNegocios();
        if (entrar && r.id) entrarEn(r.id);
      } catch (err) { toast(err.message); }
      finally { btn.disabled = false; }
    });
  }

  if ($('cons-borrar-demos')) {
    $('cons-borrar-demos').addEventListener('click', async () => {
      const btn = $('cons-borrar-demos');
      const ok = await confirmar(
        'Se borrarán todas las empresas de demostración y sus datos inventados. '
        + 'Las empresas reales no se tocan. ¿Seguir?',
        { textoOk: 'Borrar demos', textoNo: 'Cancelar', peligro: true });
      if (!ok) return;
      btn.disabled = true;
      try {
        const r = await borrarDemos();
        toast(r.borradas
          ? 'Borradas ' + r.borradas + (r.borradas === 1 ? ' demo' : ' demos')
          : 'No había ninguna demo');
        pintarNegocios();
      } catch (err) { toast(err.message); }
      finally { btn.disabled = false; }
    });
  }

  pintarSoporteVivo();
  pintarNegocios();
  pintarCodigos();
}

export async function pintarCodigos() {
  const cont = $('cons-codigos');
  if (!cont) return;
  cont.innerHTML = '<span class="empty-note">Cargando códigos…</span>';

  let lista = [];
  try { lista = await listarCodigosAlta(); }
  catch (err) { cont.innerHTML = '<span class="empty-note">' + esc(err.message) + '</span>'; return; }

  if (!lista.length) {
    cont.innerHTML = '<span class="empty-note">Sin códigos emitidos.</span>';
    return;
  }

  cont.innerHTML = '';
  for (const c of lista) {
    const usado = !!c.used_at;
    const caducado = !usado && new Date(c.expires_at) < new Date();
    const fila = document.createElement('div');
    fila.className = 'plat-fila' + (usado || caducado ? ' suspendida' : '');
    fila.innerHTML =
      '<div class="plat-datos">'
      + '<div class="plat-nombre"><code>' + esc(c.codigo) + '</code>'
      + (usado ? ' <span class="plat-tag">usado</span>' : '')
      + (caducado ? ' <span class="plat-tag">caducado</span>' : '')
      + '</div>'
      + '<div class="plat-meta">' + esc(c.nota || 'sin nota')
      + (usado ? ' · lo usó ' + esc(c.negocio || '—') + ' el ' + fecha(c.used_at)
               : ' · caduca ' + fecha(c.expires_at))
      + '</div></div>';
    cont.appendChild(fila);
  }
}
