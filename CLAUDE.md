# StaffPoint v2 — Estado del proyecto

> Documento vivo. Se carga automáticamente en cada sesión de Claude Code.
> **Actualizar al cerrar cada tanda de trabajo**: versiones, migración SQL, módulos
> tocados y la lista de pendientes.

**Última actualización:** 2026-08-19 · v73 · migración SQL 39

---

## 1. Qué es

PWA multi-tenant de **gestión de turnos y fichaje para hostelería**.

Desarrollo en solitario (Fran, dueño del Asadero Las Brasas, Gran Canaria): la misma
persona despliega, prueba y da soporte.

**La app está en producción y en uso real por la plantilla.** Consecuencia directa
sobre cómo se trabaja:

- Toda función nueva nace detrás del flag `soy_probador()` y solo se abre al resto
  cuando está validada en uso real.
- Ningún cambio puede romper lo que ya funciona. Ante la duda, se aísla.

---

## 2. Stack

| Capa | Tecnología |
|---|---|
| Frontend | JavaScript vanilla, módulos ES nativos. **Sin framework ni build.** |
| Backend | Supabase (Frankfurt): Postgres + RLS, Edge Functions, Realtime, pg_cron, pgcrypto |
| Hosting | GitHub Pages (repo `cuadrantes-v2`) → `staffpoint.app` vía Cloudflare/Porkbun |
| Email | Resend |
| Push | Edge Function propia con VAPID |
| PWA | Service worker red-primero, con `VERSION` en `sw.js` |

---

## 3. Estructura

```
index.html          Toda la interfaz (secciones ocultas por pestaña)
app.css             Estilos — ver aviso de la CAPA FINAL más abajo
sw.js               Service worker. VERSION + lista de archivos cacheados
manifest.json       Instalación PWA
icon-*.png          Iconos

js/app.js           Arranque, enrutado por pestañas, wiring general
js/auth.js          Sesión y ctx (business, role, workerId, esProbador)
js/supabase.js      Cliente Supabase
js/pwa.js           Registro del SW, aviso de versión nueva, versionSW()
js/version.js       APP_VERSION — fuente única de la versión

js/data/*.js        Acceso a datos — una función por operación
js/ui/*.js          Interfaz por módulo

edge/enviar-push/   Edge Function de push (VAPID)
sql/                Migraciones numeradas. Ver aviso abajo: las 1–32 NO
                    están aquí, solo viven en Supabase.
```

### Regla de separación (estricta)

- `js/data/` **no toca el DOM**.
- `js/ui/` **no hace consultas directas** a Supabase: llama a `data/`.

### Módulos actuales

`data/`: `avisos`, `empleado`, `equipo`, `fichaje`, `invitaciones`, `kiosco`,
`migracion`, `notificaciones`, `semanas`, `solicitudes`, `tareas`

`ui/`: `ajustes`, `ajustes-empleado`, `avisos`, `confirmar`, `correccion`, `cuadrante`,
`empleado`, `equipo`, `exportar`, `fichaje`, `hoy`, `kiosco`, `mi-registro`, `migracion`,
`notificaciones`, `privacidad`, `programadas`, `push`, `push-bienvenida`,
`registro-arbol`, `solicitudes`, `tareas`, `tema`, `toast`, `version`

---

## 4. Modelo de datos (Supabase)

| Tabla | Contenido |
|---|---|
| `businesses` | Negocio. `config` (jsonb): `roles` (puestos), `days` (columnas del cuadrante: `id`, `label`, `night`, y opcionalmente `desde`/`hasta`), `fichaje` (margen, avisos, tz), `legal` (razón social, CIF) |
| `workers` | Trabajadores. `profile_id` puede ser null (gente que ficha sin app). `pin_hash`, `active`, `sort_order`. **Dos nombres:** `name` es el corto del cuadrante ("Fran") y `full_name` el legal del contrato, que es el que sale en el PDF y el CSV. Más `nif` y `nss` (nº Seguridad Social) |
| `weeks` + `assignments` | Cuadrante. Las semanas publicadas congelan `config_snapshot`. Asignaciones = día × puesto → trabajador, con `is_all` para turnos de toda la plantilla |
| `vacations` | Periodos de vacaciones por trabajador |
| `time_entries` | Fichajes: `tipo` (entrada/salida), `momento` (lo pone el servidor), `origen` (empleado/auto/gestor/kiosco), `estimado`, `ip`, `kiosco_id` |
| `time_entry_audit` | Auditoría automática por trigger de todo cambio en fichajes |
| `kioscos` | Tablets emparejadas: `device_token`, `ips_permitidas` |
| `notifications` + `notification_prefs` | Avisos. Insertar una notificación dispara el push por trigger |

