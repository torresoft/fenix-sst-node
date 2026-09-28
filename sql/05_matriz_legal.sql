-- Matriz legal por empresa, auditor y boletin de cambios normativos. Requiere 01 a 04.

ALTER TABLE norma
  ADD COLUMN impacto_derogacion VARCHAR(500) NULL AFTER derogada_por;

-- Referencias falsas o mal atribuidas que circulan (p. ej. "Decreto 0312 de 2026").
CREATE TABLE norma_desinformacion (
  codigo            VARCHAR(40)  NOT NULL PRIMARY KEY,
  referencia        VARCHAR(150) NOT NULL,
  explicacion       VARCHAR(500) NOT NULL,
  norma_correcta    VARCHAR(40)  NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Ambitos de aplicabilidad (valores de norma.ambito). regla_activacion: JSON
-- [{campo, operador, valor}] sobre columnas de empresa; basta con que se cumpla una.
CREATE TABLE ambito_normativo (
  codigo            VARCHAR(40)  NOT NULL PRIMARY KEY,
  nombre            VARCHAR(100) NOT NULL,
  descripcion       VARCHAR(255) NULL,
  es_general        TINYINT(1) NOT NULL DEFAULT 0,
  declarable        TINYINT(1) NOT NULL DEFAULT 1,
  regla_activacion  JSON NULL,
  norma_codigo      VARCHAR(40)  NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cambios del catalogo normativo global (los genera la carga de catalogos). Append-only.
CREATE TABLE boletin_normativo (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  norma_codigo     VARCHAR(40)  NOT NULL,
  tipo_cambio      ENUM('nueva','cambio_estado') NOT NULL,
  estado_anterior  VARCHAR(30)  NULL,
  estado_nuevo     VARCHAR(30)  NOT NULL,
  detalle          VARCHAR(500) NULL,
  publicado_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_publicado (publicado_en),
  KEY idx_norma (norma_codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Estado de cumplimiento de cada norma en la matriz de una empresa.
CREATE TABLE matriz_legal_item (
  id                   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id            BIGINT UNSIGNED NOT NULL,
  empresa_id           BIGINT UNSIGNED NOT NULL,
  norma_codigo         VARCHAR(40)  NOT NULL,
  estado_cumplimiento  ENUM('sin_evaluar','cumple','cumple_parcial','no_cumple') NOT NULL DEFAULT 'sin_evaluar',
  responsable_id       BIGINT UNSIGNED NULL,
  observacion          VARCHAR(1000) NULL,
  evaluado_por         BIGINT UNSIGNED NULL,
  evaluado_en          DATETIME NULL,
  estado               ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  creado_por           BIGINT UNSIGNED NULL,
  creado_en            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en       DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_empresa_norma (tenant_id, empresa_id, norma_codigo),
  CONSTRAINT fk_mli_empresa     FOREIGN KEY (tenant_id, empresa_id) REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_mli_norma       FOREIGN KEY (norma_codigo)          REFERENCES norma (codigo),
  CONSTRAINT fk_mli_responsable FOREIGN KEY (responsable_id)        REFERENCES usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Evidencia de cumplimiento: documentos del SG-SST. Se retira (estado), no se borra.
CREATE TABLE matriz_legal_evidencia (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  item_id         BIGINT UNSIGNED NOT NULL,
  documento_id    BIGINT UNSIGNED NOT NULL,
  estado          ENUM('activo','retirado') NOT NULL DEFAULT 'activo',
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_item_documento (tenant_id, item_id, documento_id),
  CONSTRAINT fk_mle_item      FOREIGN KEY (tenant_id, item_id)      REFERENCES matriz_legal_item (tenant_id, id),
  CONSTRAINT fk_mle_documento FOREIGN KEY (tenant_id, documento_id) REFERENCES documento_sst (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Normas citadas por un documento (lo alimenta el gestor documental). Permite avisar que
-- documentos quedan afectados cuando una norma cambia.
CREATE TABLE documento_norma (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  documento_id    BIGINT UNSIGNED NOT NULL,
  norma_codigo    VARCHAR(40) NOT NULL,
  estado          ENUM('activo','retirado') NOT NULL DEFAULT 'activo',
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_documento_norma (tenant_id, documento_id, norma_codigo),
  KEY idx_norma (tenant_id, norma_codigo),
  CONSTRAINT fk_dn_documento FOREIGN KEY (tenant_id, documento_id) REFERENCES documento_sst (tenant_id, id),
  CONSTRAINT fk_dn_norma     FOREIGN KEY (norma_codigo)            REFERENCES norma (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Boletin propagado a cada empresa afectada. Pendiente = matriz desactualizada.
CREATE TABLE boletin_empresa (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  empresa_id      BIGINT UNSIGNED NOT NULL,
  boletin_id      BIGINT UNSIGNED NOT NULL,
  motivo          JSON NOT NULL,
  observacion     VARCHAR(500) NULL,
  revisado_por    BIGINT UNSIGNED NULL,
  revisado_en     DATETIME NULL,
  estado          ENUM('pendiente','revisado') NOT NULL DEFAULT 'pendiente',
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_empresa_boletin (tenant_id, empresa_id, boletin_id),
  KEY idx_pendientes (tenant_id, empresa_id, estado),
  CONSTRAINT fk_be_empresa FOREIGN KEY (tenant_id, empresa_id) REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_be_boletin FOREIGN KEY (boletin_id)            REFERENCES boletin_normativo (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cada corrida del auditor es un registro inmutable: entrada original + resultado.
CREATE TABLE auditoria_matriz (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id             BIGINT UNSIGNED NOT NULL,
  empresa_id            BIGINT UNSIGNED NOT NULL,
  fuente                ENUM('csv','manual') NOT NULL,
  nombre_archivo        VARCHAR(255) NULL,
  texto_original        MEDIUMTEXT NOT NULL,
  ambitos_evaluados     JSON NOT NULL,
  total_declaradas      INT UNSIGNED NOT NULL,
  total_derogadas       INT UNSIGNED NOT NULL,
  total_desinformacion  INT UNSIGNED NOT NULL,
  total_no_reconocidas  INT UNSIGNED NOT NULL,
  total_faltantes       INT UNSIGNED NOT NULL,
  total_no_aplican      INT UNSIGNED NOT NULL,
  total_correctas       INT UNSIGNED NOT NULL,
  cobertura             DECIMAL(5,2) NOT NULL,
  resultado             JSON NOT NULL,
  corte_catalogo        VARCHAR(20) NULL,
  creado_por            BIGINT UNSIGNED NULL,
  creado_en             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_empresa_fecha (tenant_id, empresa_id, creado_en),
  CONSTRAINT fk_am_empresa FOREIGN KEY (tenant_id, empresa_id) REFERENCES empresa (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

CREATE TRIGGER trg_boletin_normativo_bu BEFORE UPDATE ON boletin_normativo FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'boletin_normativo es append-only';
END$$

CREATE TRIGGER trg_boletin_normativo_bd BEFORE DELETE ON boletin_normativo FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'boletin_normativo es append-only';
END$$

CREATE TRIGGER trg_auditoria_matriz_bu BEFORE UPDATE ON auditoria_matriz FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'auditoria_matriz es inmutable';
END$$

CREATE TRIGGER trg_auditoria_matriz_bd BEFORE DELETE ON auditoria_matriz FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'auditoria_matriz es inmutable';
END$$

-- Un boletin revisado queda cerrado.
CREATE TRIGGER trg_boletin_empresa_bu BEFORE UPDATE ON boletin_empresa FOR EACH ROW
BEGIN
  IF OLD.estado = 'revisado' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'boletin_empresa revisado: no admite cambios';
  END IF;
END$$

CREATE TRIGGER trg_boletin_empresa_bd BEFORE DELETE ON boletin_empresa FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'boletin_empresa no se borra';
END$$

CREATE TRIGGER trg_matriz_legal_evidencia_bd BEFORE DELETE ON matriz_legal_evidencia FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evidencia no se borra: retire';
END$$

CREATE TRIGGER trg_matriz_legal_item_bd BEFORE DELETE ON matriz_legal_item FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'matriz_legal_item no se borra: inactive';
END$$

DELIMITER ;
