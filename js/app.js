// Arranque, login y navegación por pestañas. v7
import { ctx, signIn, signUp, signOut, getSession, pedirRecuperacion, cambiarPassword, cambiarEmail, alRecuperarPassword, codigoPendiente, limpiarCodigoPendiente } from './auth.js';
import { sb } from './supabase.js';
import { toast } from './ui/toast.js';
import { initPWA } from './pwa.js';
import { pintarVersion } from './ui/version.js';
import { initTema } from './ui/tema.js';
import { confirmar } from './ui/confirmar.js';
import { initEquipo, abrirEquipo } from './ui/equipo.js';
import { initCuadrante, actualizarAvisoPestana, abrirCuadrante } from './ui/cuadrante.js';
import { initProgramadas, abrirProgramadas } from './ui/programadas.js';
import { initAjustes, abrirAjustes } from './ui/ajustes.js';
import { initAvisos, abrirAvisos, pintarTablon } from './ui/avisos.js';
import { initMigracion } from './ui/migracion.js';
import { initPrivacidad } from './ui/privacidad.js';
import { initNotificaciones, refrescarBadge, accionMarcarTodas, accionBorrarTodas, pintarPreferencias } from './ui/notificaciones.js';
import { initPushUI } from './ui/push.js';
import { ofrecerAvisos } from './ui/push-bienvenida.js';
import { abrirFichajeEmpleado, abrirFichajeGestor, pintarAjustesFichaje, pintarDatosLegales } from './ui/fichaje.js';
import { abrirMiRegistro } from './ui/mi-registro.js';
import { initHoy, abrirHoy } from './ui/hoy.js';
import { initTareas, abrirTareas, refrescarContadorTareas } from './ui/tareas.js';
import { initEmpleado, abrirEmpCuadrante, abrirMisTurnos, abrirEmpHoy } from './ui/empleado.js';
import { initAjustesEmpleado, abrirAjustesEmpleado } from './ui/ajustes-empleado.js';
import { arrancarKiosco, mostrarEmparejamiento, revisarVinculacionPendiente, pintarPinEmpleado, escanearYVincular, pintarKioscos } from './ui/kiosco.js';
import { canjearCodigo, nombreDelCodigo } from './data/invitaciones.js';
import { soyAdmin } from './data/plataforma.js';
import { initConsola, CLAVE_ENTRAR } from './ui/consola.js';
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
const PESTANAS = ['hoy', 'cuadrante', 'programar', 'equipo', 'fichaje', 'tareas', 'solicitudes', 'ajustes',
                  'emp-hoy', 'emp-fichaje', 'emp-cuadrante', 'emp-turnos', 'emp-solicitudes', 'emp-ajustes'];

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
  if (nombre === 'ajustes') { abrirAjustes(); abrirAvisos(); if (ctx.fichajeActivo) { pintarAjustesFichaje(); pintarKioscos(ctx); pintarDatosLegales(); } }
  if (nombre === 'emp-cuadrante') abrirEmpCuadrante();
  if (nombre === 'emp-turnos') abrirMisTurnos();
  if (nombre === 'emp-solicitudes') abrirMisSolicitudes();
  if (nombre === 'emp-ajustes') { abrirAjustesEmpleado(); if (ctx.fichajeActivo) pintarPinEmpleado(ctx); }
  if (nombre === 'solicitudes') abrirSolicitudes('pending');
  if (nombre === 'fichaje') abrirFichajeGestor();
  if (nombre === 'emp-fichaje') abrirMiRegistro();
}

document.querySelectorAll('.tab-btn[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => cambiarPestana(btn.dataset.tab));
});

/* ---------- Vistas ---------- */
/* El interruptor `solicitudes_activas` apaga vacaciones y cambios de turno.
   Es asimétrico a propósito:

   · Al EMPLEADO se le oculta la pestaña entera: así no puede enviar nada.
     Sus correcciones de fichaje las sigue proponiendo y consultando desde
     «Mi registro», que no depende de este interruptor.
   · Al GESTOR la pestaña le queda SIEMPRE visible: aunque haya apagado las
     solicitudes le pueden seguir llegando correcciones de fichaje, y si la
     pestaña desapareciera tendría una cola invisible de peticiones que está
     obligado a atender. */
