// Arranque, login y navegación por pestañas. v7
import { ctx, signIn, signUp, signOut, getSession } from './auth.js';
import { sb } from './supabase.js';
import { toast } from './ui/toast.js';
import { confirmar } from './ui/confirmar.js';
import { initEquipo, abrirEquipo } from './ui/equipo.js';
import { initCuadrante, abrirCuadrante } from './ui/cuadrante.js';
import { initProgramadas, abrirProgramadas } from './ui/programadas.js';
import { initAjustes, abrirAjustes } from './ui/ajustes.js';
import { initAvisos, abrirAvisos, pintarTablon } from './ui/avisos.js';
import { initEmpleado, abrirEmpCuadrante, abrirMisTurnos } from './ui/empleado.js';
import { canjearCodigo } from './data/invitaciones.js';
import {
  initSolicitudes, abrirSolicitudes, refrescarContador,
  initMisSolicitudes, abrirMisSolicitudes,
} from './ui/solicitudes.js';

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
const PESTANAS = ['cuadrante', 'programar', 'equipo', 'solicitudes', 'ajustes',
                  'emp-cuadrante', 'emp-turnos', 'emp-solicitudes'];

function cambiarPestana(nombre) {
  document.querySelectorAll('.tab-btn[data-tab]').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === nombre));
  for (const t of PESTANAS) $('tab-' + t).hidden = (t !== nombre);
  if (nombre === 'equipo') abrirEquipo();
  if (nombre === 'cuadrante') abrirCuadrante();
  if (nombre === 'programar') abrirProgramadas();
  if (nombre === 'ajustes') { abrirAjustes(); abrirAvisos(); }
  if (nombre === 'emp-cuadrante') abrirEmpCuadrante();
  if (nombre === 'emp-turnos') abrirMisTurnos();
  if (nombre === 'emp-solicitudes') abrirMisSolicitudes();
  if (nombre === 'solicitudes') abrirSolicitudes('pending');
}

document.querySelectorAll('.tab-btn[data-tab]').forEach((btn) => {
  btn.addEventListener('click', () => cambiarPestana(btn.dataset.tab));
});

/* ---------- Vistas ---------- */
function mostrarLogin() {
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
    refrescarContador();              // aviso de pendientes al entrar
    pintarTablon('tablon-gestor');
    cambiarPestana('cuadrante');
  } else {
    initEmpleado();
    initMisSolicitudes();
    pintarTablon('tablon-empleado');
    cambiarPestana('emp-cuadrante');
  }
}

async function cargarNegocio(session) {
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

$('form-registro').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('btn-registrar');
  const err = $('registro-error');
  err.style.color = '#c62838'; err.textContent = '';
  btn.disabled = true; btn.textContent = 'Creando cuenta…';
  try {
    const codigo = $('r-codigo').value.trim().toUpperCase();
    if (codigo.length < 4) throw new Error('Escribe el código que te ha dado tu responsable.');
    const session = await signUp($('r-email').value, $('r-pass').value, $('r-nombre').value.trim());
    await canjearCodigo(codigo);
    await cargarNegocio(session);
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
try {
  paso('Comprobando sesión…');
  const session = await getSession();
  if (session) {
    await cargarNegocio(session);
  } else {
    mostrarLogin();
  }
} catch (err) {
  fallo('Arranque: ' + (err.message || err));
  mostrarLogin();
}
