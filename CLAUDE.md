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

js/vendor/          Librerías de terceros alojadas aquí, NO por CDN.
                    Ver su README: supabase-js va en UMD por <script> porque su
                    build ESM se trae seis paquetes más de internet.

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
`notificaciones`, `plataforma`, `privacidad`, `programadas`, `push`, `push-bienvenida`,
`registro-arbol`, `solicitudes`, `tareas`, `tema`, `toast`, `version`

### Tres niveles de permiso, no dos

- `profiles.es_admin` — **dueño de la plataforma**. Emite códigos de alta, ve
  todas las empresas y las suspende. No le da acceso a los datos de nadie.
- `memberships.role = 'manager'` — dueño de **un** negocio.
- `memberships.role = 'employee'` — trabajador de un negocio.

El primero es nuevo (migración 45) y es lo que permite gestionar clientes sin
entrar a Supabase. Panel en Ajustes → Plataforma, oculto salvo para admins.

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

### Alta de negocios (v79)
Desde la pantalla de acceso: «¿Vas a dar de alta tu negocio?» → cuenta de
responsable → nombre del negocio **y código de alta** → dentro como gestor,
llamando a `create_business()`. Esa función existía desde la migración 1 pero
**no la llamaba nadie**: dar de alta un cliente exigía entrar al SQL Editor.
Quien inicia sesión y no tiene negocio ya no ve un error sin salida, sino esa
misma pantalla, con un atajo para canjear un código si en realidad era empleado.

**Los códigos de alta los emites tú** (migración 45), uno por cliente vendido:
`select public.crear_codigo_alta('Bar Manolo, Telde', 90);`. Sin código no se
puede crear un negocio, así que la app no se llena de altas que no has vendido.
Requiere `profiles.es_admin`, que es el dueño **de la plataforma** — un concepto
nuevo, distinto de `manager`, que es el dueño de un negocio. Un admin puede
crear negocios sin código.

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

**Zona horaria.** Todo cálculo de fechas se hace **en el servidor**, en la zona
del negocio (`config.fichaje.tz`). Comparar cadenas en UTC provocó un bug real de
medianoche. En el cliente, la zona sale de `zonaNegocio()`
([data/fichaje.js](js/data/fichaje.js)) — nunca de una constante — y en el kiosco,
que está deslogueado, la manda `kiosco_estado()`. `Atlantic/Canary` solo se usa
como respaldo cuando el negocio no la tiene configurada.

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
| App (`js/version.js` → `APP_VERSION`) | v80 |
| Service worker (`sw.js` → `VERSION`) | v80 |
| Migración SQL | 46 (**44, 45 y 46 pendientes**) |
| Baseline del esquema | `sql/000_baseline/` (volcado 2026-08-18) |

Todo el módulo de fichaje está tras `soy_probador()` mientras se prueba en real.

### Dónde nos quedamos (2026-08-19)

En producción y funcionando: **v75**, migraciones hasta la **41** ejecutadas.
Push rotado y con la Edge Function validando cabecera. Árbol del registro en una
sola petición. Cierre automático activado y en observación.

En producción: **v77**, migraciones hasta la **43**. Revisión de seguridad
aplicada (42 y 43) y **cero dependencias de CDN**: las cuatro librerías viven en
`js/vendor/` y se cachean en el service worker, así que la PWA ya arranca sin
conexión.

**Sin ejecutar ni desplegar: la migración 44 y la v78** — el fichaje por negocio
en vez de por persona. Van juntas y **no abren el fichaje a nadie nuevo**.

Lo primero al retomar:

- **El PDF y el CSV con datos reales** (pendiente 1). Sigue sin hacerse nunca, y
  ahora que el cierre automático lleva días funcionando el registro debería estar
  limpio por primera vez. Es lo que desbloquea todo lo demás.
- Ejecutar la **44** y desplegar la **v78**. Después, y solo después del PDF,
  encender el interruptor de Ajustes → Registro de jornada.
- **Probar el alta de negocio de punta a punta** con un email de prueba: crear
  cuenta, poner nombre, entrar como gestor, invitar a alguien. Es el recorrido
  que hará cada cliente nuevo y nunca se ha ejecutado.
- Comprobar qué hizo el cierre automático (`where origen = 'auto'`).

> En v68 se unificaron las dos versiones (la app iba por v67 y el SW por v50) en un
> único número visible en pantalla. Antes la versión de app no constaba en ningún
> archivo del repo.

---

## 8. Pendiente

1. **Validar la exportación legal con datos reales** — el árbol del registro estuvo
   roto hasta la migración 33, así que el PDF y el CSV **nunca se han ejecutado con
   datos de verdad**. Es el documento que hay que entregar a inspección: comprobar
   razón social, CIF, NIF, entradas/salidas y totales antes de nada.
2. **Sacar el fichaje de beta** — el mecanismo ya está (migración 44 + v78): la
   puerta pasó de `soy_probador()` —marca global de la cuenta— a un ajuste **del
   negocio**, `config.fichaje.activo`, con su interruptor en Ajustes → Registro
   de jornada. Durante la transición la condición es
   `fichaje_activo(negocio) OR soy_probador()`, así que ejecutar la 44 **no abre
   el fichaje a nadie nuevo**. Solo falta encender el interruptor, y eso va
   **después de validar el PDF** (punto 1). Cuando ya no quede ningún probador,
   se puede quitar el `OR` y borrar `profiles.es_probador`.
3. **Resto de la revisión de seguridad (2026-08-19)** — lo que no arreglan la 42
   ni la 43:
   - **Backups.** El plan gratuito de Supabase guarda copias diarias con 7 días
     de retención y sin point-in-time recovery. El registro de jornada hay que
     conservarlo **4 años**. Hace falta plan de pago con PITR o una exportación
     periódica a un sitio duradero.
   - **Sin separación desarrollo/producción.** Cada migración se ejecuta directa
     contra los datos reales de la plantilla. Para vender esto hace falta un
     proyecto de staging donde probarlas antes.
   - **Sin rate limiting.** `redeem_invite` acepta intentos ilimitados (códigos de
     6 caracteres sobre alfabeto de 28 = 481M, no trivial pero tampoco infinito) e
     `invite_owner` filtra un nombre por código válido. El kiosco sí está
     protegido: 5 intentos y bloqueo de 5 minutos.
4. **Limpieza** — eliminar el respaldo de "horario general del negocio" cuando todas
   las semanas publicadas lleven horas por columna. Y retirar
   `fichajes_por_jornada()`, que desde la migración 38 ya no la usa nadie.
5. **Comandero** (futuro, arquitectura ya diseñada) — comandas desde el móvil del
   camarero, pantallas de cocina por estación (parrilla, cocina) y vista de caja no
   fiscal. Se mantiene como **herramienta interna**, emitiendo los tickets por el TPV
   existente, para no entrar en las obligaciones de VeriFactu (enero 2027 sociedades,
   julio 2027 autónomos).
6. **Comercial** — piloto gratuito con un negocio vecino antes de invertir en la
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