Migraciones SQL numeradas secuencialmente.

> **El esquema ya está versionado** (2026-08-18). `sql/000_baseline/` contiene el
> estado real volcado de Supabase —tablas, restricciones, funciones, triggers, RLS
> y cron—, y levanta el esquema desde cero en un proyecto nuevo. Encima se aplica
> `sql/033…` en adelante. Dos salvedades anotadas en su README: el trigger sobre
> `auth.users` no se pudo volcar (el volcado cubría solo `public`) y los permisos
> de las funciones están reconstruidos, no volcados.
>
> El historial con los comentarios de diseño originales, rescatado de los snippets
> del SQL Editor, está en `sql/historico/`. **Es historial, no estado actual: no
> ejecutarlo.**

**`id` sin cualificar en funciones `RETURNS TABLE`.** Si la función declara una
columna de salida `id`, cualquier `id` sin alias dentro del cuerpo es ambiguo y la
función aborta entera (error 42702), incluso en la primera sentencia y antes de
comprobar permisos. Pasó en `fichajes_por_jornada` (migración 33): parecía un problema
de rol porque otras pantallas seguían funcionando. **Cualificar siempre con alias de
tabla dentro de estas funciones.**

---

## 5. Módulos completados

### Cuadrante
Rejilla días × puestos con arrastrar y soltar. Puestos y columnas configurables,
columnas nocturnas. Publicación con programación horaria y visibilidad manual.
Snapshot de config por semana. Exportación a PNG e impresión. Tablón de avisos.
Tareas diarias.

### Equipo
Alta/baja de trabajadores, turnos por semana, vacaciones, invitaciones por código,
NIF por diálogo modal.

### Empleado
Su cuadrante, "hoy", mis turnos, próximos turnos, solicitudes (cambios, vacaciones),
notificaciones push configurables.

### Fichaje — el módulo más reciente, completo (en beta tras flag)

- **Kiosco sin GPS.** Una tablet del local se empareja mostrando un QR que el gestor
  escanea desde la app (cámara in-app con jsQR). Guarda un `device_token`; sin él no
  se puede fichar. Opcionalmente se restringe por IP. El empleado toca su nombre en
  una rejilla y mete su PIN (bcrypt, bloqueo de 5 min tras 5 fallos). La Edge Function
  `fichar-kiosco` (Verify JWT **desactivado**) valida token + PIN + IP y llama a la RPC.
- **Estado en vivo.** Contadores HH:MM:SS; verde si está trabajando, rojo si fichó
  tarde o excede horas. En kiosco, lista del gestor, detalle del empleado y vista del
  empleado.
- **Realtime** sobre `time_entries`: al fichar en el kiosco, las vistas se actualizan
  solas.
- **Horario por turno.** Cada columna del cuadrante lleva su horario (botón 🕒 en
  Ajustes → Días y columnas). `turno_previsto(negocio, worker, día)` resuelve el turno
  real de cada persona desde el cuadrante publicado, con respaldo al horario general
  del negocio. **Las vacaciones anulan el turno.**
- **Registro en árbol.** Año → Mes → Semana → Día, desplegable. Cada nivel muestra
  horas totales, saldo (vs. previsto) y retraso acumulado. Gestor: botones PDF y CSV
  en cada nivel. Empleado: solo visual.
  Se carga con **una sola petición**: `registro_arbol()` (migración 38) devuelve,
  por día laboral, sus fichajes y su turno previsto ya resuelto. Antes lanzaba una
  RPC `turno_previsto` por cada día con fichajes. Las horas, el saldo y el retraso
  se siguen calculando en el navegador a propósito: son las cifras del PDF legal y
  no interesa tener dos implementaciones que puedan divergir.
- **Exportación legal.** PDF imprimible y CSV con razón social, CIF, nombre legal,
  NIF, nº de Seguridad Social, entradas/salidas y totales. El PDF lleva bloques de
  empresa y trabajador, tabla agrupada por día (un `<tbody>` por día para que no se
  parta entre páginas) y espacio de firmas. La hoja de estilo está en `CSS_PDF`,
  dentro de `ui/registro-arbol.js`.
- **Avisos push.** Recordatorio de entrada no fichada (solo a quien tiene turno ese
  día y no está de vacaciones) y de salida no fichada. Umbrales configurables en
  horas/minutos/segundos. Cron cada 5 min.
- **Jornada nocturna.** `dia_laboral()` atribuye los fichajes de madrugada al día
  anterior si ese día tenía turno que cruza medianoche (viernes 20:00 → sábado 01:00
  cuenta como viernes).
