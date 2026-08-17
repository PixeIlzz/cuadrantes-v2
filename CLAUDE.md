# StaffPoint v2 — Estado del proyecto

> Documento vivo. Se carga automáticamente en cada sesión de Claude Code.
> **Actualizar al cerrar cada tanda de trabajo**: versiones, migración SQL, módulos
> tocados y la lista de pendientes.

**Última actualización:** 2026-08-16 · v68 (versión única visible en pantalla)

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

> **Aviso: el esquema no está versionado.** Las migraciones 1–32 solo existen dentro
> de Supabase; en `sql/` está únicamente la 33 en adelante. No hay a qué volver si se
> rompe una función, y ningún error de SQL se puede diagnosticar sin abrir el panel.
> Volcar las 32 anteriores a `sql/` es tarea pendiente.

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
  - **Aisladas en `resolve_timefix`**: `resolve_request` (vacaciones) no se toca.
  - Trazabilidad: al aprobar, el fichaje se escribe con `origen: 'gestor'` **y**
    `time_entries.request_id` apuntando a la solicitud, así `time_entry_audit` recoge
    por trigger quién pidió el cambio y por qué, sin tocar el trigger.
  - La hora viaja como texto `'YYYY-MM-DDTHH:MM'` y la interpreta el servidor en la
    zona del negocio. Nunca se manda un instante calculado en el navegador.

---

## 6. Decisiones y aprendizajes (no repetir errores)

**Zona horaria.** Todo cálculo de fechas se hace en `Atlantic/Canary` **en el
servidor**. Comparar cadenas en UTC provocó un bug real de medianoche.

**RPC de Postgres.** Devolver los errores **como datos JSONB**, nunca con
`raise exception`: la excepción revierte la transacción y se pierden efectos que
deben persistir, como el contador de intentos de PIN.

**Cambiar el tipo de retorno de una función** exige `DROP FUNCTION` antes;
`CREATE OR REPLACE` falla.

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
| App (`js/version.js` → `APP_VERSION`) | v70 |
| Service worker (`sw.js` → `VERSION`) | v70 |
| Migración SQL | 35 |

Todo el módulo de fichaje está tras `soy_probador()` mientras se prueba en real.

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
4. **Volcar las migraciones 1–32 a `sql/`** — hoy el esquema no tiene copia
   versionada (ver aviso en el apartado 4).
5. **Rendimiento del árbol del registro** — [registro-arbol.js](js/ui/registro-arbol.js)
   pide 2 años de fichajes y lanza una RPC `turno_previsto` **por cada día con
   fichajes** (`Promise.all`); además `dia_laboral()` se ejecuta por fila y vuelve a
   llamar a `turno_previsto`. Con un año de datos son cientos de peticiones por
   pantalla. Solución limpia: una RPC que devuelva días, previsto y totales ya
   calculados en el servidor.
6. **Limpieza** — eliminar el respaldo de "horario general del negocio" cuando todas
   las semanas publicadas lleven horas por columna.
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
