// Diálogo para que el empleado proponga una corrección de su registro.
//
// Dos puntos de entrada, un solo diálogo:
//  · Desde el árbol de Mi registro, con un día que ya tiene fichajes.
//  · Desde el botón general, para un día sin ningún fichaje: ese día no sale
//    en el árbol —se construye a partir de los fichajes—, así que necesita
//    su propia puerta y propone la jornada entera de una vez.
import { crearCorreccion } from '../data/solicitudes.js';
import { zonaNegocio } from '../data/fichaje.js';
import { toast } from './toast.js';

/* La zona sale de la config del negocio, no de una constante: ver
   zonaNegocio() en data/fichaje.js. Es función y no valor porque el
   módulo se carga antes de que haya negocio en sesión. */
const TZ = () => zonaNegocio();

function hhmm(iso) {
  return new Date(iso).toLocaleTimeString('es-ES',
    { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ() });
}
function hora(iso) {
  return new Date(iso).toLocaleTimeString('es-ES',
    { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: TZ() });
}
function fmtDia(iso) {
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-ES',
    { weekday: 'long', day: 'numeric', month: 'long' });
}
function hoyIso() {
  return new Date().toLocaleDateString('en-CA', { timeZone: TZ() });
}
/* Valor para un <input type="datetime-local"> a partir de un fichaje */
function valorLocal(iso) {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ() }) + 'T' + hhmm(iso);
}

/* Campo con etiqueta, reutilizado en todo el diálogo */
function campo(etiqueta, input, nota) {
  const lab = document.createElement('label');
  lab.className = 'modal-campo';
  const et = document.createElement('span');
  et.className = 'modal-et';
  et.textContent = etiqueta;
  lab.append(et, input);
  if (nota) {
    const n = document.createElement('span');
    n.className = 'modal-nota';
    n.textContent = nota;
    lab.appendChild(n);
  }
  return lab;
}
function inputFechaHora(valor) {
  const i = document.createElement('input');
  i.type = 'datetime-local';
  i.className = 'modal-input';
  if (valor) i.value = valor;
  return i;
}

/* dia = 'YYYY-MM-DD' con sus items, o null para "falta un día entero".
   Devuelve true si se envió la corrección. */