function aplicarVisibilidadSolicitudes() {
  const activas = !(ctx.business && ctx.business.config
    && ctx.business.config.solicitudes_activas === false);
  const esGestor = (ctx.role === 'manager');

  if (esGestor) {
    const aviso = $('sol-apagadas-gestor');
    if (aviso) aviso.hidden = activas;
    return activas;
  }

  // Empleado: la pestaña se oculta si están desactivadas
  const btn = document.querySelector('[data-tab="emp-solicitudes"]');
  if (btn) btn.hidden = !activas;

  // Si estaba dentro y se desactivan, vuelve a Hoy
  if (!activas) {
    const actual = document.querySelector('.tab-btn.active');
    if (actual && /solicitudes/.test(actual.dataset.tab || '')) cambiarPestana('emp-hoy');
  }
  return activas;
}

// Si el empleado intenta enviar y el servidor dice que están desactivadas,
// actualizamos su config local y ocultamos la pestaña sin esperar recarga.
window.addEventListener('solicitudes-desactivadas', () => {
  if (ctx.business) {
    ctx.business.config = { ...(ctx.business.config || {}), solicitudes_activas: false };
    aplicarVisibilidadSolicitudes();
  }
});

function soloFormulario(id) {
  for (const f of ['form-login','form-registro','form-recuperar','form-nueva-pass',
                   'form-alta','form-negocio','form-canjear']) {
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

/* Pantalla de "tienes cuenta pero todavía no tienes negocio" */
function mostrarAltaNegocio() {
  $('vista-login').hidden = false;
  $('vista-app').hidden = true;
  $('cargando').hidden = true;
  pinta('', '#5a6478');
  soloFormulario('form-negocio');
}

function mostrarApp(session, role, biz) {
  ctx.user = session.user; ctx.role = role; ctx.business = biz;

  $('vista-login').hidden = true;
  $('vista-app').hidden = false;
  $('cargando').hidden = true;

  $('negocio-nombre').textContent = biz.name;
  $('ajustes-cuenta').textContent =
    session.user.email + ' · ' + (role === 'manager' ? 'Gestor' : 'Empleado');
  pintarVersion();   // cabecera y pie de Ajustes; no bloquea el arranque

  const esGestor = (role === 'manager');
  document.querySelectorAll('.solo-gestor').forEach((e) => { e.hidden = !esGestor; });
  document.querySelectorAll('.solo-empleado').forEach((e) => { e.hidden = esGestor; });
  // Módulo de fichaje: visible si el negocio lo tiene activo (o, mientras
  // dure la transición, si la cuenta es probadora). Ver migración 44.
  document.querySelectorAll('.solo-probador').forEach((e) => {
    // respeta también la separación de rol: si es panel de gestor y soy empleado, sigue oculto
    const esDeGestor = e.classList.contains('solo-gestor');
    const esDeEmpleado = e.classList.contains('solo-empleado');
    let ocultarPorRol = false;
    if (esDeGestor && !esGestor) ocultarPorRol = true;
    if (esDeEmpleado && esGestor) ocultarPorRol = true;
    e.hidden = !ctx.fichajeActivo || ocultarPorRol;
  });


  if (esGestor) {
    initEquipo();
    initCuadrante();
    actualizarAvisoPestana();   // muestra ⚠ en la pestaña si hay cambios sin avisar
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

    /* Interruptor del fichaje. Vive AQUÍ y no en Ajustes → Fichaje a
       propósito: esa sección está oculta mientras el módulo esté apagado,
       así que un negocio nuevo nunca podría encenderlo desde dentro. */
    const swFich = $('sw-fichaje');
    if (swFich) {
      swFich.checked = !!(ctx.business.config && ctx.business.config.fichaje
        && ctx.business.config.fichaje.activo === true);
      swFich.addEventListener('change', async () => {
        if (swFich.checked) {
          const ok = await confirmar(
            'El fichaje pasará a estar disponible para toda la plantilla, y sus '
            + 'registros son el documento que hay que entregar a una inspección. '
            + 'Comprueba antes la razón social, el CIF y los NIF. ¿Activarlo?',
            { textoOk: 'Activar', textoNo: 'Ahora no' });
          if (!ok) { swFich.checked = false; return; }
        }
        const fich = { ...((ctx.business.config || {}).fichaje || {}), activo: swFich.checked };
        const cfg = { ...(ctx.business.config || {}), fichaje: fich };
        const { error } = await sb.from('businesses').update({ config: cfg }).eq('id', ctx.business.id);
        if (error) { swFich.checked = !swFich.checked; toast('No se pudo guardar: ' + error.message); return; }
        ctx.business.config = cfg;
        toast(swFich.checked
          ? 'Fichaje activado. Recarga para verlo.'
          : 'Fichaje desactivado. Recarga para aplicarlo.');
      });
    }

    aplicarVisibilidadSolicitudes();
    initPushUI('btn-push-gestor');
    ofrecerAvisos();
    initTareas();
    refrescarContadorTareas();
    refrescarContador();              // aviso de pendientes al entrar
    pintarTablon('tablon-gestor');
    pintarTablon('tablon-hoy');
    if (ctx.fichajeActivo) {
      const bvk = $('btn-vincular-kiosko');
      if (bvk) bvk.onclick = () => escanearYVincular(ctx);
    }
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
    ofrecerAvisos();
    pintarTablon('tablon-empleado');
    pintarTablon('tablon-emp-hoy');
    cambiarPestana('emp-hoy');
  }

  // Si el gestor ha llegado escaneando el QR de un kiosco, completar la vinculación.
  revisarVinculacionPendiente(ctx);
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
  /* Sesión iniciada pero sin negocio. Antes esto era un callejón sin salida
     ("Tu cuenta no está asociada a ningún negocio") y solo se arreglaba desde
     el SQL Editor. Ahora se ofrece crear uno o entrar con un código. */
  if (!mem || mem.length === 0) { mostrarAltaNegocio(); return; }

  /* El administrador de la plataforma aterriza en la CONSOLA, no en la app
     de gestor: no gestiona turnos, gestiona empresas. Solo entra en un
     negocio si lo ha elegido expresamente desde allí (el suyo, o uno de un
     cliente con sesión de soporte abierta). */
  ctx.esAdmin = await soyAdmin();
  let entrarEn = null;
  try { entrarEn = sessionStorage.getItem(CLAVE_ENTRAR); } catch (_) {}

  if (ctx.esAdmin && !entrarEn) { mostrarConsola(session, mem); return; }

  if ((!mem || mem.length === 0) && !entrarEn) { mostrarAltaNegocio(); return; }

  const bizId = entrarEn || mem[0].business_id;
  const propia = (mem || []).find((m) => m.business_id === bizId);
  // En soporte no hay membresía: se entra con permisos de gestor, que es lo
  // que concede la sesión, y con un aviso visible en pantalla.
  const rol = propia ? propia.role : 'manager';
  ctx.enSoporte = !propia;

  const { data: biz, error: e2 } = await sb
    .from('businesses').select('id, name, config')
    .eq('id', bizId).maybeSingle();
  if (e2) throw new Error('businesses: ' + e2.message);
  if (!biz) {
    try { sessionStorage.removeItem(CLAVE_ENTRAR); } catch (_) {}
    throw new Error('No se pudo cargar el negocio. Si era una sesión de soporte, puede haber caducado.');
  }

  /* ¿Se ve el módulo de fichaje? Desde la migración 44 la puerta es un
     ajuste DEL NEGOCIO (config.fichaje.activo). La marca de probador se
     mantiene como respaldo durante la transición, para no dejar sin
     fichaje a quien ya lo estaba usando mientras el negocio siga apagado. */
  try {
    const { data: prof } = await sb.rpc('soy_probador');
    ctx.esProbador = prof === true;
  } catch (_) { ctx.esProbador = false; }

  const fichajeDelNegocio = !!(biz.config && biz.config.fichaje
    && biz.config.fichaje.activo === true);
  ctx.fichajeActivo = fichajeDelNegocio || ctx.esProbador;

  ctx.workerId = null;
  if (rol === 'employee') {
    const { data: w } = await sb
      .from('workers').select('id')
      .eq('business_id', biz.id)
      .eq('profile_id', session.user.id)
      .maybeSingle();
    ctx.workerId = w ? w.id : null;
  }

  mostrarApp(session, rol, biz);
  if (ctx.enSoporte) avisoSoporte(biz.name);
}

/* Consola del dueño de la plataforma */
function mostrarConsola(session, mem) {
  $('vista-login').hidden = true;
  $('vista-app').hidden = true;
  $('vista-admin').hidden = false;
  $('cargando').hidden = true;
  pinta('', '#5a6478');
  const propio = (mem || []).find((m) => m.role === 'manager');
  initConsola(session.user.email, !!propio, propio ? propio.business_id : null);
}

/* Franja fija mientras se está dentro de la empresa de un cliente. Que no
   se pueda olvidar en qué cuenta estás es media seguridad del asunto. */
function avisoSoporte(nombre) {
  const b = document.createElement('div');
  b.className = 'soporte-banda';
  b.innerHTML = '<span>🛟 Modo soporte · <b>' + (nombre || '') + '</b></span>';
  const volver = document.createElement('button');
  volver.type = 'button'; volver.className = 'btn small';
  volver.textContent = 'Volver a la consola';
  volver.addEventListener('click', () => {
    try { sessionStorage.removeItem(CLAVE_ENTRAR); } catch (_) {}
    location.reload();
  });
  b.appendChild(volver);
  document.body.appendChild(b);
  document.body.classList.add('con-soporte');
}

document.addEventListener('staffpoint:salir', async () => {
  await signOut();
  location.reload();
});

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

/* ================= ALTA DE UN NEGOCIO NUEVO =================
   Hasta ahora create_business() existía en la base de datos pero no la
   llamaba nadie: dar de alta un cliente exigía entrar al SQL Editor. Estas
   pantallas cierran ese hueco, que era lo último que impedía que un negocio
   pudiera empezar a usar StaffPoint por su cuenta.

   El recorrido: crear cuenta sin código -> ponerle nombre al negocio ->
   dentro como gestor. Y desde la pantalla del nombre se puede saltar a
   canjear un código, por si quien llega ahí era en realidad un empleado. */

$('link-alta-negocio').addEventListener('click', (e) => {
  e.preventDefault();
  soloFormulario('form-alta');
});
$('link-volver-login3').addEventListener('click', (e) => {
  e.preventDefault();
  soloFormulario('form-login');
});

$('form-alta').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-alta'); const msg = $('alta-error');
  msg.textContent = ''; btn.disabled = true;
  try {
    // Sin código: la cuenta nace sin negocio y el paso siguiente lo crea
    await signUp($('a-email').value, $('a-pass').value, null, null);
    soloFormulario('form-negocio');
  } catch (err) {
    msg.textContent = err.message || 'No se pudo crear la cuenta.';
  } finally { btn.disabled = false; }
});