- **Correcciones propuestas por el empleado** (migración 35). El trabajador propone
  desde *Mi registro* y el gestor aprueba o deniega en Solicitudes.
  - Cuatro acciones: cambiar la hora de un fichaje, añadir el que falta, borrar uno
    que sobra, o registrar la jornada entera de un día en el que no fichó nada.
  - **Dos puertas, un diálogo** (`ui/correccion.js`): botón por día en el árbol, y
    botón general "Falta un día entero" —porque el árbol se construye a partir de los
    fichajes y un día sin ninguno sencillamente no aparece.
  - Viaja por `requests` con `type='timefix'`, más `entry_id` y `fix` (jsonb).
  - **Siempre activas, al margen de `solicitudes_activas`.** Ese interruptor apaga
    vacaciones y cambios de turno, que son una comodidad; corregir el propio registro
    de jornada es un derecho del trabajador y no puede depender de una preferencia
    del gestor. Por eso van por RPC propia y no por `crearSolicitud`.
  - Ojo: hay un trigger `trg_bloquear_solicitud()` sobre `requests` que rechaza
    inserciones con el interruptor apagado. **Un trigger salta aunque la función sea
    `SECURITY DEFINER`**, así que la RPC no lo esquivaba; la migración 37 lo exime
    para `type = 'timefix'`. Si algún día se añaden más tipos exentos, es ahí.
  - **`solicitudes_activas` es asimétrico** (v71). Al apagarlo, al **empleado** se le
    oculta la pestaña Solicitudes entera —así no puede enviar vacaciones ni cambios—,
    pero al **gestor** le queda siempre visible: le siguen llegando correcciones de
    fichaje y sin la pestaña tendría una cola invisible de peticiones que está obligado
    a atender. Con un aviso que se lo explica.
  - Como el empleado puede quedarse sin esa pestaña, **el estado de sus correcciones
    vive en «Mi registro»** (panel «Mis correcciones»): pendientes con botón de retirar,
    y las 3 últimas resueltas con la respuesta del gestor. Esa pantalla no depende del
    interruptor.
  - **Aisladas en `resolve_timefix`**: `resolve_request` (vacaciones) no se toca.
  - Trazabilidad: al aprobar, el fichaje se escribe con `origen: 'gestor'` **y**
    `time_entries.request_id` apuntando a la solicitud, así `time_entry_audit` recoge
    por trigger quién pidió el cambio y por qué, sin tocar el trigger.
  - La hora viaja como texto `'YYYY-MM-DDTHH:MM'` y la interpreta el servidor en la
    zona del negocio. Nunca se manda un instante calculado en el navegador.
  - **Avisos** (migración 36): al proponer se notifica a los gestores con el tipo
    `request_new`; al resolver, al trabajador con `request_resolved`. El aviso del
    empleado enlaza a `emp-fichaje` (Mi registro), **no** a `emp-solicitudes`, porque
    esa pestaña puede estar oculta. Los dos `insert` van dentro de un `begin/exception`
    que se traga el error: un fallo de notificación no puede tumbar una corrección ya
    guardada.

---

## 6. Decisiones y aprendizajes (no repetir errores)

**Zona horaria.** Todo cálculo de fechas se hace en `Atlantic/Canary` **en el
servidor**. Comparar cadenas en UTC provocó un bug real de medianoche.

**`toISOString()` nunca para sacar "hoy".** Devuelve UTC, así que entre las 00:00
y la 01:00 (horario de verano canario) da la fecha de ayer. Volvió a morder en
v73: el árbol del registro pedía el rango `hasta = hoy.toISOString()` y los
fichajes de esa madrugada se caían fuera —desaparecía la semana entera—. Para una
fecha del calendario, `diaDe()` de [data/fichaje.js](js/data/fichaje.js), que
resuelve en la zona del negocio. `toISOString()` solo vale para instantes
completos que van a la base de datos. Quedan dos casos iguales sin arreglar, en
[data/avisos.js:15](js/data/avisos.js:15) y [ui/avisos.js:86](js/ui/avisos.js:86):
un aviso caducado se ve una hora de más.

**RPC de Postgres.** Devolver los errores **como datos JSONB**, nunca con
`raise exception`: la excepción revierte la transacción y se pierden efectos que
deben persistir, como el contador de intentos de PIN.

**Cambiar el tipo de retorno de una función** exige `DROP FUNCTION` antes;
`CREATE OR REPLACE` falla.

