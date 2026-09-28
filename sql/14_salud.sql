-- M09: salud ocupacional SIN historia clinica (Res. 1843 de 2025). Requiere 01 a 13.
-- Regla dura: no existen columnas de diagnostico, paraclinicos ni resultados clinicos.

CREATE TABLE evaluacion_medica (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  empresa_id        BIGINT UNSIGNED NOT NULL,
  persona_id        BIGINT UNSIGNED NOT NULL,
  tipo              ENUM('ingreso','periodico','egreso','post_incapacidad','reintegro','cambio_ocupacion') NOT NULL,
  ips               VARCHAR(150) NOT NULL,
  fecha_orden       DATE NOT NULL,
  enfasis           VARCHAR(1000) NULL,
  fecha_examen      DATE NULL,
  concepto          ENUM('apto','apto_con_restricciones','no_apto','aplazado') NULL,
  restricciones     VARCHAR(2000) NULL,
  recomendaciones   VARCHAR(2000) NULL,
  proximo_examen    DATE NULL,
  documento_id      BIGINT UNSIGNED NULL,
  observacion       VARCHAR(500) NULL,
  estado            ENUM('ordenada','con_concepto','anulada') NOT NULL DEFAULT 'ordenada',
  creado_por        BIGINT UNSIGNED NULL,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_persona (tenant_id, persona_id, fecha_orden),
  KEY idx_empresa_estado (tenant_id, empresa_id, estado),
  CONSTRAINT fk_em_empresa FOREIGN KEY (tenant_id, empresa_id)   REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_em_persona FOREIGN KEY (tenant_id, persona_id)   REFERENCES persona (tenant_id, id),
  CONSTRAINT fk_em_doc     FOREIGN KEY (tenant_id, documento_id) REFERENCES documento_sst (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Incapacidades para ausentismo: sin diagnostico (solo origen y dias).
CREATE TABLE incapacidad (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  empresa_id      BIGINT UNSIGNED NOT NULL,
  persona_id      BIGINT UNSIGNED NOT NULL,
  origen          ENUM('comun','laboral') NOT NULL,
  fecha_inicio    DATE NOT NULL,
  dias            SMALLINT UNSIGNED NOT NULL,
  prorroga        TINYINT(1) NOT NULL DEFAULT 0,
  evento_id       BIGINT UNSIGNED NULL,
  observacion     VARCHAR(500) NULL,
  estado          ENUM('registrada','anulada') NOT NULL DEFAULT 'registrada',
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_empresa_fecha (tenant_id, empresa_id, fecha_inicio),
  CONSTRAINT fk_inc_empresa FOREIGN KEY (tenant_id, empresa_id) REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_inc_persona FOREIGN KEY (tenant_id, persona_id) REFERENCES persona (tenant_id, id),
  CONSTRAINT fk_inc_evento  FOREIGN KEY (tenant_id, evento_id)  REFERENCES evento (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

-- Con concepto: el resultado queda congelado (una correccion es una evaluacion nueva).
CREATE TRIGGER trg_evaluacion_medica_bu BEFORE UPDATE ON evaluacion_medica FOR EACH ROW
BEGIN
  IF OLD.estado = 'anulada' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evaluacion anulada';
  END IF;
  IF OLD.estado = 'con_concepto' AND NOT (OLD.concepto <=> NEW.concepto AND OLD.restricciones <=> NEW.restricciones
      AND OLD.recomendaciones <=> NEW.recomendaciones AND OLD.fecha_examen <=> NEW.fecha_examen AND OLD.documento_id <=> NEW.documento_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'concepto registrado: no se modifica';
  END IF;
END$$

CREATE TRIGGER trg_evaluacion_medica_bd BEFORE DELETE ON evaluacion_medica FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evaluacion_medica no se borra: anule';
END$$

CREATE TRIGGER trg_incapacidad_bu BEFORE UPDATE ON incapacidad FOR EACH ROW
BEGIN
  IF OLD.estado = 'anulada' OR NOT (OLD.dias <=> NEW.dias AND OLD.fecha_inicio <=> NEW.fecha_inicio AND OLD.origen <=> NEW.origen) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'incapacidad: registre una nueva o anule';
  END IF;
END$$

CREATE TRIGGER trg_incapacidad_bd BEFORE DELETE ON incapacidad FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'incapacidad no se borra: anule';
END$$

DELIMITER ;
