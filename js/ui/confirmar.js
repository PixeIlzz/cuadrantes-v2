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

/* Diálogo con un campo de texto. Resuelve con el texto (trim) o null si cancela. */
export function pedirTexto(titulo, valorInicial = '', opciones = {}) {
  const {
    textoOk = 'Guardar', textoNo = 'Cancelar',
    placeholder = '', maxLength = 40, transformar = null,
  } = opciones;
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    const caja = document.createElement('div');
    caja.className = 'modal';
    const h = document.createElement('p');
    h.className = 'modal-msg';
    h.textContent = titulo;
    const input = document.createElement('input');
    input.type = 'text'; input.className = 'modal-input';
    input.value = valorInicial || ''; input.placeholder = placeholder; input.maxLength = maxLength;
    const fila = document.createElement('div');
    fila.className = 'row';
    const btnNo = document.createElement('button');
    btnNo.type = 'button'; btnNo.className = 'btn'; btnNo.textContent = textoNo;
    const btnOk = document.createElement('button');
    btnOk.type = 'button'; btnOk.className = 'btn primary'; btnOk.textContent = textoOk;

    const valor = () => { let v = (input.value || '').trim(); if (transformar) v = transformar(v); return v; };
    function cerrar(v) { document.removeEventListener('keydown', pt); bg.remove(); resolve(v); }
    function pt(e) { if (e.key === 'Escape') cerrar(null); if (e.key === 'Enter') cerrar(valor()); }
    btnNo.addEventListener('click', () => cerrar(null));
    btnOk.addEventListener('click', () => cerrar(valor()));
    bg.addEventListener('click', (e) => { if (e.target === bg) cerrar(null); });
    document.addEventListener('keydown', pt);

    fila.append(btnNo, btnOk);
    caja.append(h, input, fila);
    bg.appendChild(caja);
    document.body.appendChild(bg);
    setTimeout(() => input.focus(), 50);
  });
}

/* Diálogo con varios campos de texto.
   campos: [{clave, etiqueta, valor, placeholder, maxLength, transformar, nota}]
   Resuelve con un objeto {clave: valor} o null si cancela. */
export function pedirDatos(titulo, campos, opciones = {}) {
  const { textoOk = 'Guardar', textoNo = 'Cancelar', nota = '' } = opciones;
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    const caja = document.createElement('div');
    caja.className = 'modal modal-form';

    const h = document.createElement('p');
    h.className = 'modal-msg';
    h.textContent = titulo;
    caja.appendChild(h);

    const inputs = {};
    for (const c of campos) {
      const lab = document.createElement('label');
      lab.className = 'modal-campo';
      const et = document.createElement('span');
      et.className = 'modal-et';
      et.textContent = c.etiqueta;
      const inp = document.createElement('input');
      inp.type = 'text'; inp.className = 'modal-input';
      inp.value = c.valor || '';
      inp.placeholder = c.placeholder || '';
      inp.maxLength = c.maxLength || 40;
      inputs[c.clave] = { inp, transformar: c.transformar || null };
      lab.append(et, inp);
      if (c.nota) {
        const n = document.createElement('span');
        n.className = 'modal-nota';
        n.textContent = c.nota;
        lab.appendChild(n);
      }
      caja.appendChild(lab);
    }

    if (nota) {
      const n = document.createElement('p');
      n.className = 'modal-nota';
      n.textContent = nota;
      caja.appendChild(n);
    }

    const fila = document.createElement('div');
    fila.className = 'row';
    const btnNo = document.createElement('button');
    btnNo.type = 'button'; btnNo.className = 'btn'; btnNo.textContent = textoNo;
    const btnOk = document.createElement('button');
    btnOk.type = 'button'; btnOk.className = 'btn primary'; btnOk.textContent = textoOk;

    const valores = () => {
      const r = {};
      for (const k of Object.keys(inputs)) {
        let v = (inputs[k].inp.value || '').trim();
        if (inputs[k].transformar) v = inputs[k].transformar(v);
        r[k] = v;
      }
      return r;
    };
    function cerrar(v) { document.removeEventListener('keydown', pt); bg.remove(); resolve(v); }
    function pt(e) {
      if (e.key === 'Escape') cerrar(null);
      if (e.key === 'Enter') cerrar(valores());
    }
    btnNo.addEventListener('click', () => cerrar(null));
    btnOk.addEventListener('click', () => cerrar(valores()));
    bg.addEventListener('click', (e) => { if (e.target === bg) cerrar(null); });
    document.addEventListener('keydown', pt);

    fila.append(btnNo, btnOk);
    caja.appendChild(fila);
    bg.appendChild(caja);
    document.body.appendChild(bg);
    const primero = campos[0] && inputs[campos[0].clave];
    if (primero) setTimeout(() => primero.inp.focus(), 50);
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