**Toda función nueva nace abierta a internet.** Postgres concede EXECUTE a
`public` por defecto, y encima Supabase deja unos DEFAULT PRIVILEGES que la
conceden también a `anon` y `authenticated`. Como aquí casi todo es
`SECURITY DEFINER`, una función sin `revoke` explícito es una puerta abierta con
permisos de propietario. Pasó con todo el esquema hasta la migración 41. **Regla:
toda migración que cree una función termina con su `revoke` y su `grant`.** Y si
una función interna necesita exponerse al cliente, no se le mete el control
dentro —la llaman otras funciones sin `auth.uid()`, como el cron o el kiosco—:
se le pone un envoltorio delante, como `mi_turno_previsto()` sobre
`turno_previsto()`.

**Tramos que cruzan medianoche.** `hasta - desde` da negativo: hay que sumar 1440
minutos.

**CSS.** `app.css` termina en una **CAPA FINAL autoritativa de layout**. No añadir
capas nuevas encima — hay que **editar esa capa**. Acumular bloques al final ya
provocó que reglas se pisaran y componentes enteros se vieran rotos.

**Despliegue en GitHub.** Arrastrar y soltar **no reemplaza subcarpetas**: hay que
borrar `js/` entera y subir la nueva, o quedan archivos viejos mezclados (causa
habitual de errores de "export no encontrado").

**Versión única.** `APP_VERSION` en `js/version.js` y `VERSION` en `sw.js` son **el
mismo número** y se suben **juntos**. Se pintan en la cabecera (chip junto al nombre
del negocio) y al pie de ambos Ajustes. Si divergen, el pie avisa: significa que el
navegador sirve código cacheado. `pwa.js → versionSW()` pregunta la versión al SW por
`MessageChannel`; `sw.js` responde al mensaje `'VERSION'`.

**Checklist de despliegue:**
1. Subir el número en **`js/version.js`** y en **`sw.js`** (el mismo).
2. Añadir a `sw.js` los archivos JS nuevos.
3. Borrar `js/` en GitHub y subir la carpeta completa.

**Fiscalidad.** El registro de jornada es obligatorio en España: conservación 4 años
y entrega a inspección. Hay pendiente una reforma que exigirá formato digital con
inmutabilidad y trazabilidad — de ahí `time_entry_audit`.

---

## 7. Estado actual

| Elemento | Versión |
|---|---|
| App (`js/version.js` → `APP_VERSION`) | v74 |
| Service worker (`sw.js` → `VERSION`) | v74 |
| Migración SQL | 41 (la 40 y la 41 escritas, **sin ejecutar**) |
| Baseline del esquema | `sql/000_baseline/` (volcado 2026-08-18) |

Todo el módulo de fichaje está tras `soy_probador()` mientras se prueba en real.

### Dónde nos quedamos (2026-08-19, 00:45)

**Todo commiteado y subido**: `origin/main` en `eb2e8e2 fix v73`. Como GitHub
Pages sirve el repo, la v73 ya está en producción.

Hecho y probado en real:

- Migraciones **38** (`registro_arbol`) y **39** (secreto del push) aplicadas en
  Supabase.
- **Push rotado y funcionando.** `PUSH_SECRET` creado, Edge Function desplegada
  con validación de cabecera, `app_config` relleno. El endpoint ya no está
  abierto a cualquiera.
- El árbol del registro carga con **una sola petición** y se ve bien.

Escrito pero **sin ejecutar ni desplegar** (v74 en los archivos, v73 en producción):

- **Migración 40**, cierre automático de jornada. Nace apagada; hay que
  activarla por negocio a mano tras revisar qué jornadas hay abiertas.
- **Migración 41**, permisos. Va **junto con la v74**: la app ya llama a
  `mi_turno_previsto()`, que crea esa migración. Si se sube la v74 sin ejecutar
  la 41, *Mi registro* no encuentra la función; si se ejecuta la 41 sin subir la
  v74, el cliente sigue llamando a `turno_previsto` y recibe permission denied.
  **Las dos cosas a la vez.**

Lo primero al retomar:

- **Comprobar el arreglo de fechas de la v73.** Está desplegado pero sin
  verificar. El síntoma era que desaparecía la semana del 17 de agosto: el rango
  se pedía con `toISOString()` (UTC) y los fichajes de madrugada se caían fuera.
  Ahora usa `diaDe()`. **Solo se reproduce entre las 00:00 y la 01:00** en
  horario de verano canario; fuera de esa franja no se distingue si está bien.
  La otra mitad —la cabecera de semana, que pintaba "Semana 10/08 – 10/08" en vez
  de la semana natural— se ve a cualquier hora.
