// Arranque, login y navegación por pestañas. v6
import { ctx, signIn, signOut, getSession } from './auth.js?v=6';
import { sb } from './supabase.js?v=6';
import { toast } from './ui/toast.js?v=6';
import { initEquipo, abrirEquipo } from './ui/equipo.js?v=6';

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
const PESTANAS = ['cuadrante', 'programar', 'equipo', 'solicitudes', 'ajustes'];

function cambiarPestana(nombre) {
  document.querySelectorAll('.tab-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === nombre));
  for (const t of PESTANAS) $('tab-' + t).hidden = (t !== nombre);
  if (nombre === 'equipo') abrirEquipo();   // recarga de la base de datos al entrar
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
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

  initEquipo();
  cambiarPestana('cuadrante');
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

$('btn-salir').addEventListener('click', async () => {
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
