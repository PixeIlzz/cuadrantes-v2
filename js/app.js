// Arranque, login y navegación por pestañas. v7
import { ctx, signIn, signUp, signOut, getSession, pedirRecuperacion, cambiarPassword, cambiarEmail, alRecuperarPassword, codigoPendiente, limpiarCodigoPendiente } from './auth.js';
import { sb } from './supabase.js';
import { toast } from './ui/toast.js';
import { initPWA } from './pwa.js';
import { initTema } from './ui/tema.js';
import { confirmar } from './ui/confirmar.js';
import { initEquipo, abrirEquipo } from './ui/equipo.js';
import { initCuadrante, abrirCuadrante } from './ui/cuadrante.js';
import { initProgramadas, abrirProgramadas } from './ui/programadas.js';
import { initAjustes, abrirAjustes } from './ui/ajustes.js';
import { initAvisos, abrirAvisos, pintarTablon } from './ui/avisos.js';
import { initMigracion } from './ui/migracion.js';
import { initPrivacidad } from './ui/privacidad.js';
import { initNotificaciones, refrescarBadge, accionMarcarTodas, accionBorrarTodas, pintarPreferencias } from './ui/notificaciones.js';
import { initPushUI } from './ui/push.js';
import { initHoy, abrirHoy } from './ui/hoy.js';
import { initTareas, abrirTareas, refrescarContadorTareas } from './ui/tareas.js';
import { initEmpleado, abrirEmpCuadrante, abrirMisTurnos, abrirEmpHoy } from './ui/empleado.js';
import { initAjustesEmpleado, abrirAjustesEmpleado } from './ui/ajustes-empleado.js';
import { canjearCodigo, nombreDelCodigo } from './data/invitaciones.js';
import {

  initSolicitudes, abrirSolicitudes, refrescarContador,
  initMisSolicitudes, abrirMisSolicitudes,
} from './ui/solicitudes.js';

let recuperando = false;   // true mientras el usuario cambia su contrasena desde el correo

const $ = (id) => document.getElementById(id);
const errorLogin = $('login-error');

function paso(txt)  { console.log('[paso]', txt); pinta(txt, '#5a6478'); }
function fallo(txt) { console.error('[fallo]', txt); pinta(txt, '#c62838'); }
function pinta(txt, color) {
  if (errorLogin) { errorLogin.style.color = color; errorLogin.textContent = txt; }
}

window.addEventListener('error', (e) => fallo('Error: ' + e.message));
window.addEventListener('unhandledrejection', (e) =>
  fallo('Fallo: ' + (e.reason?.message || e.reason)));

/* ---------- Pestañas ---------- */
const PESTANAS = ['hoy', 'cuadrante', 'programar', 'equipo', 'tareas', 'solicitudes', 'ajustes',
                  'emp-hoy', 'emp-cuadrante', 'emp-turnos', 'emp-solicitudes', 'emp-ajustes'];

function cambiarPestana(nombre) {
  document.querySelectorAll('.tab-btn[data-tab]').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === nombre));
  for (const t of PESTANAS) $('tab-' + t).hidden = (t !== nombre);
  if (nombre === 'hoy') abrirHoy();
  if (nombre === 'tareas') abrirTareas();
  if (nombre === 'emp-hoy') abrirEmpHoy();
  if (nombre === 'equipo') abrirEquipo();
  if (nombre === 'cuadrante') abrirCuadrante();
  if (nombre === 'programar') abrirProgramadas();
  if (nombre === 'ajustes') { abrirAjustes(); abrirAvisos(); }
  if (nombre === 'emp-cuadrante') abrirEmpCuadrante();
  if (nombre === 'emp-turnos') abrirMisTurnos();
  if (nombre === 'emp-solicitudes') abrirMisSolicitudes();
  if (nombre === 'emp-ajustes') abrirAjustesEmpleado();
  if (nombre === 'solicitudes') abrirSolicitudes('pending');
}

document.querySelectorAll('.tab-btn[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => cambiarPestana(btn.dataset.tab));
});

/* ---------- Vistas ---------- */
/* Muestra u oculta las pestañas de solicitudes (gestor y empleado)
   según la preferencia guardada en el negocio. */