- El PDF y el CSV con datos reales (pendiente 1), que siguen sin ejecutarse nunca.

> En v68 se unificaron las dos versiones (la app iba por v67 y el SW por v50) en un
> único número visible en pantalla. Antes la versión de app no constaba en ningún
> archivo del repo.

---

## 8. Pendiente

1. **Validar la exportación legal con datos reales** — el árbol del registro estuvo
   roto hasta la migración 33, así que el PDF y el CSV **nunca se han ejecutado con
   datos de verdad**. Es el documento que hay que entregar a inspección: comprobar
   razón social, CIF, NIF, entradas/salidas y totales antes de nada.
2. **Sacar el fichaje de beta** — quitar el flag de probador y activarlo para toda la
   plantilla, una vez validada la exportación legal (punto 1) y probadas en real las
   correcciones (apartado 5).
3. **Activar el cierre automático de jornada** — la migración 40 ya está escrita
   ([040_cierre_automatico.sql](sql/040_cierre_automatico.sql)) pero **nace
   apagada**: escribe en un registro legal y es opt-in por negocio. Cierra con
   el fin del turno de esa persona (`turno_previsto`), con respaldo a
   `entrada + cierre_max_h` si no hay turno, marcando `estimado` y `origen='auto'`
   y avisando al trabajador para que lo revise. Pasos: ejecutar la migración,
   mirar con la consulta del PASO 3 qué jornadas están abiertas ahora, limpiar
   la basura vieja a mano si la hay, y solo entonces activarlo.
   Hasta que se active sigue el problema de fondo: `fichar_worker` coge el
   último fichaje **sin filtrar por día**, así que quien olvida la salida del
   viernes convierte su entrada del sábado en la salida del viernes. Bloquea
   de hecho el punto 1.
4. **Ejecutar la migración 41 (permisos)** — revisado el 2026-08-19 con
   [sql/tools/revisar_permisos.sql](sql/tools/revisar_permisos.sql): **casi todas
   las funciones tenían `=X/postgres`**, es decir EXECUTE para PUBLIC, o sea
   invocables sin sesión. Y casi todas son `SECURITY DEFINER`. La peor,
   `avisar_gestores()`: sin control de quién llama, inserta una notificación con
   texto arbitrario en cualquier negocio, y eso dispara push real al gestor.
   [041_permisos_funciones.sql](sql/041_permisos_funciones.sql) cierra en bloque
   y reabre solo lo justo (kiosco e `invite_owner` para `anon`), y añade
   `mi_turno_previsto()` para que el cliente no pueda pedir el horario de un
   trabajador ajeno. **Escrita, sin ejecutar.** Va junto con la v74, que ya usa
   la función nueva.
5. **Multi-tenancy en `fichar()`** — lleva `'Atlantic/Canary'` escrito a fuego
   (el resto del módulo lee `config->'fichaje'->>'tz'`) y busca la ficha con
   `where w.profile_id = auth.uid() limit 1`, sin filtrar por negocio: quien
   tenga ficha en dos, ficha en uno arbitrario. En el cliente, lo mismo:
   [js/data/fichaje.js](js/data/fichaje.js) exporta `const TZ = 'Atlantic/Canary'`,
   así que el árbol, los totales y el PDF se pintan en hora canaria sea cual sea
   el negocio.
6. **Limpieza** — eliminar el respaldo de "horario general del negocio" cuando todas
   las semanas publicadas lleven horas por columna. Y retirar
   `fichajes_por_jornada()`, que desde la migración 38 ya no la usa nadie.
7. **Comandero** (futuro, arquitectura ya diseñada) — comandas desde el móvil del
   camarero, pantallas de cocina por estación (parrilla, cocina) y vista de caja no
   fiscal. Se mantiene como **herramienta interna**, emitiendo los tickets por el TPV
   existente, para no entrar en las obligaciones de VeriFactu (enero 2027 sociedades,
   julio 2027 autónomos).
8. **Comercial** — piloto gratuito con un negocio vecino antes de invertir en la
   migración multicliente.

---

## 9. Cómo trabajar en este repo

- Soluciones **limpias, escalables y mantenibles**. No parches.
- Decir claramente si algo está mal planteado y **proponer alternativa**.
- Avisar de riesgos de **arquitectura, rendimiento o multi-tenancy antes** de
  implementar, no a mitad.
- Directo, sin relleno.
- Al entregar código: decir **exactamente qué cambiar, qué borrar y qué añadir**, y
  **comprobar que las funciones importadas existen realmente** en su módulo de origen.
- Respetar la separación `data/` ↔ `ui/`.
- Mantener este archivo actualizado.
