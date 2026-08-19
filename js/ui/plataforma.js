// Panel de plataforma: la vista del dueño del servicio, no la de un gestor.
// Solo se pinta si soy_admin() dice que sí; el servidor lo vuelve a
// comprobar en cada RPC, así que ocultar esto es comodidad, no seguridad.
import {
  listarNegocios, cambiarEstadoNegocio, crearCodigoAlta, listarCodigosAlta,
} from '../data/plataforma.js';
import { toast } from './toast.js';
import { confirmar } from './confirmar.js';

const $ = (id) => document.getElementById(id);

function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* "hace 3 días" es más útil de un vistazo que una fecha completa */
function hace(iso) {
  if (!iso) return 'nunca';
  const dias = Math.floor((Date.now() - new Date(iso)) / 86400000);
  if (dias <= 0) return 'hoy';
  if (dias === 1) return 'ayer';
  if (dias < 30) return 'hace ' + dias + ' días';
  const meses = Math.floor(dias / 30);
  return 'hace ' + meses + (meses === 1 ? ' mes' : ' meses');
}
function fecha(iso) {
  return iso ? new Date(iso).toLocaleDateString('es-ES',
    { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
}

/* ===================== EMPRESAS ===================== */

export async function pintarNegocios() {
  const cont = $('plat-negocios');
  if (!cont) return;
  cont.innerHTML = '<span class="empty-note">Cargando empresas…</span>';

  let lista = [];
  try { lista = await listarNegocios(); }
  catch (err) { cont.innerHTML = '<span class="empty-note">' + esc(err.message) + '</span>'; return; }

  if (lista.length === 0) {
    cont.innerHTML = '<span class="empty-note">Todavía no hay ninguna empresa dada de alta.</span>';
    return;
  }

  cont.innerHTML = '';
  for (const n of lista) {
    const fila = document.createElement('div');
    fila.className = 'plat-fila' + (n.activo ? '' : ' suspendida');

    const datos = document.createElement('div');
    datos.className = 'plat-datos';
    datos.innerHTML =
      '<div class="plat-nombre">' + esc(n.nombre)
      + (n.activo ? '' : ' <span class="plat-tag">suspendida</span>')
      + (n.fichaje_activo ? ' <span class="plat-tag ok">fichaje</span>' : '')
      + '</div>'
      + '<div class="plat-meta">'
      + (n.n_empleados || 0) + ' empleados · ' + (n.n_cuentas || 0) + ' cuentas'
      + ' · alta ' + fecha(n.alta)
      + ' · último acceso ' + esc(hace(n.ultimo_acceso))
      + ' · último fichaje ' + esc(hace(n.ultimo_fichaje))
      + '</div>';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn small' + (n.activo ? ' danger' : ' primary');
    btn.textContent = n.activo ? 'Suspender' : 'Reactivar';
    btn.addEventListener('click', async () => {
      if (n.activo) {
        const ok = await confirmar(
          'Se cortará el acceso de ' + n.nombre + ' a la aplicación. Los datos NO '
          + 'se borran: al reactivar vuelve todo. ¿Suspender?',
          { textoOk: 'Suspender', textoNo: 'Cancelar', peligro: true });
        if (!ok) return;
      }
      btn.disabled = true;
      try {
        await cambiarEstadoNegocio(n.id, !n.activo);
        toast(n.activo ? 'Empresa suspendida' : 'Empresa reactivada');
        pintarNegocios();
      } catch (err) { toast(err.message); btn.disabled = false; }
    });

    fila.append(datos, btn);
    cont.appendChild(fila);
  }
}

/* ===================== CÓDIGOS DE ALTA ===================== */

export async function pintarCodigos() {
  const cont = $('plat-codigos');
  if (!cont) return;
  cont.innerHTML = '<span class="empty-note">Cargando códigos…</span>';

  let lista = [];
  try { lista = await listarCodigosAlta(); }
  catch (err) { cont.innerHTML = '<span class="empty-note">' + esc(err.message) + '</span>'; return; }

  if (lista.length === 0) {
    cont.innerHTML = '<span class="empty-note">Sin códigos emitidos. Genera uno por cada cliente al que vendas.</span>';
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

/* ===================== ARRANQUE ===================== */

export function initPlataforma() {
  const btn = $('btn-nuevo-codigo');
  if (btn) {
    btn.addEventListener('click', async () => {
      const nota = ($('plat-nota') || {}).value || '';
      btn.disabled = true;
      try {
        const codigo = await crearCodigoAlta(nota.trim());
        if ($('plat-nota')) $('plat-nota').value = '';
        await confirmar(
          'Código de alta: ' + codigo + '\n\nDáselo al cliente. Lo necesitará para '
          + 'crear su empresa y solo sirve una vez.',
          { textoOk: 'Hecho', textoNo: 'Cerrar' });
        pintarCodigos();
      } catch (err) { toast(err.message); }
      finally { btn.disabled = false; }
    });
  }
  pintarNegocios();
  pintarCodigos();
}
