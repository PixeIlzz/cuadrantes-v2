// Arranque. v5 — misma estructura que diagnostico.html (probada en verde).
// Sin onAuthStateChange: era la única diferencia con el diagnóstico y es
// el principal sospechoso del cuelgue. Se reintroducirá con cuidado después.
import { ctx, signIn, signOut, getSession } from './auth.js?v=5';
import { sb } from './supabase.js?v=5';

const $ = (id) => document.getElementById(id);
const errorLogin = $('login-error');

function paso(txt)  { console.log('[paso]', txt); pinta(txt, '#9aa4c7'); }
function fallo(txt) { console.error('[fallo]', txt); pinta(txt, '#d9534f'); }
function pinta(txt, color) {
  if (errorLogin) { errorLogin.style.color = color; errorLogin.textContent = txt; }
}

window.addEventListener('error', (e) => fallo('Error global: ' + e.message));
window.addEventListener('unhandledrejection', (e) =>
  fallo('Promesa sin capturar: ' + (e.reason?.message || e.reason)));

function mostrarLogin() {
  paso('mostrarLogin()');
  $('vista-login').hidden = false;
  $('vista-app').hidden = true;
  $('cargando').hidden = true;
  pinta('', '#9aa4c7');
}

function mostrarApp(session, role, biz) {
  paso('mostrarApp()');
  ctx.user = session.user; ctx.role = role; ctx.business = biz;

  $('vista-login').hidden = true;
  $('vista-app').hidden = false;
  $('cargando').hidden = true;

  $('negocio-nombre').textContent = biz.name;
  $('usuario-email').textContent = session.user.email;
  $('usuario-rol').textContent = role === 'manager' ? 'Gestor' : 'Empleado';

  const cfg = biz.config || {};
  $('debug-dias').textContent    = (cfg.days  || []).map(d => d.label).join(' · ');
  $('debug-puestos').textContent = (cfg.roles || []).map(r => `${r.label} (mín. ${r.min})`).join(' · ');
  const pub = cfg.publish || {};
  const dias = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  $('debug-pub').textContent = `${dias[pub.weekday ?? 0]} a las ${pub.time || '18:00'}`;
}

async function cargarNegocio(session) {
  paso('Leyendo membresías…');
  const { data: mem, error: e1 } = await sb
    .from('memberships').select('role, business_id');
  if (e1) throw new Error('memberships: ' + e1.message);
  if (!mem || mem.length === 0)
    throw new Error('Tu cuenta no está asociada a ningún negocio.');

  paso('Membresía ' + mem[0].role + '. Leyendo negocio…');
  const { data: biz, error: e2 } = await sb
    .from('businesses').select('id, name, config')
    .eq('id', mem[0].business_id).maybeSingle();
  if (e2) throw new Error('businesses: ' + e2.message);
  if (!biz) throw new Error('No se pudo cargar el negocio.');

  paso('Negocio cargado: ' + biz.name);
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
    paso('Login correcto.');
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

/* ---------- Arranque (nivel de módulo, como el diagnóstico) ---------- */
try {
  paso('Comprobando sesión…');
  const session = await getSession();
  paso('getSession → ' + (session ? session.user.email : 'sin sesión'));
  if (session) {
    await cargarNegocio(session);
  } else {
    mostrarLogin();
  }
} catch (err) {
  fallo('Arranque: ' + (err.message || err));
  mostrarLogin();
}
