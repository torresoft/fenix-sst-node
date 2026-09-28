# Proyecto: SG-SST SaaS (TORRESOFT)

Sistema multiempresa para gestionar el Sistema de Gestion de Seguridad y Salud
en el Trabajo (SG-SST) bajo la normatividad colombiana.

Corte normativo de la documentacion: **31 de agosto de 2026**.

---

## Stack

- Backend: **Node.js 20 + Express 4** (JavaScript, sin TypeScript)
- Vistas: **EJS** (`<%= %>` escapa; `<%- %>` solo para includes y constantes con entidades)
- UI: **AdminLTE 3.2** servido desde `node_modules/admin-lte` (sin CDN), CSP `script-src 'self'`
- BD: **MariaDB** con **mysql2** a secas, sin ORM (InnoDB, `utf8mb4_unicode_ci`)
- Esquema: scripts SQL simples numerados en `sql/`, sin sistema de migraciones
- Catalogos: `npm run catalogos` (idempotente) carga `data/*.json`
- Pruebas: `node --test` (`npm test`)
- JS de cliente: archivos `.js` separados por modulo, nunca embebido en las vistas

### Capa de datos (aislamiento por tenant)

- `src/db/pool.js` es privado: fuera de `src/db` nadie importa el pool ni mysql2
  (lo verifica `test/aislamiento.test.js`).
- Datos de tenant solo via `req.repo` (`RepositorioTenant`): `listar`, `obtener`,
  `insertar`, `actualizar` (auditados) y `consultar(sql)` con una marca
  `{tenant}` por cada tabla de tenant. No existe metodo de borrado.
- Toda tabla nueva se registra en `src/db/tablas.js` (TENANT o GLOBAL) o la
  capa de datos la rechaza.
- Las tablas hijas referencian `(tenant_id, x_id)` contra `UNIQUE (tenant_id, id)`
  del padre: la BD impide referencias cruzadas entre tenants.
- Plazos: `require('src/fechas')` → `sumarPlazo`, `diasHabiles`, `estadoPlazo`
  contra la tabla `festivo`.

### Motor de obligaciones (`src/plazos/servicio.js`)

Los modulos no calculan fechas limite: informan al motor y el catalogo decide.
- `dispararEvento(repo, { evento, variante, fecha, empresaId, entidadTipo, entidadId, responsableId })`
  — `evento`/`variante` deben coincidir con `plazo_legal.evento_disparador`
  (p. ej. `evento.creado` + `mortal`). Idempotente.
- `registrarVigencia(repo, { vencimientoCodigo, empresaId, entidadTipo, entidadId, fechaInicio })`
  — comites, licencias, certificaciones; cierra la vigencia anterior del mismo elemento.
- `cumplirObligacion`, `anularObligacion` (solo desde modulos, nunca UI), `asignarResponsable`.
- Job diario: `node scripts/job-diario.js` desde el cron del servidor.

### Matriz legal (`src/matriz/`)

- Aplicabilidad = ambitos de `ambito_normativo` (general + declarados en `empresa_ambito` + los que activa `regla_activacion`).
- `cumple` exige al menos un documento vigente como evidencia.
- Cuando un documento cite normas, registrarlo en `documento_norma`: el boletin avisa que documentos quedan afectados.
- La carga de catalogos genera `boletin_normativo` si cambia el estado de una norma o entra una nueva; el job diario lo propaga a `boletin_empresa`.
- El auditor (`auditor.js`) es puro; cada corrida queda inmutable en `auditoria_matriz`.

### Autoevaluacion 0312 (`src/autoevaluacion/`)

- `motor.js` es puro y trabaja en centesimas enteras. La tabla de 60 es el maestro de puntaje;
  7/21 son requisitos que mapean a numerales; fuera del conjunto o no aplica justificado = puntaje maximo (art. 27).
- Un numeral se cumple solo con documento vigente al corte, no vencido y firmado si su tipo lo exige.
- Borrador se calcula en vivo; al cerrar se congela con hash SHA-256. Correccion = version nueva.
- El cierre dispara `autoevaluacion.cerrada[<VALORACION>]`, la vigencia AUTOEVALUACION y el cargue (`estandar_cargue`).

### Gestor documental y firma (`src/documentos/`)

- Ciclo: borrador (editable) -> en_firma -> vigente -> reemplazado | anulado. Correccion = version nueva.
- Archivo en `ALMACEN_DIR` como `<tenant>/<empresa>/<sha256><ext>`; el hash queda en `documento_sst.archivo_hash`.
- `tipo_documental.solo_referencia`: no admite archivo (historia clinica). `modalidades_firma`: electronica | manuscrita | digital_externa.
- Firma electronica = clave + OTP (hash en `firma_otp`) + aceptacion del manifiesto; la primera vez, el acuerdo (`data/acuerdo_firma.json`, D. 2364 art. 7).
  Sin SMTP en desarrollo el OTP sale por consola; en produccion falla.