$('form-negocio').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-crear-negocio'); const msg = $('negocio-error');
  const nombre = $('n-nombre').value.trim();
  if (!nombre) return;
  msg.textContent = ''; btn.disabled = true;
  try {
    // El código de alta lo emites tú, uno por cliente (migración 45).
    // Sin él no se puede crear un negocio, salvo que la cuenta sea admin.
    const codigo = ($('n-codigo').value || '').trim().toUpperCase();
    const { error } = await sb.rpc('create_business', { p_name: nombre, p_codigo: codigo });
    if (error) throw new Error(error.message);
    location.reload();          // se recarga ya con negocio y rol de gestor
  } catch (err) {
    msg.textContent = err.message || 'No se pudo crear el negocio.';
    btn.disabled = false;
  }
});

$('link-canjear').addEventListener('click', (e) => {
  e.preventDefault();
  soloFormulario('form-canjear');
});
$('link-volver-negocio').addEventListener('click', (e) => {
  e.preventDefault();
  soloFormulario('form-negocio');
});

$('form-canjear').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-canjear'); const msg = $('canjear-error');
  msg.textContent = ''; btn.disabled = true;
  try {
    await canjearCodigo($('c-codigo').value.trim().toUpperCase());
    location.reload();
  } catch (err) {
    msg.textContent = err.message || 'No se pudo usar ese código.';
    btn.disabled = false;
  }
});

$('link-salir-alta').addEventListener('click', async (e) => {
  e.preventDefault();
  await signOut();
  location.reload();
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

/* ---------- Emparejar kiosko desde el login ---------- */
const btnEmpKiosko = $('btn-emparejar-kiosko');
if (btnEmpKiosko) btnEmpKiosko.addEventListener('click', () => {
  location.hash = '#emparejar-kiosko';
  mostrarEmparejamiento();
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

// Si esta carga es modo kiosco (tablet emparejada o pantalla de emparejar),
// tomamos esa pantalla y no seguimos con el login ni la carga de negocio.
if (arrancarKiosco()) {
  // nada más: el módulo del kiosco ya ha pintado su pantalla.
} else {
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
}
