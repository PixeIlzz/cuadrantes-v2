// Aviso de privacidad: texto informativo para el equipo y para el gestor.
import { toast } from './toast.js';
import { ctx } from '../auth.js';

const $ = (id) => document.getElementById(id);

/* El texto se genera con el nombre del negocio para que sea concreto.
   No sustituye a un asesoramiento legal: es información al trabajador,
   que es lo que exige el RGPD cuando se tratan sus datos. */
function textoAviso(negocio) {
  const n = negocio || 'el negocio';
  return [
    ['¿Quién trata tus datos?',
     'El responsable es ' + n + ', que utiliza la aplicación StaffPoint para organizar los turnos del equipo.'],
    ['¿Qué datos se guardan?',
     'Tu nombre, tu email, el número de turnos que trabajas por semana, los turnos que se te asignan, '
     + 'tus periodos de vacaciones y las solicitudes que envías con sus respuestas. '
     + 'No se guardan datos bancarios, ni tu DNI, ni tu ubicación.'],
    ['¿Para qué se usan?',
     'Únicamente para organizar el cuadrante de trabajo, gestionar vacaciones y responder a tus solicitudes. '
     + 'No se usan con fines publicitarios ni se venden a terceros.'],
    ['¿Quién puede verlos?',
     'El responsable del negocio ve todos los datos del equipo. '
     + 'Tus compañeros solo ven el cuadrante publicado, es decir, quién trabaja cada día. '
     + 'Tus solicitudes y sus respuestas solo las veis tú y el responsable.'],
    ['¿Dónde se guardan?',
     'En servidores de Supabase situados en Alemania (Unión Europea), con acceso protegido por contraseña '
     + 'y reglas que impiden que una persona vea datos que no le corresponden.'],
    ['¿Cuánto tiempo?',
     'Mientras formes parte del equipo. Cuando dejes de trabajar en el negocio, el responsable puede eliminar '
     + 'tu ficha y tu cuenta.'],
    ['¿Qué derechos tienes?',
     'Puedes pedir acceder a tus datos, corregirlos si están mal, eliminarlos, u oponerte a su tratamiento. '
     + 'Para ejercerlos, habla con el responsable del negocio. '
     + 'También puedes reclamar ante la Agencia Española de Protección de Datos (www.aepd.es).'],
  ];
}

function abrirModal(negocio, paraEmpleado) {
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  const caja = document.createElement('div');
  caja.className = 'modal modal-privacidad';

  const h = document.createElement('h2');
  h.className = 'priv-tit';
  h.textContent = 'Privacidad y protección de datos';
  caja.appendChild(h);

  const cuerpo = document.createElement('div');
  cuerpo.className = 'priv-cuerpo';
  for (const [titulo, texto] of textoAviso(negocio)) {
    const b = document.createElement('div');
    b.className = 'priv-bloque';
    const t = document.createElement('div');
    t.className = 'priv-h';
    t.textContent = titulo;
    const p = document.createElement('p');
    p.className = 'priv-p';
    p.textContent = texto;
    b.append(t, p);
    cuerpo.appendChild(b);
  }

  if (!paraEmpleado) {
    const aviso = document.createElement('div');
    aviso.className = 'priv-nota-gestor';
    aviso.innerHTML =
      '<b>Para ti, como responsable:</b> este texto informa a tu equipo, que es lo que exige el RGPD '
      + 'cuando tratas sus datos. Enséñaselo antes de darles acceso. '
      + 'Si en el futuro vendes la aplicación a otros negocios, necesitarás además un contrato de '
      + 'encargado de tratamiento con cada cliente y revisar todo esto con un asesor. '
      + 'Esto es información general, no asesoramiento jurídico.';
    cuerpo.appendChild(aviso);
  }
  caja.appendChild(cuerpo);

  const fila = document.createElement('div');
  fila.className = 'row';
  const cerrar = document.createElement('button');
  cerrar.type = 'button'; cerrar.className = 'btn primary'; cerrar.textContent = 'Entendido';
  cerrar.addEventListener('click', () => bg.remove());
  fila.appendChild(cerrar);
  caja.appendChild(fila);

  bg.addEventListener('click', (e) => { if (e.target === bg) bg.remove(); });
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { bg.remove(); document.removeEventListener('keydown', esc); }
  });

  bg.appendChild(caja);
  document.body.appendChild(bg);
}

/* Texto plano, para pegarlo en WhatsApp o imprimirlo */
function textoPlano(negocio) {
  return 'AVISO DE PRIVACIDAD · ' + (negocio || '') + '\n\n'
    + textoAviso(negocio).map(([t, x]) => t.toUpperCase() + '\n' + x).join('\n\n');
}

export function initPrivacidad() {
  const negocio = () => (ctx.business ? ctx.business.name : '');

  document.querySelectorAll('.link-privacidad').forEach((a) => {
    a.addEventListener('click', (e) => { e.preventDefault(); abrirModal('', true); });
  });
  const bg = $('btn-ver-privacidad');
  if (bg) bg.addEventListener('click', () => abrirModal(negocio(), false));
  const be = $('btn-privacidad-emp');
  if (be) be.addEventListener('click', () => abrirModal(negocio(), true));

  const bc = $('btn-copiar-aviso');
  if (bc) bc.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(textoPlano(negocio()));
      toast('Texto copiado. Ya puedes pegarlo donde quieras.');
    } catch (_) {
      toast('No se pudo copiar. Abre el aviso y cópialo a mano.');
    }
  });
}
