-- Nucleo multi-tenant. Requiere 01_catalogos.sql.
-- Cada tabla de tenant expone UNIQUE (tenant_id, id) y sus hijas referencian (tenant_id, x_id):
-- la BD impide que un registro apunte a un padre de otro tenant.

CREATE TABLE tenant (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  nombre          VARCHAR(200) NOT NULL,
  region_datos    VARCHAR(40)  NOT NULL DEFAULT 'co-bogota',
  plan            VARCHAR(30)  NULL,
  estado          ENUM('activo','suspendido','retirado') NOT NULL DEFAULT 'activo',
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Usuario nominal global: una persona inicia sesion una vez y accede a varios tenants (consultor).
CREATE TABLE usuario (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email                 VARCHAR(190) NOT NULL,
  nombres               VARCHAR(100) NOT NULL,
  apellidos             VARCHAR(100) NOT NULL,
  tipo_documento        VARCHAR(5)   NOT NULL,
  numero_documento      VARCHAR(30)  NOT NULL,
  password_hash         VARCHAR(255) NOT NULL,
  es_superadmin         TINYINT(1)   NOT NULL DEFAULT 0,
  intentos_fallidos     TINYINT UNSIGNED NOT NULL DEFAULT 0,
  bloqueado_hasta       DATETIME NULL,
  ultimo_acceso         DATETIME NULL,
  debe_cambiar_password TINYINT(1)   NOT NULL DEFAULT 0,
  estado                ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  creado_por            BIGINT UNSIGNED NULL,
  creado_en             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en        DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_email (email),
  UNIQUE KEY uq_documento (tipo_documento, numero_documento)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE usuario_tenant (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  usuario_id      BIGINT UNSIGNED NOT NULL,
  rol_codigo      VARCHAR(30) NOT NULL,
  estado          ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_usuario_rol (tenant_id, usuario_id, rol_codigo),
  KEY idx_usuario (usuario_id, estado),
  CONSTRAINT fk_ut_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenant (id),
  CONSTRAINT fk_ut_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id),
  CONSTRAINT fk_ut_rol     FOREIGN KEY (rol_codigo) REFERENCES rol (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de express-mysql-session (nombres de columna fijados en la config de la app).
CREATE TABLE sesion (
  session_id  VARCHAR(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  expires     INT UNSIGNED NOT NULL,
  data        MEDIUMTEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin,
  KEY idx_expires (expires)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE empresa (
  id                             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id                      BIGINT UNSIGNED NOT NULL,
  nit                            VARCHAR(20)  NOT NULL,
  digito_verificacion            CHAR(1)      NULL,
  razon_social                   VARCHAR(200) NOT NULL,
  ciiu_codigo                    VARCHAR(10)  NULL,
  arl                            VARCHAR(100) NULL,
  direccion                      VARCHAR(200) NULL,
  municipio_divipola             CHAR(5)      NULL,
  telefono                       VARCHAR(30)  NULL,
  email                          VARCHAR(190) NULL,
  representante_legal_nombre     VARCHAR(150) NULL,
  representante_legal_documento  VARCHAR(30)  NULL,
  numero_trabajadores            INT UNSIGNED NOT NULL DEFAULT 0,
  es_agropecuaria                TINYINT(1)   NOT NULL DEFAULT 0,
  numero_vehiculos               INT UNSIGNED NOT NULL DEFAULT 0,
  numero_conductores             INT UNSIGNED NOT NULL DEFAULT 0,
  contrata_terceros              TINYINT(1)   NOT NULL DEFAULT 0,
  estado                         ENUM('activa','inactiva') NOT NULL DEFAULT 'activa',
  creado_por                     BIGINT UNSIGNED NULL,
  creado_en                      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en                 DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_tenant_nit (tenant_id, nit),
  CONSTRAINT fk_empresa_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Perfil de aplicabilidad: ambitos declarados (alturas, quimicos, pesv...). Valores = norma.ambito.
CREATE TABLE empresa_ambito (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  empresa_id      BIGINT UNSIGNED NOT NULL,
  ambito          VARCHAR(40) NOT NULL,
  estado          ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_empresa_ambito (tenant_id, empresa_id, ambito),
  CONSTRAINT fk_ea_empresa FOREIGN KEY (tenant_id, empresa_id) REFERENCES empresa (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE centro_trabajo (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id           BIGINT UNSIGNED NOT NULL,
  empresa_id          BIGINT UNSIGNED NOT NULL,
  nombre              VARCHAR(150) NOT NULL,
  direccion           VARCHAR(200) NULL,
  municipio_divipola  CHAR(5)      NULL,
  clase_riesgo        VARCHAR(3)   NOT NULL,
  numero_trabajadores INT UNSIGNED NOT NULL DEFAULT 0,
  estado              ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  creado_por          BIGINT UNSIGNED NULL,
  creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en      DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_empresa (tenant_id, empresa_id, estado),
  CONSTRAINT fk_ct_empresa FOREIGN KEY (tenant_id, empresa_id) REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_ct_clase   FOREIGN KEY (clase_riesgo) REFERENCES clase_riesgo (clase)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cargo (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  empresa_id      BIGINT UNSIGNED NOT NULL,
  nombre          VARCHAR(150) NOT NULL,
  descripcion     TEXT NULL,
  perfil_riesgo   TEXT NULL,
  estado          ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_empresa_nombre (tenant_id, empresa_id, nombre),
  CONSTRAINT fk_cargo_empresa FOREIGN KEY (tenant_id, empresa_id) REFERENCES empresa (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Persona del tenant; puede vincularse a varias empresas del mismo tenant.
-- usuario_id habilita el canal de consulta del propio trabajador (par. 3 art. 2.2.4.6.12).
CREATE TABLE persona (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  tipo_documento    VARCHAR(5)   NOT NULL,
  numero_documento  VARCHAR(30)  NOT NULL,
  nombres           VARCHAR(100) NOT NULL,
  apellidos         VARCHAR(100) NOT NULL,
  sexo              ENUM('F','M','NB') NULL,
  fecha_nacimiento  DATE NULL,
  email             VARCHAR(190) NULL,
  telefono          VARCHAR(30)  NULL,
  usuario_id        BIGINT UNSIGNED NULL,
  estado            ENUM('activa','inactiva') NOT NULL DEFAULT 'activa',
  creado_por        BIGINT UNSIGNED NULL,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_tenant_documento (tenant_id, tipo_documento, numero_documento),
  CONSTRAINT fk_persona_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenant (id),
  CONSTRAINT fk_persona_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- fecha_retiro dispara retencion_hasta (+20 anios) en los documentos del art. 2.2.4.6.13.
CREATE TABLE vinculacion (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id          BIGINT UNSIGNED NOT NULL,
  empresa_id         BIGINT UNSIGNED NOT NULL,
  persona_id         BIGINT UNSIGNED NOT NULL,
  centro_trabajo_id  BIGINT UNSIGNED NULL,
  cargo_id           BIGINT UNSIGNED NULL,
  tipo               ENUM('dependiente','contratista','aprendiz','mision','independiente') NOT NULL,
  fecha_ingreso      DATE NOT NULL,
  fecha_retiro       DATE NULL,
  motivo_retiro      VARCHAR(255) NULL,
  estado             ENUM('activa','retirada','anulada') NOT NULL DEFAULT 'activa',
  creado_por         BIGINT UNSIGNED NULL,
  creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_empresa_estado (tenant_id, empresa_id, estado),
  KEY idx_persona (tenant_id, persona_id),
  CONSTRAINT fk_vin_empresa FOREIGN KEY (tenant_id, empresa_id)        REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_vin_persona FOREIGN KEY (tenant_id, persona_id)        REFERENCES persona (tenant_id, id),
  CONSTRAINT fk_vin_centro  FOREIGN KEY (tenant_id, centro_trabajo_id) REFERENCES centro_trabajo (tenant_id, id),
  CONSTRAINT fk_vin_cargo   FOREIGN KEY (tenant_id, cargo_id)          REFERENCES cargo (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Entidad base de todo registro del SG-SST: quien, que, cuando, evidencia, firma, version.
-- Nunca se edita un documento no-borrador: se versiona (ver 03_protecciones.sql).
CREATE TABLE documento_sst (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id           BIGINT UNSIGNED NOT NULL,
  empresa_id          BIGINT UNSIGNED NOT NULL,
  tipo_documental     VARCHAR(60)  NOT NULL,
  codigo              VARCHAR(60)  NOT NULL,
  titulo              VARCHAR(255) NOT NULL,
  version             INT UNSIGNED NOT NULL DEFAULT 1,
  documento_padre_id  BIGINT UNSIGNED NULL,
  persona_id          BIGINT UNSIGNED NULL,
  vigencia_anio       SMALLINT UNSIGNED NULL,
  fecha_documento     DATE NOT NULL,
  fecha_vence         DATE NULL,
  archivo_ruta        VARCHAR(500) NULL,
  archivo_hash        CHAR(64) NULL,
  retencion_hasta     DATE NULL,
  estado              ENUM('borrador','vigente','reemplazado','anulado') NOT NULL DEFAULT 'borrador',
  motivo_estado       VARCHAR(255) NULL,
  creado_por          BIGINT UNSIGNED NOT NULL,
  creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en      DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_codigo_version (tenant_id, empresa_id, codigo, version),
  KEY idx_tenant_tipo (tenant_id, empresa_id, tipo_documental, estado),
  KEY idx_vence (tenant_id, fecha_vence),
  KEY idx_persona (tenant_id, persona_id),
  CONSTRAINT fk_doc_empresa FOREIGN KEY (tenant_id, empresa_id)         REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_doc_padre   FOREIGN KEY (tenant_id, documento_padre_id) REFERENCES documento_sst (tenant_id, id),
  CONSTRAINT fk_doc_persona FOREIGN KEY (tenant_id, persona_id)         REFERENCES persona (tenant_id, id),
  CONSTRAINT fk_doc_tipo    FOREIGN KEY (tipo_documental)               REFERENCES tipo_documental (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Manifiesto de evidencia de firma electronica (Ley 527 art. 7 y 11, D. 2364/2012).
CREATE TABLE firma (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id           BIGINT UNSIGNED NOT NULL,
  entidad             VARCHAR(60)  NOT NULL,
  entidad_id          BIGINT UNSIGNED NOT NULL,
  firmante_id         BIGINT UNSIGNED NOT NULL,
  firmante_nombre     VARCHAR(150) NOT NULL,
  firmante_documento  VARCHAR(30)  NOT NULL,
  rol_firmante        VARCHAR(60)  NOT NULL,
  texto_firmado       TEXT NOT NULL,
  hash_contenido      CHAR(64) NOT NULL,
  metodo_auth         VARCHAR(40)  NOT NULL,
  ip                  VARBINARY(16) NULL,
  user_agent          VARCHAR(255) NULL,
  firmado_en          DATETIME(3) NOT NULL,
  UNIQUE KEY uq_firma (tenant_id, entidad, entidad_id, firmante_id),
  CONSTRAINT fk_firma_tenant   FOREIGN KEY (tenant_id)   REFERENCES tenant (id),
  CONSTRAINT fk_firma_usuario  FOREIGN KEY (firmante_id) REFERENCES usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only. tenant_id NULL = evento global (catalogos, superadmin, login sin empresa).
CREATE TABLE auditoria_log (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id     BIGINT UNSIGNED NULL,
  actor_id      BIGINT UNSIGNED NULL,
  actor_nombre  VARCHAR(150) NOT NULL,
  accion        VARCHAR(40)  NOT NULL,
  entidad       VARCHAR(60)  NOT NULL,
  entidad_id    BIGINT UNSIGNED NULL,
  antes         JSON NULL,
  despues       JSON NULL,
  ip            VARBINARY(16) NULL,
  user_agent    VARCHAR(255) NULL,
  ocurrido_en   DATETIME(3) NOT NULL,
  KEY idx_entidad (tenant_id, entidad, entidad_id, ocurrido_en),
  KEY idx_actor (tenant_id, actor_id, ocurrido_en)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Autorizacion versionada (Ley 1581, D. 1377 art. 8). Tambien sirve para el
-- acuerdo de uso de firma electronica (D. 2364 art. 7): finalidad = 'acuerdo_firma_electronica'.
CREATE TABLE consentimiento (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  persona_id        BIGINT UNSIGNED NOT NULL,
  finalidad         VARCHAR(120) NOT NULL,
  es_dato_sensible  TINYINT(1)   NOT NULL,
  politica_version  VARCHAR(20)  NOT NULL,
  texto_mostrado    TEXT NOT NULL,
  otorgado          TINYINT(1)   NOT NULL,
  medio             ENUM('web','fisico_escaneado','verbal_registrado') NOT NULL,
  ip                VARBINARY(16) NULL,
  otorgado_en       DATETIME(3) NOT NULL,
  revocado_en       DATETIME(3) NULL,
  estado            ENUM('vigente','revocado') NOT NULL DEFAULT 'vigente',
  creado_por        BIGINT UNSIGNED NULL,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_persona_finalidad (tenant_id, persona_id, finalidad),
  CONSTRAINT fk_cons_persona FOREIGN KEY (tenant_id, persona_id) REFERENCES persona (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
