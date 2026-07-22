// Diálogo de confirmación propio de la app (estilo modal v1).
// Uso:  if (await confirmar('¿Seguro que quieres cerrar la sesión?')) { ... }
// Devuelve una promesa que resuelve true (aceptar) o false (cancelar).
export function confirmar(mensaje, opciones = {}) {
  const { textoOk = 'Sí', textoNo = 'Cancelar', peligro = false } = opciones;

  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';

    const caja = document.createElement('div');
    caja.className = 'modal';

    const p = document.createElement('p');
    p.className = 'modal-msg';
    p.textContent = mensaje;

    const fila = document.createElement('div');
    fila.className = 'row';

    const btnNo = document.createElement('button');
    btnNo.type = 'button';
    btnNo.className = 'btn';
    btnNo.textContent = textoNo;

    const btnOk = document.createElement('button');
    btnOk.type = 'button';
    btnOk.className = 'btn ' + (peligro ? 'danger' : 'primary');
    btnOk.textContent = textoOk;

    function cerrar(valor) {
      document.removeEventListener('keydown', porTeclado);
      bg.remove();
      resolve(valor);
    }
    function porTeclado(e) {
      if (e.key === 'Escape') cerrar(false);
      if (e.key === 'Enter') cerrar(true);
    }

    btnNo.addEventListener('click', () => cerrar(false));
    btnOk.addEventListener('click', () => cerrar(true));
    bg.addEventListener('click', (e) => { if (e.target === bg) cerrar(false); });
    document.addEventListener('keydown', porTeclado);

    fila.append(btnNo, btnOk);
    caja.append(p, fila);
    bg.appendChild(caja);
    document.body.appendChild(bg);
    btnOk.focus();
  });
}
