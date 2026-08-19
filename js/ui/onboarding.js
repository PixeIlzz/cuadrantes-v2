// Guías de bienvenida: una para el gestor que acaba de crear su negocio,
// otra para el empleado que entra por primera vez.
//
// Son GUÍAS, no asistentes que rellenan datos. Es deliberado: reimplementar
// aquí los editores de puestos, días y equipo habría duplicado código que
// se desincroniza en cuanto se toque el original. Cada paso explica para
// qué sirve y lleva al sitio donde ya se hace.
//
// La excepción son la razón social y el CIF, que son dos campos y sí se
// piden aquí: si no se piden al principio no se rellenan nunca, y sin
// ellos el documento que se entrega a inspección sale incompleto.
//
// Ninguna de las dos bloquea: se pueden cerrar y retomar desde Ajustes.
import { toast } from './toast.js';
import { datosLegales, guardarDatosLegales } from '../data/fichaje.js';
import {
  guardarGuiaGestor, estadoGuiaGestor, marcarGuiaEmpleado,
} from '../data/onboarding.js';

const $ = (id) => document.getElementById(id);

function esc(t) {
  return String(t == null ? '' : t)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/* ===================================================================
   Armazón común: tarjeta con pasos, atrás/siguiente y cerrar
   =================================================================== */

/* pasos: [{ titulo, cuerpo (html), campos?, accion? }]
   onFin(estado) se llama al terminar o al cerrar, con el índice alcanzado */
function abrirGuia(pasos, opciones = {}) {
  const { onFin = null, onPaso = null, inicio = 0, textoFin = 'Empezar' } = opciones;

  return new Promise((resolve) => {
    let i = Math.min(Math.max(0, inicio), pasos.length - 1);

    const bg = document.createElement('div');
    bg.className = 'modal-bg ob-bg';
    const caja = document.createElement('div');
    caja.className = 'ob-caja';

    const puntos = document.createElement('div');
    puntos.className = 'ob-puntos';

    const cuerpo = document.createElement('div');
    cuerpo.className = 'ob-cuerpo';

    const pie = document.createElement('div');
    pie.className = 'ob-pie';
    const atras = document.createElement('button');
    atras.type = 'button'; atras.className = 'btn small'; atras.textContent = 'Atrás';
    const saltar = document.createElement('button');
    saltar.type = 'button'; saltar.className = 'btn small'; saltar.textContent = 'Cerrar';
    const sig = document.createElement('button');
    sig.type = 'button'; sig.className = 'btn primary'; sig.textContent = 'Siguiente';
    pie.append(saltar, atras, sig);

    const cerrar = (terminada) => {
      bg.remove();
      if (onFin) onFin({ paso: i, terminada });
      resolve(terminada);
    };

    const pintar = () => {
      const p = pasos[i];
      puntos.innerHTML = '';
      pasos.forEach((_, n) => {
        const d = document.createElement('span');
        d.className = 'ob-punto' + (n === i ? ' activo' : (n < i ? ' hecho' : ''));
        puntos.appendChild(d);
      });

      cuerpo.innerHTML =
        '<div class="ob-paso">Paso ' + (i + 1) + ' de ' + pasos.length + '</div>'
        + '<h2 class="ob-titulo">' + esc(p.titulo) + '</h2>'
        + '<div class="ob-texto">' + p.cuerpo + '</div>';

      if (p.campos) {
        const form = document.createElement('div');
        form.className = 'ob-form';
        for (const c of p.campos) {
          const lab = document.createElement('label');
          lab.className = 'ob-campo';
          const et = document.createElement('span');
          et.textContent = c.etiqueta;
          const inp = document.createElement('input');
          inp.type = 'text';
          inp.id = 'ob-' + c.clave;
          inp.value = c.valor || '';
          inp.placeholder = c.placeholder || '';
          inp.maxLength = c.maxLength || 80;
          lab.append(et, inp);
          if (c.nota) {
            const n = document.createElement('small');
            n.textContent = c.nota;
            lab.appendChild(n);
          }
          form.appendChild(lab);
        }
        cuerpo.appendChild(form);
      }

      if (p.accion) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn small ob-ir';
        b.textContent = p.accion.texto;
        b.addEventListener('click', () => { cerrar(false); p.accion.hacer(); });
        cuerpo.appendChild(b);
      }

      atras.hidden = (i === 0);
      sig.textContent = (i === pasos.length - 1) ? textoFin : 'Siguiente';
      if (onPaso) onPaso(i);
    };

    atras.addEventListener('click', () => { i--; pintar(); });
    saltar.addEventListener('click', () => cerrar(false));
    sig.addEventListener('click', async () => {
      const p = pasos[i];
      if (p.antesDeSeguir) {
        sig.disabled = true;
        try { await p.antesDeSeguir(); }
        catch (err) { toast(err.message); sig.disabled = false; return; }
        sig.disabled = false;
      }
      if (i === pasos.length - 1) { cerrar(true); return; }
      i++; pintar();
    });

    caja.append(puntos, cuerpo, pie);
    bg.appendChild(caja);
    document.body.appendChild(bg);
    pintar();
  });
}

