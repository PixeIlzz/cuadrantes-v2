// Diálogo de confirmación propio de la app (estilo modal v1).
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
    btnNo.type = 'button'; btnNo.className = 'btn'; btnNo.textContent = textoNo;
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

/* Selector de una opción en un modal propio.
   opciones: [{valor, etiqueta, nota}]  → resuelve con el valor elegido o null. */
export function elegirOpcion(titulo, opciones) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    const caja = document.createElement('div');
    caja.className = 'modal modal-lista';

    const h = document.createElement('p');
    h.className = 'modal-msg';
    h.textContent = titulo;
    caja.appendChild(h);

    const lista = document.createElement('div');
    lista.className = 'opt-list';
    for (const o of opciones) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt';
      b.innerHTML = '<span class="opt-main"></span>' +
        (o.nota ? '<span class="opt-note"></span>' : '');
      b.querySelector('.opt-main').textContent = o.etiqueta;
      if (o.nota) b.querySelector('.opt-note').textContent = o.nota;
      b.addEventListener('click', () => cerrar(o.valor));
      lista.appendChild(b);
    }
    caja.appendChild(lista);

    const fila = document.createElement('div');
    fila.className = 'row';
    const btnNo = document.createElement('button');
    btnNo.type = 'button'; btnNo.className = 'btn'; btnNo.textContent = 'Cancelar';
    btnNo.addEventListener('click', () => cerrar(null));
    fila.appendChild(btnNo);
    caja.appendChild(fila);

    function cerrar(v) {
      document.removeEventListener('keydown', porTeclado);
      bg.remove();
      resolve(v);
    }
    function porTeclado(e) { if (e.key === 'Escape') cerrar(null); }
    bg.addEventListener('click', (e) => { if (e.target === bg) cerrar(null); });
    document.addEventListener('keydown', porTeclado);

    bg.appendChild(caja);
    document.body.appendChild(bg);
  });
}