- Formularios multipart: el token CSRF va en la URL del action (`?_csrf=`), porque multer parsea despues del middleware.
- Los modulos que generen documentos crean `documento_sst` y citan normas en `documento_norma`.

### Empresa, usuarios y personas (`src/empresa/`, `src/personas/`)

- Cambios de trabajadores o de clase de riesgo de un centro llaman `verificarClasificacion` (reclasificacion 0312).
- Modulos activos: `data/modulos.json` (siempre | ambitos | regla), evaluado con el perfil de la empresa.
- Usuarios: `/empresa/usuarios` (solo admin_tenant). Quitar todos los roles = sin acceso; siempre queda un admin.
- Vinculacion: el retiro dispara `vinculacion.retiro` (examen de egreso) y fija la retencion de 20 anios;
  retirada/anulada es final (un reintegro es una vinculacion nueva). El ingreso dispara `vinculacion.ingreso` (para M07).

### Eventos (`src/eventos/`)

- Registrar dispara `evento.creado[<variante>]`: incidente | at_leve | at_grave | at_mortal | el.
  Base del plazo: fecha de ocurrencia (AT, incidente) o de calificacion (EL).
- EL sin diagnostico: solo fecha de calificacion, entidad y agente de riesgo (regla dura 1).
- Criterios de gravedad y roles del equipo investigador: catalogos `evento_criterio_grave` e `investigacion_rol`.
- Las radicaciones y el informe firmado cumplen las obligaciones del motor; el plan de accion va a `accion_mejora`.

### Comites (`src/comites/`)

- Conformacion, quorum y periodicidad por tipo en `comite_tipo` (`data/comites.json`); null = regla no cargada: se avisa, no se valida.
- Un registro de `comite` por periodo de 2 anios; el nuevo reemplaza al anterior y cumple su obligacion de renovacion.
- Sesion registrada dispara `sesion.realizada` (acta en 8 dias); el acta vigente la cumple. Una extraordinaria
  ligada a un AT grave/mortal cumple `COPASST_EXTRA` del evento.

### Pruebas

- `npm test`: unitarias puras. `npm run test:integracion`: crea `<DB_NAME>_it`, corre `sql/`, carga
  catalogos, prueba contra MariaDB real (incluido HTTP) y borra la BD. Todo modulo nuevo agrega su archivo en `test-integracion/`.

### Convenciones heredadas del estandar de la casa

Del skill `project-standards` aplican, adaptadas a Node:

- **Nada de logica JS embebida en las vistas.** Pasar datos con atributos
  `data-*` o un endpoint JSON dedicado; la logica va en `/public/js/<modulo>/`.
- **Tildes y enies como entidades HTML** en el markup renderizado
  (`&aacute;`, `&ntilde;`, `&iquest;`). Los strings de logica y logs van en
  UTF-8 normal.
- **AdminLTE 3.2**, no 2.x: `card` en vez de `box`, `nav-item`/`nav-link`.
  Sin `bg-gradient-*` ni clases de animacion salvo toasts.
- **Escapar toda salida dinamica** en las plantillas (auto-escape activado; si
  el motor no lo hace por defecto, escapar explicitamente).
- Endpoints AJAX responden JSON con `Content-Type: application/json`.
- Tablas: `table table-bordered table-hover table-sm`, acciones por fila con
  iconos FontAwesome y tooltip.
- Formularios: label encima, requeridos marcados con `*` en el label.
- Sin `console.log` de depuracion en produccion.

---

### Interfaz

- Menu lateral declarativo por PHVA en `src/comun/menu.js` (ruta, icono, roles):
  un modulo nuevo se agrega ahi, no en la vista.
- Pagina = cabecera (titulo, `subtitulo` opcional, miga automatica) + `.barra-acciones`
  (filtros a la izquierda, botones a la derecha) + contenido.
- Contadores: `partials/franja` (en linea), nunca filas de `small-box`.
- Detalles: ficha a todo el ancho y secciones en `nav-tabs`; no tarjetas en columnas.
  La pestana activa se recuerda por pagina y `#x` abre `#tab-x`.
- Titulos: se imprimen escapados con `textoPlano()` (admite entidades en el texto fijo).
- JS comun (`public/js/comun/app.js`): `form.js-confirmar[data-confirmar]`,
  `.js-autoenvio`, `.js-barra[data-valor]`. No duplicarlos en los modulos.
- Navegacion con Turbo Drive: el JS de modulo se re-ejecuta en cada visita (enlazar a elementos, no a
  `document`); redirigir con `Turbo.visit`; descargas con `a[download]` o `data-turbo="false"`;
  un POST que re-pinta el formulario sale como 422 (lo hace `app.js`).