export function pedirCorreccion(dia, items = []) {
  return new Promise((resolve) => {
    const diaEntero = (dia === null);

    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    const caja = document.createElement('div');
    caja.className = 'modal modal-form modal-correccion';

    const h = document.createElement('p');
    h.className = 'modal-msg';
    h.textContent = diaEntero ? 'Falta un día entero' : ('Corregir el ' + fmtDia(dia));
    caja.appendChild(h);

    const motivo = document.createElement('textarea');
    motivo.className = 'modal-input';
    motivo.rows = 2;
    motivo.maxLength = 300;

    /* ============ Caso A: día entero sin fichar ============ */
    if (diaEntero) {
      const fecha = document.createElement('input');
      fecha.type = 'date';
      fecha.className = 'modal-input';
      fecha.max = hoyIso();
      caja.appendChild(campo('Día que falta', fecha));

      const entrada = inputFechaHora('');
      const salida = inputFechaHora('');
      caja.appendChild(campo('Entrada', entrada));
      caja.appendChild(campo('Salida', salida,
        'Si acabaste de madrugada, la fecha de la salida es la del día siguiente.'));

      // Al elegir el día se pre-rellenan las dos horas con esa fecha
      fecha.addEventListener('change', () => {
        if (!fecha.value) return;
        if (!entrada.value) entrada.value = fecha.value + 'T09:00';
        if (!salida.value) salida.value = fecha.value + 'T17:00';
      });

      motivo.placeholder = 'Ej.: ese día el kiosco estaba apagado y no pude fichar.';
      caja.appendChild(campo('Motivo', motivo));
      cerrarCaja(() => {
        if (!fecha.value) { toast('Elige el día que falta'); return null; }
        if (!entrada.value || !salida.value) { toast('Indica la entrada y la salida'); return null; }
        return {
          dia: fecha.value, accion: 'jornada', tipo: null,
          momentoLocal: entrada.value, momentoFinLocal: salida.value,
          motivo: motivo.value.trim(), entryId: null,
        };
      });
      return;
    }

    /* ============ Caso B: un día que ya está en el árbol ============ */
    const opciones = items.map((f) => ({
      valor: f.id,
      etiqueta: (f.tipo === 'entrada' ? '▶ Entrada' : '⏹ Salida') + ' · ' + hora(f.momento),
      fichaje: f,
    }));
    opciones.push({ valor: 'falta', etiqueta: '＋ Falta un fichaje', fichaje: null });

    let elegido = opciones[0];
    let accion = elegido.fichaje ? 'editar' : 'anadir';
    let tipoFalta = 'salida';

    const lista = document.createElement('div');
    lista.className = 'corr-opciones';
    for (const o of opciones) {
      const lab = document.createElement('label');
      lab.className = 'check corr-opcion';
      const r = document.createElement('input');
      r.type = 'radio'; r.name = 'corr-que'; r.value = o.valor;
      r.checked = (o === elegido);
      r.addEventListener('change', () => {
        elegido = o;
        accion = o.fichaje ? 'editar' : 'anadir';
        pintarPanel();
      });
      const t = document.createElement('span');
      t.textContent = o.etiqueta;
      lab.append(r, t);
      lista.appendChild(lab);
    }
    caja.appendChild(lista);

    const panel = document.createElement('div');
    panel.className = 'corr-panel';
    caja.appendChild(panel);

    let inpHora = null;

    function grupoRadios(nombre, pares, activo, alCambiar) {
      const g = document.createElement('div');
      g.className = 'corr-tipos';
      for (const [valor, texto] of pares) {
        const lab = document.createElement('label');
        lab.className = 'check';
        const r = document.createElement('input');
        r.type = 'radio'; r.name = nombre; r.value = valor;
        r.checked = (valor === activo);
        r.addEventListener('change', () => alCambiar(valor));
        const s = document.createElement('span');
        s.textContent = texto;
        lab.append(r, s);
        g.appendChild(lab);
      }
      return g;
    }

    function pintarPanel() {
      panel.innerHTML = '';
      inpHora = null;

      if (elegido.fichaje) {
        panel.appendChild(grupoRadios('corr-accion', [
          ['editar', 'La hora está mal'],
          ['borrar', 'Este fichaje sobra'],
        ], accion, (v) => { accion = v; pintarPanel(); }));
      } else {
        panel.appendChild(grupoRadios('corr-tipo', [
          ['entrada', 'Falta la entrada'],
          ['salida', 'Falta la salida'],
        ], tipoFalta, (v) => { tipoFalta = v; }));
      }

      if (accion !== 'borrar') {
        inpHora = inputFechaHora(elegido.fichaje ? valorLocal(elegido.fichaje.momento) : '');
        panel.appendChild(campo(
          accion === 'anadir' ? 'Hora que debería constar' : 'Hora correcta',
          inpHora,
          'Si es de madrugada, comprueba que la fecha es la del día siguiente.'));
      }
    }
    pintarPanel();

    motivo.placeholder = 'Ej.: me fui a las 23:15 y olvidé fichar la salida.';
    caja.appendChild(campo('Motivo', motivo));

    cerrarCaja(() => {
      if (accion !== 'borrar' && (!inpHora || !inpHora.value)) { toast('Indica la hora'); return null; }
      return {
        dia,
        accion,
        tipo: (accion === 'anadir') ? tipoFalta : (elegido.fichaje ? elegido.fichaje.tipo : null),
        momentoLocal: (accion === 'borrar') ? null : inpHora.value,
        momentoFinLocal: null,
        motivo: motivo.value.trim(),
        entryId: elegido.fichaje ? elegido.fichaje.id : null,
      };
    });

    /* ---------- pie común: aviso, botones y envío ---------- */
    function cerrarCaja(recoger) {
      const aviso = document.createElement('p');
      aviso.className = 'modal-nota';
      aviso.textContent = 'Tu responsable tiene que aprobarla. El cambio queda registrado '
        + 'junto a tu petición y el motivo.';
      caja.appendChild(aviso);

      const fila = document.createElement('div');
      fila.className = 'row';
      const btnNo = document.createElement('button');
      btnNo.type = 'button'; btnNo.className = 'btn'; btnNo.textContent = 'Cancelar';
      const btnOk = document.createElement('button');
      btnOk.type = 'button'; btnOk.className = 'btn primary'; btnOk.textContent = 'Enviar';

      function cerrar(v) { document.removeEventListener('keydown', pt); bg.remove(); resolve(v); }
      function pt(e) { if (e.key === 'Escape') cerrar(false); }
      btnNo.addEventListener('click', () => cerrar(false));
      bg.addEventListener('click', (e) => { if (e.target === bg) cerrar(false); });
      document.addEventListener('keydown', pt);

      btnOk.addEventListener('click', async () => {
        if (!motivo.value.trim()) { toast('Explica el motivo de la corrección'); motivo.focus(); return; }
        const datos = recoger();
        if (!datos) return;

        btnOk.disabled = true; btnOk.textContent = 'Enviando…';
        try {
          await crearCorreccion(datos);
          toast('Corrección enviada. Tu responsable la revisará.');
          cerrar(true);
        } catch (err) {
          toast(err.message);
          btnOk.disabled = false; btnOk.textContent = 'Enviar';
        }
      });

      fila.append(btnNo, btnOk);
      caja.appendChild(fila);
      bg.appendChild(caja);
      document.body.appendChild(bg);
    }
  });
}
