-- Catalogos globales mantenidos por TORRESOFT y heredados por todos los tenants.
-- Sin tenant_id. modificado_manual = 1 -> el seed no pisa la fila (editada desde la administracion).

CREATE TABLE clase_riesgo (
  clase             VARCHAR(3)   NOT NULL PRIMARY KEY,
  nivel             TINYINT UNSIGNED NOT NULL,
  descripcion       VARCHAR(150) NOT NULL,
  ejemplos          VARCHAR(500) NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_nivel (nivel)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE norma (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  codigo            VARCHAR(40)  NOT NULL,
  tipo              VARCHAR(20)  NOT NULL,
  numero            VARCHAR(20)  NOT NULL,
  anio              SMALLINT UNSIGNED NOT NULL,
  emisor            VARCHAR(80)  NOT NULL,
  objeto            VARCHAR(500) NOT NULL,
  estado_vigencia   ENUM('vigente','vigente_parcial','efecto_agotado','derogada','sustituida') NOT NULL,
  reemplaza_a       VARCHAR(255) NULL,          -- codigos separados por coma
  derogada_por      VARCHAR(255) NULL,
  ambito            VARCHAR(40)  NOT NULL,
  modulos           JSON NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_codigo (codigo),
  KEY idx_ambito (ambito, estado_vigencia)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Conjuntos de la Res. 0312 (3 / 7 / 21 / 60) y su criterio de aplicabilidad.
-- Se evalua por prioridad; el primero cuyos rangos coinciden aplica; es_residual cubre el resto.
CREATE TABLE estandar_conjunto (
  codigo             VARCHAR(20)  NOT NULL PRIMARY KEY,
  articulo           VARCHAR(20)  NOT NULL,
  criterio           VARCHAR(255) NOT NULL,
  cantidad_estandares SMALLINT UNSIGNED NOT NULL,
  perfil_responsable VARCHAR(500) NULL,
  prioridad          TINYINT UNSIGNED NOT NULL,
  trabajadores_min   INT UNSIGNED NULL,
  trabajadores_max   INT UNSIGNED NULL,
  riesgo_nivel_min   TINYINT UNSIGNED NULL,
  riesgo_nivel_max   TINYINT UNSIGNED NULL,
  solo_agropecuario  TINYINT(1) NOT NULL DEFAULT 0,
  es_residual        TINYINT(1) NOT NULL DEFAULT 0,
  evalua_tabla_completa TINYINT(1) NOT NULL DEFAULT 0,
  norma_codigo       VARCHAR(40)  NOT NULL DEFAULT 'RES-0312-2019',
  estado             ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual  TINYINT(1) NOT NULL DEFAULT 0,
  creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por    BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ponderacion PHVA: ciclo (componente NULL) y componentes.
CREATE TABLE estandar_ponderacion (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ciclo             ENUM('PLANEAR','HACER','VERIFICAR','ACTUAR') NOT NULL,
  componente        VARCHAR(150) NOT NULL DEFAULT '',
  peso              DECIMAL(5,2) NOT NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_ciclo_comp (ciclo, componente)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE estandar_valoracion (
  codigo            VARCHAR(40)  NOT NULL PRIMARY KEY,
  minimo            DECIMAL(5,2) NOT NULL,
  maximo            DECIMAL(5,2) NOT NULL,
  criterio_literal  VARCHAR(255) NULL,
  acciones          JSON NOT NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tabla de Valores del art. 27 (60 items con peso). Maestro de puntaje para todos los conjuntos.
CREATE TABLE estandar_minimo (
  numeral           VARCHAR(20)  NOT NULL PRIMARY KEY,
  estandar          VARCHAR(500) NOT NULL,
  peso_estandar     DECIMAL(5,2) NOT NULL,
  nombre            VARCHAR(255) NOT NULL,
  ciclo             ENUM('PLANEAR','HACER','VERIFICAR','ACTUAR') NOT NULL,
  componente        VARCHAR(150) NOT NULL,
  peso              DECIMAL(5,2) NOT NULL,
  item_articulo     VARCHAR(500) NULL,
  criterio          TEXT NULL,
  modo_verificacion TEXT NULL,
  articulo          VARCHAR(20)  NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL,
  KEY idx_ciclo_comp (ciclo, componente)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Requisitos de los conjuntos reducidos (3 / 7 / 21), tal como los enuncian los arts. 3, 7 y 9.
CREATE TABLE estandar_requisito (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conjunto_codigo   VARCHAR(20)  NOT NULL,
  orden             SMALLINT UNSIGNED NOT NULL,
  nombre            VARCHAR(500) NOT NULL,
  criterio          TEXT NULL,
  modo_verificacion TEXT NULL,
  articulo          VARCHAR(20)  NULL,
  mapeo_verificado  TINYINT(1) NOT NULL DEFAULT 0,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL,
  UNIQUE KEY uq_conjunto_orden (conjunto_codigo, orden),
  CONSTRAINT fk_req_conjunto FOREIGN KEY (conjunto_codigo) REFERENCES estandar_conjunto (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Requisito -> numerales de la Tabla de Valores (un requisito puede cubrir varios).
-- mapeo_verificado = 0 en estandar_requisito: el mapeo no esta en el texto oficial.
CREATE TABLE estandar_requisito_numeral (
  conjunto_codigo   VARCHAR(20) NOT NULL,
  orden             SMALLINT UNSIGNED NOT NULL,
  numeral           VARCHAR(20) NOT NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL,
  PRIMARY KEY (conjunto_codigo, orden, numeral),
  CONSTRAINT fk_rn_requisito FOREIGN KEY (conjunto_codigo, orden) REFERENCES estandar_requisito (conjunto_codigo, orden),
  CONSTRAINT fk_rn_numeral   FOREIGN KEY (numeral) REFERENCES estandar_minimo (numeral)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Plazos disparados por evento (tipo habil | calendario | mes).
CREATE TABLE plazo_legal (
  codigo            VARCHAR(40)  NOT NULL PRIMARY KEY,
  descripcion       VARCHAR(255) NOT NULL,
  cantidad          SMALLINT UNSIGNED NOT NULL,
  tipo              ENUM('habil','calendario','mes') NOT NULL,
  norma_codigo      VARCHAR(40)  NOT NULL,
  evento_disparador VARCHAR(80)  NOT NULL,
  entidad_destino   VARCHAR(100) NULL,
  modulo            VARCHAR(20)  NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL,
  KEY idx_disparador (evento_disparador)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE vencimiento_recurrente (
  codigo             VARCHAR(40)  NOT NULL PRIMARY KEY,
  descripcion        VARCHAR(255) NOT NULL,
  cada               SMALLINT UNSIGNED NOT NULL,
  unidad             ENUM('dia','mes','anio') NOT NULL,
  norma_codigo       VARCHAR(40)  NOT NULL,
  consecuencia       VARCHAR(255) NULL,
  modulo             VARCHAR(20)  NOT NULL,
  dias_alerta_previa SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  estado             ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual  TINYINT(1) NOT NULL DEFAULT 0,
  creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por    BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE indicador_catalogo (
  codigo            VARCHAR(40)  NOT NULL PRIMARY KEY,
  nombre            VARCHAR(200) NOT NULL,
  tipo              ENUM('resultado','estructura','proceso') NOT NULL,
  formula_texto     VARCHAR(500) NULL,
  formula_literal   TEXT NULL,
  definicion        VARCHAR(500) NULL,
  interpretacion    VARCHAR(500) NULL,
  numerador         VARCHAR(200) NULL,
  denominador       VARCHAR(200) NULL,
  factor            DECIMAL(12,2) NULL,
  periodicidad      VARCHAR(20)  NULL,
  derivable         TINYINT(1) NULL,
  norma_codigo      VARCHAR(40)  NOT NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tipo_documental (
  codigo            VARCHAR(60)  NOT NULL PRIMARY KEY,
  nombre            VARCHAR(200) NOT NULL,
  origen_articulo   VARCHAR(60)  NULL,
  retencion         ENUM('segun_tabla_retencion_empresa','20_anios_desde_retiro') NOT NULL,
  requiere_firma    TINYINT(1) NOT NULL DEFAULT 0,
  vigencia_meses    SMALLINT UNSIGNED NULL,
  modulo            VARCHAR(20)  NOT NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE festivo (
  fecha             DATE NOT NULL PRIMARY KEY,
  nombre            VARCHAR(100) NOT NULL,
  trasladado        TINYINT(1) NOT NULL DEFAULT 0,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Roles de la aplicacion (globales; la asignacion es por tenant en usuario_tenant).
CREATE TABLE rol (
  codigo      VARCHAR(30)  NOT NULL PRIMARY KEY,
  nombre      VARCHAR(100) NOT NULL,
  descripcion VARCHAR(255) NULL,
  estado      ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  creado_en   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO rol (codigo, nombre, descripcion) VALUES
  ('admin_tenant',    'Administrador de la empresa', 'Gestiona usuarios y configuracion del tenant'),
  ('responsable_sst', 'Responsable del SG-SST',      'Disena y ejecuta el SG-SST'),
  ('consultor_sst',   'Consultor SST',               'Profesional externo que atiende varias empresas'),
  ('gerente',         'Representante legal',         'Consulta y firma documentos de la alta direccion'),
  ('copasst',         'Miembro de comite',           'Participa en COPASST o Comite de Convivencia'),
  ('trabajador',      'Trabajador',                  'Consulta sus propios registros y firma'),
  ('auditor',         'Auditor',                     'Lectura para auditoria interna o inspeccion');