function aplicarVisibilidadSolicitudes() {
  const activas = !(ctx.business && ctx.business.config
    && ctx.business.config.solicitudes_activas === false);
  // Solo tocamos la pestaña del rol actual, para no romper la separación gestor/empleado
  const selector = (ctx.role === 'manager')
    ? '[data-tab="solicitudes"]' : '[data-tab="emp-solicitudes"]';
  const btn = document.querySelector(selector);
  if (btn) {
    // Si se desactiva, se oculta. Si se activa, se muestra (su clase de rol ya la controla mostrarApp).
    btn.hidden = !activas;
  }
  // Si estabas en esa pestaña y se desactiva, vuelve a Hoy
  if (!activas) {
    const actual = document.querySelector('.tab-btn.active');
    if (actual && /solicitudes/.test(actual.dataset.tab || '')) {
      cambiarPestana(ctx.role === 'manager' ? 'hoy' : 'emp-hoy');
    }
  }
  return activas;
}

function soloFormulario(id) {
  for (const f of ['form-login','form-registro','form-recuperar','form-nueva-pass']) {
    const el = $(f);
    if (el) el.hidden = (f !== id);
  }
}

function mostrarLogin() {
  soloFormulario('form-login');
  $('vista-login').hidden = false;
  $('vista-app').hidden = true;
  $('cargando').hidden = true;
  pinta('', '#5a6478');
}

function mostrarApp(session, role, biz) {
  ctx.user = session.user; ctx.role = role; ctx.business = biz;

  $('vista-login').hidden = true;
  $('vista-app').hidden = false;
  $('cargando').hidden = true;

  $('negocio-nombre').textContent = biz.name;
  $('ajustes-cuenta').textContent =
    session.user.email + ' · ' + (role === 'manager' ? 'Gestor' : 'Empleado');

  const esGestor = (role === 'manager');
  document.querySelectorAll('.solo-gestor').forEach((e) => { e.hidden = !esGestor; });
  document.querySelectorAll('.solo-empleado').forEach((e) => { e.hidden = esGestor; });

  if (esGestor) {
    initEquipo();
    initCuadrante();
    initAjustes();
    initProgramadas((startIso) => {   // "Editar" desde Programadas abre esa semana
      cambiarPestana('cuadrante');
      abrirCuadrante(startIso);
    });
    initSolicitudes();
    initAvisos();
    initMigracion();
    initHoy((destino) => cambiarPestana(destino));
    initTema('tema-gestor');
    initNotificaciones((destino) => cambiarPestana(destino));
    pintarPreferencias('pref-notif-gestor', true);
    // Interruptor de solicitudes
    const swSol = $('sw-solicitudes');
    if (swSol) {
      swSol.checked = !(ctx.business.config && ctx.business.config.solicitudes_activas === false);
      swSol.addEventListener('change', async () => {
        const cfg = { ...(ctx.business.config || {}), solicitudes_activas: swSol.checked };
        const { error } = await sb.from('businesses').update({ config: cfg }).eq('id', ctx.business.id);
        if (error) { swSol.checked = !swSol.checked; toast('No se pudo guardar: ' + error.message); return; }
        ctx.business.config = cfg;
        aplicarVisibilidadSolicitudes();
        toast(swSol.checked ? 'Solicitudes activadas' : 'Solicitudes desactivadas');
      });
    }
    aplicarVisibilidadSolicitudes();
    initPushUI('btn-push-gestor');
    initTareas();
    refrescarContadorTareas();
    refrescarContador();              // aviso de pendientes al entrar
    pintarTablon('tablon-gestor');
    pintarTablon('tablon-hoy');
    cambiarPestana('hoy');            // el panel de hoy es la primera pantalla
  } else {
    initEmpleado();
    initMisSolicitudes();
    initAjustesEmpleado();
    initTema('tema-empleado');
    initNotificaciones((destino) => cambiarPestana(destino));
    pintarPreferencias('pref-notif-empleado', false);
    aplicarVisibilidadSolicitudes();
    initPushUI('btn-push-empleado');
    pintarTablon('tablon-empleado');
    pintarTablon('tablon-emp-hoy');
    cambiarPestana('emp-hoy');
  }
}

async function cargarNegocio(session) {
  if (recuperando) return;   // durante la recuperación no se entra a la app

  // Si quedó un código de invitación pendiente (registro con confirmación de email),
  // se canjea ahora que ya hay sesión, antes de comprobar el negocio.
  try {
    const pendiente = await codigoPendiente();
    if (pendiente) {
      await canjearCodigo(pendiente);
      await limpiarCodigoPendiente();
    }
  } catch (_) { /* si falla, se verá el aviso de 'sin negocio' y podrá reintentar */ }
  paso('Cargando tu negocio…');
  const { data: mem, error: e1 } = await sb
    .from('memberships').select('role, business_id');
  if (e1) throw new Error('memberships: ' + e1.message);
  if (!mem || mem.length === 0)
    throw new Error('Tu cuenta no está asociada a ningún negocio.');

  const { data: biz, error: e2 } = await sb
    .from('businesses').select('id, name, config')
    .eq('id', mem[0].business_id).maybeSingle();
  if (e2) throw new Error('businesses: ' + e2.message);
  if (!biz) throw new Error('No se pudo cargar el negocio.');

  ctx.workerId = null;
  if (mem[0].role === 'employee') {
    const { data: w } = await sb
      .from('workers').select('id')
      .eq('business_id', biz.id)
      .eq('profile_id', session.user.id)
      .maybeSingle();
    ctx.workerId = w ? w.id : null;
  }

  mostrarApp(session, mem[0].role, biz);
}