/* ===================================================================
   Guía del gestor
   =================================================================== */

export async function guiaGestor(irA) {
  const leg = datosLegales();
  const estado = estadoGuiaGestor();

  const pasos = [
    {
      titulo: 'Bienvenido a StaffPoint',
      cuerpo:
        '<p>En unos minutos tendrás tu negocio listo. Esta guía te enseña dónde '
        + 'está cada cosa; puedes cerrarla cuando quieras y retomarla desde '
        + '<b>Ajustes</b>.</p>'
        + '<p>Lo que vas a configurar: los datos de tu empresa, los puestos de '
        + 'trabajo, los días de tu semana y tu equipo.</p>',
    },
    {
      titulo: 'Los datos de tu empresa',
      cuerpo:
        '<p>La razón social y el CIF salen en el <b>registro de jornada</b>, el '
        + 'documento que hay que entregar si viene una inspección. Rellénalos '
        + 'ahora y te olvidas.</p>',
      campos: [
        { clave: 'razon', etiqueta: 'Razón social', valor: leg.razon_social || '',
          placeholder: 'Melper 2001 S.L.' },
        { clave: 'cif', etiqueta: 'CIF', valor: leg.cif || '', maxLength: 20,
          placeholder: 'B12345678',
          nota: 'Puedes dejarlo en blanco y ponerlo luego en Ajustes.' },
      ],
      antesDeSeguir: async () => {
        const razon = ($('ob-razon') || {}).value || '';
        const cif = ($('ob-cif') || {}).value || '';
        if (!razon.trim() && !cif.trim()) return;      // saltárselo es válido
        await guardarDatosLegales({ razon_social: razon.trim(), cif: cif.trim() });
      },
    },
    {
      titulo: 'Tus puestos de trabajo',
      cuerpo:
        '<p>Son las filas de tu cuadrante: camareros, cocina, barra, lo que '
        + 'uses tú. Vienen unos de ejemplo que puedes cambiar o borrar.</p>'
        + '<p>Están en <b>Ajustes → Cuadrante y publicación</b>.</p>',
      accion: { texto: 'Ir a Puestos', hacer: () => irA('ajustes') },
    },
    {
      titulo: 'Los días de tu semana',
      cuerpo:
        '<p>Las columnas del cuadrante. Si abres solo de jueves a domingo, '
        + 'quita el resto y no te estorban.</p>'
        + '<p>Puedes añadir <b>columnas de noche</b> para los turnos que cruzan '
        + 'las doce, y ponerle a cada una su horario con el botón 🕒. Ese '
        + 'horario es el que luego usa el fichaje para saber si alguien llega '
        + 'tarde.</p>',
      accion: { texto: 'Ir a Días y columnas', hacer: () => irA('ajustes') },
    },
    {
      titulo: 'Tu equipo',
      cuerpo:
        '<p>Añade a tu gente en <b>Equipo</b>. De cada persona te hará falta el '
        + 'nombre corto para el cuadrante, y si vas a usar el registro de '
        + 'jornada, también su nombre completo y su NIF.</p>'
        + '<p>Con el botón <b>🔑 Acceso</b> generas un código para que se cree '
        + 'su cuenta y vea sus turnos desde el móvil.</p>',
      accion: { texto: 'Ir a Equipo', hacer: () => irA('equipo') },
    },
    {
      titulo: 'Ya está',
      cuerpo:
        '<p>Con eso puedes crear tu primer cuadrante desde la pestaña '
        + '<b>Cuadrante</b>: arrastras a cada persona a su día y puesto, y lo '
        + 'publicas cuando esté listo.</p>'
        + '<p>Si te pierdes, esta guía sigue en <b>Ajustes</b>.</p>',
    },
  ];

  await abrirGuia(pasos, {
    inicio: Number(estado.paso) || 0,
    textoFin: 'Terminar',
    onFin: async ({ paso, terminada }) => {
      try {
        await guardarGuiaGestor({
          hecha: terminada || !!estado.hecha,
          paso: terminada ? 0 : paso,
          fecha: new Date().toISOString().slice(0, 10),
        });
      } catch (_) { /* no vale la pena molestar por esto */ }
      if (terminada) toast('Guía terminada. La tienes en Ajustes.');
    },
  });
}

