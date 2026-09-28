# 07 · Modelo de datos

Estructura conceptual. Tres decisiones gobiernan todo: el documento como
entidad base, la separacion del dominio clinico, y la relacion
estandar ↔ evidencia que sostiene el calculo de cumplimiento.

## Esquema conceptual

```
tenant ─┬─ empresa ──┬─ centro_trabajo ── clase_riesgo (I–V)
        │            ├─ vigencia (anio) ── plan_trabajo_anual
        │            └─ perfil_aplicabilidad  → activa modulos y normas
        │
        ├─ persona ──┬─ vinculacion (tipo, cargo, ingreso, retiro*)
        │            ├─ competencia (certificado, vence_en)
        │            ├─ entrega_epp (firmada)
        │            └─ concepto_aptitud (apto | con_restricciones | no_apto)
        │                   ▲ solo concepto — nunca diagnostico
        │
        ├─ documento_sst ─ (tipo, version, fecha, firma, hash, retencion_hasta)
        │            └─ evidencia_estandar ── estandar_minimo
        │
        ├─ peligro ── control (jerarquia 1..5) ── valoracion
        ├─ evento ──┬─ reporte_furat (radicado_arl, radicado_eps, radicado_mintrabajo)
        │           ├─ investigacion (equipo[3], causas, fecha_limite)
        │           └─ accion (CAPA)
        ├─ comite ── periodo(2a) ── sesion ── acta ── compromiso
        ├─ autoevaluacion ── item_estandar (cumple, justificacion, puntaje)
        ├─ indicador ── ficha_tecnica ── medicion (periodo, valor, meta)
        ├─ obligacion_pendiente (motor de plazos)
        ├─ accion (CAPA) ── origen(auditoria|evento|inspeccion|revision|autoeval)
        └─ auditoria_log (append-only: actor, accion, entidad, antes, despues, ts, ip)

* retiro dispara retencion_hasta = fecha_retiro + 20 anios
  en documentos de los 5 tipos del art. 2.2.4.6.13
```

## Entidad base: `documento_sst`

```sql
CREATE TABLE documento_sst (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  empresa_id        BIGINT UNSIGNED NOT NULL,
  tipo_documental   VARCHAR(60)  NOT NULL,   -- FK catalogo
  codigo            VARCHAR(60)  NOT NULL,
  titulo            VARCHAR(255) NOT NULL,
  version           INT UNSIGNED NOT NULL DEFAULT 1,
  documento_padre_id BIGINT UNSIGNED NULL,   -- version anterior
  vigencia_anio     SMALLINT UNSIGNED NULL,
  fecha_documento   DATE NOT NULL,
  fecha_vence       DATE NULL,
  archivo_ruta      VARCHAR(500) NULL,
  archivo_hash      CHAR(64) NULL,           -- SHA-256 del contenido
  retencion_hasta   DATE NULL,
  estado            ENUM('borrador','vigente','reemplazado','anulado') NOT NULL,
  creado_por        BIGINT UNSIGNED NOT NULL,
  creado_en         DATETIME NOT NULL,
  actualizado_en    DATETIME NULL,
  KEY idx_tenant_tipo (tenant_id, empresa_id, tipo_documental, estado),
  KEY idx_vence (tenant_id, fecha_vence)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Regla: **nunca** se actualiza el contenido de un documento vigente. Se crea una
version nueva con `documento_padre_id` apuntando a la anterior, y la anterior
pasa a `reemplazado`.

## Log de auditoria append-only

```sql
CREATE TABLE auditoria_log (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  actor_id     BIGINT UNSIGNED NULL,
  actor_nombre VARCHAR(150) NOT NULL,   -- desnormalizado a proposito
  accion       VARCHAR(40) NOT NULL,    -- crear|versionar|firmar|consultar|exportar
  entidad      VARCHAR(60) NOT NULL,
  entidad_id   BIGINT UNSIGNED NULL,
  antes        JSON NULL,
  despues      JSON NULL,
  ip           VARBINARY(16) NULL,
  user_agent   VARCHAR(255) NULL,
  ocurrido_en  DATETIME(3) NOT NULL,
  KEY idx_entidad (tenant_id, entidad, entidad_id, ocurrido_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Sin `UPDATE` ni `DELETE`. El usuario de aplicacion en MariaDB debe tener
privilegios `INSERT, SELECT` sobre esta tabla y nada mas.
`actor_nombre` se desnormaliza porque el log debe seguir siendo legible aunque
el usuario se elimine del sistema.

## Firma electronica

```sql
CREATE TABLE firma (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  entidad           VARCHAR(60) NOT NULL,
  entidad_id        BIGINT UNSIGNED NOT NULL,
  firmante_id       BIGINT UNSIGNED NOT NULL,
  firmante_nombre   VARCHAR(150) NOT NULL,
  firmante_documento VARCHAR(30) NOT NULL,
  rol_firmante      VARCHAR(60) NOT NULL,
  texto_firmado     TEXT NOT NULL,          -- lo que el firmante vio y acepto
  hash_contenido    CHAR(64) NOT NULL,      -- SHA-256 de lo firmado
  metodo_auth       VARCHAR(40) NOT NULL,   -- password+otp | password | certificado
  ip                VARBINARY(16) NULL,
  user_agent        VARCHAR(255) NULL,
  firmado_en        DATETIME(3) NOT NULL,
  UNIQUE KEY uq_firma (entidad, entidad_id, firmante_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

El **manifiesto de evidencia** (identidad, metodo, texto exacto, hash, timestamp)
es lo que sostiene la valoracion por sana critica del art. 11 de la Ley 527.

## Catalogos maestros centralizados

No son datos del cliente: los mantiene TORRESOFT y se heredan a todos los
tenants (`tenant_id = NULL` o tabla global separada). Actualizarlos es el
servicio recurrente que justifica la suscripcion.

| Catalogo | Archivo semilla | Contenido |
|---|---|---|
| `norma` | `data/normas.json` | Matriz legal base con derogatorias y vigencias |
| `estandar_minimo` | `data/estandares_minimos.json` | 3/7/21/60 con ponderacion y modo de verificacion |
| `plazo_legal` | `data/plazos_legales.json` | Plazos y vencimientos con tipo habil/calendario |
| `indicador_catalogo` | `data/indicadores.json` | Indicadores minimos con formula |
| `clase_riesgo` | `data/clases_riesgo.json` | Clases I–V y criterios |
| `tipo_documental` | `data/tipos_documentales.json` | 16 documentos + retencion |
| `festivo` | `data/festivos_co.json` | Festivos colombianos 2026–2031 |
| `enfermedad_laboral` | pendiente | Decreto 1477 de 2014 |
| `actividad_economica` | pendiente | CIIU + clase de riesgo (D. 1607/2002) |

## Convenciones SQL

- InnoDB, `utf8mb4_unicode_ci`.
- `BIGINT UNSIGNED` para llaves.
- `tenant_id` como **primera columna de todo indice compuesto**.
- Sin `ON DELETE CASCADE` en entidades documentales: no se borran.
- `DECIMAL(5,2)` para puntajes y porcentajes; nunca `FLOAT`.
- Zona horaria `America/Bogota` fijada en la conexion.