/* ---------- Eventos ---------- */
$('form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-entrar');
  btn.disabled = true; btn.textContent = 'Entrando…';
  try {
    paso('Autenticando…');
    const session = await signIn($('email').value, $('password').value);
    await cargarNegocio(session);
  } catch (err) {
    fallo(err.message || String(err));
  } finally {
    btn.disabled = false; btn.textContent = 'Entrar';
  }
});

/* ---------- Cambiar email ---------- */
async function pedirCambioEmail(inputId, btn) {
  const val = $(inputId).value.trim();
  if (!val || !val.includes('@')) { toast('Escribe un email válido'); return; }
  btn.disabled = true;
  try {
    await cambiarEmail(val);
    $(inputId).value = '';
    toast('Te hemos enviado un correo a ' + val + '. Ábrelo para confirmar el cambio.');
  } catch (err) { toast(err.message); }
  finally { btn.disabled = false; }
}
const beg = $('btn-cambiar-email');
if (beg) beg.addEventListener('click', () => pedirCambioEmail('gestor-email-nuevo', beg));

// Cambio de contraseña del gestor
const bgp = $('btn-gestor-cambiar-pass');
if (bgp) bgp.addEventListener('click', async () => {
  const p1 = $('gestor-pass1').value, p2 = $('gestor-pass2').value;
  if (p1.length < 6) { toast('La contraseña debe tener al menos 6 caracteres'); return; }
  if (p1 !== p2) { toast('Las dos contraseñas no coinciden'); return; }
  bgp.disabled = true; bgp.textContent = 'Guardando…';
  try {
    await cambiarPassword(p1);
    $('gestor-pass1').value = ''; $('gestor-pass2').value = '';
    toast('Contraseña cambiada');
  } catch (err) { toast('No se pudo cambiar: ' + err.message); }
  finally { bgp.disabled = false; bgp.textContent = 'Cambiar contraseña'; }
});
const bee = $('btn-emp-cambiar-email');
if (bee) bee.addEventListener('click', () => pedirCambioEmail('emp-email-nuevo', bee));

const bmt = $('btn-marcar-todas');
if (bmt) bmt.addEventListener('click', accionMarcarTodas);
const bbn = $('btn-borrar-notif');
if (bbn) bbn.addEventListener('click', accionBorrarTodas);

/* ---------- Recuperar contraseña ---------- */
$('link-olvide').addEventListener('click', (e) => {
  e.preventDefault();
  soloFormulario('form-recuperar');
  $('rec-email').value = $('email').value;
});
$('link-volver-login2').addEventListener('click', (e) => {
  e.preventDefault();
  soloFormulario('form-login');
});

$('form-recuperar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-recuperar');
  const msg = $('recuperar-msg');
  msg.style.color = '#c62838'; msg.textContent = '';
  btn.disabled = true; btn.textContent = 'Enviando…';
  try {
    await pedirRecuperacion($('rec-email').value);
    msg.style.color = '#1d7a4f';
    msg.textContent = 'Si esa dirección tiene cuenta, te llegará un correo con el enlace. Revisa también la carpeta de spam.';
  } catch (err) {
    msg.textContent = err.message;
  } finally {
    btn.disabled = false; btn.textContent = 'Enviar enlace';
  }
});

$('form-nueva-pass').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-nueva-pass');
  const msg = $('nueva-pass-msg');
  msg.style.color = '#c62838'; msg.textContent = '';
  const p1 = $('np1').value, p2 = $('np2').value;
  if (p1.length < 6) { msg.textContent = 'La contraseña debe tener al menos 6 caracteres.'; return; }
  if (p1 !== p2) { msg.textContent = 'Las dos contraseñas no coinciden.'; return; }
  btn.disabled = true; btn.textContent = 'Guardando…';
  try {
    await cambiarPassword(p1);
    recuperando = false;
    history.replaceState(null, '', location.pathname);
    const session = await getSession();
    if (session) await cargarNegocio(session);
    else { soloFormulario('form-login'); toast('Contraseña cambiada. Ya puedes entrar.'); }
  } catch (err) {
    msg.textContent = err.message;
    btn.disabled = false; btn.textContent = 'Guardar y entrar';
  }
});