/* ===================================================================
   Guía del empleado
   =================================================================== */

export async function guiaEmpleado(conFichaje) {
  const pasos = [
    {
      titulo: 'Bienvenido a StaffPoint',
      cuerpo:
        '<p>Aquí verás tus turnos, pedirás vacaciones y '
        + (conFichaje ? 'ficharás tu jornada. ' : 'hablarás con tu responsable. ')
        + 'Son dos minutos y te ahorras preguntar.</p>',
    },
    {
      titulo: 'Hoy',
      cuerpo:
        '<p>Es la primera pantalla: qué te toca hoy, a qué hora, y los avisos '
        + 'que haya publicado tu responsable.</p>',
    },
    {
      titulo: 'Mis turnos y Cuadrantes',
      cuerpo:
        '<p>En <b>Mis turnos</b> tienes los tuyos próximos y tus vacaciones.</p>'
        + '<p>En <b>Cuadrantes</b> ves la semana entera del equipo, para saber '
        + 'con quién coincides.</p>',
    },
    {
      titulo: 'Solicitudes',
      cuerpo:
        '<p>Desde aquí pides <b>vacaciones</b> o un <b>cambio de turno</b>, y '
        + 'ves si te lo han aprobado. No hace falta que se lo digas a nadie por '
        + 'mensaje: queda registrado.</p>',
    },
  ];

  if (conFichaje) {
    pasos.push({
      titulo: 'Fichar',
      cuerpo:
        '<p>Fichas la entrada y la salida desde el botón grande, o con tu PIN en '
        + 'la tablet del local.</p>'
        + '<p>En <b>Mi registro</b> tienes todas tus horas por día, semana y mes. '
        + '<b>Si algo está mal, puedes proponer una corrección</b> y tu '
        + 'responsable la aprueba: es tu registro de jornada y tienes derecho a '
        + 'que sea correcto.</p>',
    });
    pasos.push({
      titulo: 'Tu PIN',
      cuerpo:
        '<p>Para fichar en la tablet necesitas un PIN de 4 a 6 cifras. Lo eliges '
        + 'tú en <b>Ajustes</b> y no lo sabe nadie más.</p>'
        + '<p>Si se te olvida, tu responsable puede reiniciarlo y eliges otro.</p>',
    });
  }

  pasos.push({
    titulo: 'Los avisos',
    cuerpo:
      '<p>Activa las notificaciones en <b>Ajustes</b> y te llegarán al móvil los '
      + 'cuadrantes nuevos, las respuestas a tus solicitudes'
      + (conFichaje ? ' y los recordatorios de fichar' : '') + '.</p>'
      + '<p>En iPhone, primero añade la app a la pantalla de inicio.</p>',
  });

  await abrirGuia(pasos, {
    textoFin: 'Entendido',
    onFin: async () => {
      try { await marcarGuiaEmpleado(); } catch (_) {}
    },
  });
}
