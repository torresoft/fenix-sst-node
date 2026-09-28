-- Autoevaluacion de estandares minimos (M11) y plan de mejoramiento (CAPA). Requiere 01 a 05.

-- Fecha de cargue en sgrl.mintrabajo.gov.co por vigencia: la fija una circular cada anio.
CREATE TABLE estandar_cargue (
  vigencia_anio     SMALLINT UNSIGNED NOT NULL PRIMARY KEY,
  fecha_limite      DATE NOT NULL,
  norma_codigo      VARCHAR(40)  NOT NULL,
  url               VARCHAR(255) NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Historial de clasificacion (conjunto 3/7/21/60). Una fila nueva por cada reclasificacion.
CREATE TABLE empresa_clasificacion (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  empresa_id        BIGINT UNSIGNED NOT NULL,
  conjunto_codigo   VARCHAR(20) NOT NULL,
  conjunto_anterior VARCHAR(20) NULL,
  trabajadores      INT UNSIGNED NOT NULL,
  nivel_riesgo      TINYINT UNSIGNED NOT NULL,
  es_agropecuaria   TINYINT(1) NOT NULL,
  revisado_por      BIGINT UNSIGNED NULL,
  revisado_en       DATETIME NULL,
  estado            ENUM('pendiente','revisada') NOT NULL DEFAULT 'pendiente',
  creado_por        BIGINT UNSIGNED NULL,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_empresa (tenant_id, empresa_id, id),
  CONSTRAINT fk_ec_empresa  FOREIGN KEY (tenant_id, empresa_id) REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_ec_conjunto FOREIGN KEY (conjunto_codigo)       REFERENCES estandar_conjunto (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Documento que soporta un numeral de la tabla de valores. Persiste entre vigencias.
CREATE TABLE evidencia_estandar (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  empresa_id      BIGINT UNSIGNED NOT NULL,
  numeral         VARCHAR(20) NOT NULL,
  documento_id    BIGINT UNSIGNED NOT NULL,
  estado          ENUM('activo','retirado') NOT NULL DEFAULT 'activo',
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_numeral_documento (tenant_id, empresa_id, numeral, documento_id),
  CONSTRAINT fk_ee_empresa   FOREIGN KEY (tenant_id, empresa_id)   REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_ee_documento FOREIGN KEY (tenant_id, documento_id) REFERENCES documento_sst (tenant_id, id),
  CONSTRAINT fk_ee_numeral   FOREIGN KEY (numeral)                 REFERENCES estandar_minimo (numeral)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Autoevaluacion por vigencia. En borrador se calcula en vivo; al cerrar se congela el resultado
-- con hash SHA-256. Una correccion es una version nueva (la anterior queda 'reemplazada').
CREATE TABLE autoevaluacion (
  id                       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id                BIGINT UNSIGNED NOT NULL,
  empresa_id               BIGINT UNSIGNED NOT NULL,
  vigencia_anio            SMALLINT UNSIGNED NOT NULL,
  version                  INT UNSIGNED NOT NULL DEFAULT 1,
  autoevaluacion_padre_id  BIGINT UNSIGNED NULL,
  conjunto_codigo          VARCHAR(20) NOT NULL,
  trabajadores             INT UNSIGNED NOT NULL,
  nivel_riesgo             TINYINT UNSIGNED NOT NULL,
  fecha_corte              DATE NOT NULL,
  puntaje                  DECIMAL(5,2) NULL,
  valoracion               VARCHAR(40) NULL,
  resumen                  JSON NULL,
  hash_resultado           CHAR(64) NULL,
  cerrada_por              BIGINT UNSIGNED NULL,
  cerrada_en               DATETIME NULL,
  estado                   ENUM('borrador','cerrada','reemplazada','anulada') NOT NULL DEFAULT 'borrador',
  creado_por               BIGINT UNSIGNED NULL,
  creado_en                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en           DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_vigencia_version (tenant_id, empresa_id, vigencia_anio, version),
  KEY idx_empresa_estado (tenant_id, empresa_id, estado),
  CONSTRAINT fk_ae_empresa  FOREIGN KEY (tenant_id, empresa_id)              REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_ae_padre    FOREIGN KEY (tenant_id, autoevaluacion_padre_id) REFERENCES autoevaluacion (tenant_id, id),
  CONSTRAINT fk_ae_conjunto FOREIGN KEY (conjunto_codigo)                    REFERENCES estandar_conjunto (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Un item por numeral. En borrador guarda la justificacion de no aplica; al cerrar, el resultado.
CREATE TABLE autoevaluacion_item (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id           BIGINT UNSIGNED NOT NULL,
  autoevaluacion_id   BIGINT UNSIGNED NOT NULL,
  numeral             VARCHAR(20) NOT NULL,
  aplica_conjunto     TINYINT(1) NOT NULL,
  no_aplica_justificado TINYINT(1) NOT NULL DEFAULT 0,
  justificacion       VARCHAR(1000) NULL,
  resultado           ENUM('pendiente','cumple','no_cumple','no_aplica') NOT NULL DEFAULT 'pendiente',
  motivo              VARCHAR(40) NULL,
  peso                DECIMAL(5,2) NOT NULL,
  puntaje             DECIMAL(5,2) NULL,
  evidencias          JSON NULL,
  creado_por          BIGINT UNSIGNED NULL,
  creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en      DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_autoeval_numeral (tenant_id, autoevaluacion_id, numeral),
  CONSTRAINT fk_ai_autoeval FOREIGN KEY (tenant_id, autoevaluacion_id) REFERENCES autoevaluacion (tenant_id, id),
  CONSTRAINT fk_ai_numeral  FOREIGN KEY (numeral)                      REFERENCES estandar_minimo (numeral)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CAPA: una sola tabla de acciones correctivas y preventivas para todos los origenes.
CREATE TABLE accion_mejora (
  id                      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id               BIGINT UNSIGNED NOT NULL,
  empresa_id              BIGINT UNSIGNED NOT NULL,
  origen                  ENUM('autoevaluacion','auditoria','evento','inspeccion','revision_direccion') NOT NULL,
  origen_id               BIGINT UNSIGNED NOT NULL,
  referencia              VARCHAR(60)  NULL,
  descripcion             VARCHAR(1000) NOT NULL,
  tipo                    ENUM('correctiva','preventiva','mejora') NOT NULL DEFAULT 'correctiva',
  responsable_id          BIGINT UNSIGNED NULL,
  fecha_limite            DATE NOT NULL,
  fecha_cierre            DATE NULL,
  evidencia_documento_id  BIGINT UNSIGNED NULL,
  observacion_cierre      VARCHAR(1000) NULL,
  estado                  ENUM('abierta','cerrada','anulada') NOT NULL DEFAULT 'abierta',
  creado_por              BIGINT UNSIGNED NULL,
  creado_en               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en          DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_origen_referencia (tenant_id, origen, origen_id, referencia),
  KEY idx_empresa_estado (tenant_id, empresa_id, estado, fecha_limite),
  CONSTRAINT fk_am2_empresa     FOREIGN KEY (tenant_id, empresa_id)             REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_am2_evidencia   FOREIGN KEY (tenant_id, evidencia_documento_id) REFERENCES documento_sst (tenant_id, id),
  CONSTRAINT fk_am2_responsable FOREIGN KEY (responsable_id)                    REFERENCES usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

-- Cerrada: solo puede pasar a reemplazada o anulada. Reemplazada/anulada: finales.
CREATE TRIGGER trg_autoevaluacion_bu BEFORE UPDATE ON autoevaluacion FOR EACH ROW
BEGIN
  IF OLD.estado IN ('reemplazada','anulada') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'autoevaluacion cerrada definitivamente';
  END IF;
  IF OLD.estado = 'cerrada' AND NOT (
        NEW.estado IN ('reemplazada','anulada')
    AND OLD.puntaje <=> NEW.puntaje AND OLD.valoracion <=> NEW.valoracion
    AND OLD.hash_resultado <=> NEW.hash_resultado AND OLD.resumen <=> NEW.resumen
    AND OLD.fecha_corte <=> NEW.fecha_corte AND OLD.conjunto_codigo <=> NEW.conjunto_codigo
    AND OLD.cerrada_en <=> NEW.cerrada_en) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'autoevaluacion cerrada: cree una version nueva';
  END IF;
END$$

CREATE TRIGGER trg_autoevaluacion_bd BEFORE DELETE ON autoevaluacion FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'autoevaluacion no se borra: anule o versione';
END$$

CREATE TRIGGER trg_autoevaluacion_item_bu BEFORE UPDATE ON autoevaluacion_item FOR EACH ROW
BEGIN
  IF (SELECT estado FROM autoevaluacion WHERE id = OLD.autoevaluacion_id) <> 'borrador' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'autoevaluacion_item de una autoevaluacion cerrada';
  END IF;
END$$

CREATE TRIGGER trg_autoevaluacion_item_bd BEFORE DELETE ON autoevaluacion_item FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'autoevaluacion_item no se borra';
END$$

CREATE TRIGGER trg_accion_mejora_bu BEFORE UPDATE ON accion_mejora FOR EACH ROW
BEGIN
  IF OLD.estado IN ('cerrada','anulada') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'accion_mejora cerrada: no admite cambios';
  END IF;
END$$

CREATE TRIGGER trg_accion_mejora_bd BEFORE DELETE ON accion_mejora FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'accion_mejora no se borra: anule';
END$$

CREATE TRIGGER trg_evidencia_estandar_bd BEFORE DELETE ON evidencia_estandar FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evidencia_estandar no se borra: retire';
END$$

CREATE TRIGGER trg_empresa_clasificacion_bd BEFORE DELETE ON empresa_clasificacion FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'empresa_clasificacion no se borra';
END$$

DELIMITER ;