/* ---------- Registro con código de invitación ---------- */
$('link-registro').addEventListener('click', (e) => {
  e.preventDefault();
  $('form-login').hidden = true;
  $('form-registro').hidden = false;
});
$('link-volver-login').addEventListener('click', (e) => {
  e.preventDefault();
  $('form-registro').hidden = true;
  $('form-login').hidden = false;
});

/* Al escribir el código completo, se muestra a quién pertenece */
let temporizadorCodigo = null;
$('r-codigo').addEventListener('input', () => {
  const aviso = $('r-quien');
  const val = $('r-codigo').value.trim().toUpperCase();
  $('r-codigo').value = val;
  aviso.hidden = true;
  clearTimeout(temporizadorCodigo);
  if (val.length < 4) return;
  temporizadorCodigo = setTimeout(async () => {
    const nombre = await nombreDelCodigo(val);
    if (nombre) {
      aviso.textContent = 'Vas a crear la cuenta de ' + nombre + '.';
      aviso.className = 'r-quien ok';
      aviso.hidden = false;
    } else {
      aviso.textContent = 'Ese código no es válido o ya se ha usado.';
      aviso.className = 'r-quien err';
      aviso.hidden = false;
    }
  }, 450);
});

$('form-registro').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-registrar');
  const err = $('registro-error');
  err.style.color = '#c62838'; err.textContent = '';
  btn.disabled = true; btn.textContent = 'Creando cuenta…';
  try {
    const codigo = $('r-codigo').value.trim().toUpperCase();
    if (codigo.length < 4) throw new Error('Escribe el código que te ha dado tu responsable.');
    // El nombre viene de la ficha. El código se guarda y se canjea tras confirmar el email.
    const session = await signUp($('r-email').value, $('r-pass').value, null, codigo);
    if (session) {
      // Confirmación de email desactivada: hay sesión inmediata, se canjea ya.
      await canjearCodigo(codigo);
      await limpiarCodigoPendiente();
      await cargarNegocio(session);
    } else {
      // Confirmación activada: aún no hay sesión. Se avisa y se canjeará al confirmar.
      err.style.color = '#1d7a4f';
      err.textContent = 'Te hemos enviado un correo para confirmar tu cuenta. '
        + 'Ábrelo y pulsa el enlace para entrar.';
    }
  } catch (e2) {
    err.textContent = e2.message || String(e2);
  } finally {
    btn.disabled = false; btn.textContent = 'Crear cuenta';
  }
});

$('btn-salir').addEventListener('click', async () => {
  const ok = await confirmar('¿Seguro que quieres cerrar la sesión?', {
    textoOk: 'Cerrar sesión', peligro: true,
  });
  if (!ok) return;
  await signOut();
  location.reload();
});

/* ---------- Arranque ---------- */
initPWA();

// Cuando se pulsa una notificación push, el SW nos dice a qué pestaña ir
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data && e.data.tipo === 'abrir-tab' && e.data.tab) {
      try { cambiarPestana(e.data.tab); } catch (_) {}
    }
  });
}

initPrivacidad();

function mostrarNuevaPassword() {
  recuperando = true;
  $('vista-login').hidden = false;
  $('vista-app').hidden = true;
  $('cargando').hidden = true;
  soloFormulario('form-nueva-pass');
}

/* Vía fiable: el evento que dispara Supabase al volver del correo */
alRecuperarPassword(mostrarNuevaPassword);

/* Respaldo: el hash se capturó en index.html antes de que Supabase lo
   limpiara. También miramos el hash actual por si aún estuviera. */
// Solo es recuperación si el tipo es recovery (no signup, que es confirmar registro)
const hashRecovery = (window.__staffpoint_recovery === true
    || location.hash.includes('type=recovery')
    || location.hash.includes('recuperar'))
  && !location.hash.includes('type=signup')
  && !location.hash.includes('type=email_change');

// Aviso al volver de confirmar un cambio de email
if (location.hash.includes('type=email_change')) {
  setTimeout(() => { try { toast('Email actualizado correctamente.'); } catch (_) {} }, 800);
}

try {
  paso('Comprobando sesión…');
  const session = await getSession();
  if (hashRecovery && session) {
    mostrarNuevaPassword();
  } else if (session) {
    await cargarNegocio(session);
  } else {
    mostrarLogin();
  }
} catch (err) {
  fallo('Arranque: ' + (err.message || err));
  mostrarLogin();
}