- Obligaciones abiertas de una entidad: `plazos.abiertasDe(tx, entidad, id, plazo?)`.
  Acciones correctivas: `src/capa/servicio.js` (tabla unica `accion_mejora`).

## Documentacion de dominio — leela antes de implementar

| Archivo | Cuando leerlo |
|---|---|
| `docs/00-contexto-producto.md` | Siempre, al empezar cualquier tarea |
| `docs/01-marco-normativo.md` | Al tocar la matriz legal o citar una norma |
| `docs/02-obligaciones-registros.md` | Al disenar cualquier formulario o tabla |
| `docs/03-estandares-minimos.md` | Al trabajar en autoevaluacion o cumplimiento |
| `docs/04-indicadores.md` | Al trabajar en tablero o indicadores |
| `docs/05-plazos-y-vencimientos.md` | Al trabajar en alertas o fechas limite |
| `docs/06-modulos.md` | Al crear un modulo nuevo |
| `docs/07-modelo-datos.md` | Al crear o alterar tablas |
| `docs/08-privacidad-y-trazabilidad.md` | **Obligatorio** al tocar salud, firmas o logs |
| `docs/09-roadmap.md` | Al decidir que sigue |

Los catalogos normativos precargables estan en `data/*.json`.

---

## Reglas duras — no negociables

Vienen de la ley, no de una preferencia de diseno. Violarlas expone al cliente
a sanciones y al producto a un rediseno completo.

### 1. El empleador NO accede a la historia clinica ocupacional
La Res. 1843 de 2025 lo prohibe expresamente. En el dominio del empleador solo
existen: tipo y fecha de evaluacion, **concepto de aptitud** (apto / apto con
restricciones / no apto), restricciones y recomendaciones, y agregados sin
identificar. Nunca diagnosticos, paraclinicos ni informes psicosociales
individuales. Si una tarea pide guardar un diagnostico en el tenant del
empleador, **detente y avisa**: es un incumplimiento, no un requerimiento.

### 2. El log de auditoria es append-only
Nada se borra ni se sobrescribe. Una correccion crea una version nueva y la
anterior queda accesible. Fundamento: Res. 1995/1999 art. 18 exige mecanismos
que imposibiliten modificar datos ya guardados, y el Decreto 472/2015 pone el
ocultamiento y la obstruccion como agravantes de la multa.
No uses `UPDATE` destructivo ni `DELETE` sobre documentos, actas, evaluaciones,
eventos ni firmas. Marca estado, versiona, registra.

### 3. Todo registro lleva la misma anatomia
`quien` · `que` · `cuando` · `evidencia` · `firma` · `version`.
Hereda de la entidad base `documento_sst` en vez de repetir la estructura.

### 4. Aislamiento multi-tenant en la capa de datos
El filtro por `tenant_id` va en el repositorio/capa de acceso a datos, nunca
solo en la ruta o el controlador. Toda consulta nueva pasa por el helper que lo
aplica. Hay datos sensibles de salud: una fuga entre tenants es sancion de la
SIC, que en datos sensibles llega al cierre definitivo de la operacion.

### 5. Los plazos habiles se calculan contra el calendario de festivos
Nunca aritmetica de dias. Usa `data/festivos_co.json` y el helper
`diasHabiles()`. Un plazo mal calculado en un reporte de accidente mortal es
una multa de hasta 1.000 SMMLV.

### 6. La norma es dato, no codigo
Normas, estandares minimos, plazos, indicadores, tipos documentales y festivos
viven en catalogos de BD alimentados desde `data/*.json`, mantenidos
centralmente y heredados por cada tenant. Nunca hardcodees un articulo, un
porcentaje de ponderacion ni una fecha limite del Ministerio.

---

## Convenciones del proyecto

- Tablas y columnas en **espaniol, snake_case, singular**
  (`documento_sst`, `concepto_aptitud`, `fecha_limite`).
- Toda tabla de negocio lleva: `id`, `tenant_id`, `creado_por`, `creado_en`,
  `actualizado_en`, `estado`.
- Consultas siempre parametrizadas (placeholders `?`), nunca concatenacion.
- Fechas en `DATE` / `DATETIME`; nunca strings. Zona horaria `America/Bogota`
  fijada en la conexion y en el proceso Node.
- Dinero y puntajes en `DECIMAL`, nunca `FLOAT` ni `Number` sin redondeo.
- Cada norma citada en codigo o UI se referencia por `norma.codigo` del
  catalogo, no por texto libre.
- Comentarios y mensajes de UI en espaniol.

## Como trabajar

- Antes de implementar un modulo, lee su ficha en `docs/06-modulos.md` y las
  obligaciones que lo originan en `docs/02-obligaciones-registros.md`.
- Si una decision depende de una interpretacion legal que la documentacion
  marca como **no verificada**, no adivines: dejalo parametrizable y avisa.
- Prefiere agregar una fila al catalogo antes que una condicion en el codigo.
