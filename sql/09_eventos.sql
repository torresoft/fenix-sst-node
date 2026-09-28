-- M08: incidentes, accidentes de trabajo y enfermedades laborales. Requiere 01 a 08.
-- Sin diagnosticos: de la EL solo se guarda calificacion, entidad y agente de riesgo (Res. 1843 de 2025).

CREATE TABLE evento_criterio_grave (
  codigo            VARCHAR(40)  NOT NULL PRIMARY KEY,
  descripcion       VARCHAR(255) NOT NULL,
  norma_codigo      VARCHAR(40)  NOT NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- requerido_en: variantes (incidente, at_leve, at_grave, at_mortal) en que el rol es obligatorio.
CREATE TABLE investigacion_rol (
  codigo            VARCHAR(40)  NOT NULL PRIMARY KEY,
  nombre            VARCHAR(150) NOT NULL,
  requerido_en      JSON NOT NULL,
  norma_codigo      VARCHAR(40)  NOT NULL,
  estado            ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual TINYINT(1) NOT NULL DEFAULT 0,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por   BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE evento (
  id                        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id                 BIGINT UNSIGNED NOT NULL,
  empresa_id                BIGINT UNSIGNED NOT NULL,
  codigo                    VARCHAR(20) NOT NULL,
  tipo                      ENUM('incidente','accidente','enfermedad') NOT NULL,
  gravedad                  ENUM('leve','grave','mortal') NULL,
  persona_id                BIGINT UNSIGNED NULL,
  centro_trabajo_id         BIGINT UNSIGNED NULL,
  fecha_ocurrencia          DATETIME NULL,
  fecha_diagnostico         DATE NULL,
  fecha_base                DATE NOT NULL,
  lugar                     VARCHAR(255) NULL,
  descripcion               TEXT NOT NULL,
  tipo_lesion               VARCHAR(150) NULL,
  parte_cuerpo              VARCHAR(150) NULL,
  agente_lesion             VARCHAR(150) NULL,
  criterios_grave           JSON NULL,
  dias_incapacidad          INT UNSIGNED NOT NULL DEFAULT 0,
  dias_cargados             INT UNSIGNED NOT NULL DEFAULT 0,
  entidad_calificadora      VARCHAR(150) NULL,
  agente_riesgo             VARCHAR(255) NULL,
  metodologia               VARCHAR(100) NULL,
  conclusiones              TEXT NULL,
  informe_documento_id      BIGINT UNSIGNED NULL,
  investigacion_cerrada_en  DATE NULL,
  observacion               VARCHAR(500) NULL,
  estado                    ENUM('registrado','reportado','investigado','cerrado','anulado') NOT NULL DEFAULT 'registrado',
  creado_por                BIGINT UNSIGNED NULL,
  creado_en                 DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en            DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_codigo (tenant_id, empresa_id, codigo),
  KEY idx_empresa_fecha (tenant_id, empresa_id, fecha_base),
  KEY idx_persona (tenant_id, persona_id),
  CONSTRAINT fk_ev_empresa FOREIGN KEY (tenant_id, empresa_id)           REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_ev_persona FOREIGN KEY (tenant_id, persona_id)           REFERENCES persona (tenant_id, id),
  CONSTRAINT fk_ev_centro  FOREIGN KEY (tenant_id, centro_trabajo_id)    REFERENCES centro_trabajo (tenant_id, id),
  CONSTRAINT fk_ev_informe FOREIGN KEY (tenant_id, informe_documento_id) REFERENCES documento_sst (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Radicaciones: FURAT/FUREL ante ARL, EPS y MinTrabajo; informe de investigacion ante la ARL.
CREATE TABLE evento_reporte (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id        BIGINT UNSIGNED NOT NULL,
  evento_id        BIGINT UNSIGNED NOT NULL,
  entidad          ENUM('ARL','EPS','MINTRABAJO','ARL_INFORME') NOT NULL,
  radicado         VARCHAR(100) NOT NULL,
  fecha_radicacion DATE NOT NULL,
  documento_id     BIGINT UNSIGNED NULL,
  creado_por       BIGINT UNSIGNED NULL,
  creado_en        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_evento_entidad (tenant_id, evento_id, entidad),
  CONSTRAINT fk_er_evento    FOREIGN KEY (tenant_id, evento_id)    REFERENCES evento (tenant_id, id),
  CONSTRAINT fk_er_documento FOREIGN KEY (tenant_id, documento_id) REFERENCES documento_sst (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE evento_investigador (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  evento_id       BIGINT UNSIGNED NOT NULL,
  rol_codigo      VARCHAR(40) NOT NULL,
  usuario_id      BIGINT UNSIGNED NULL,
  nombre          VARCHAR(150) NOT NULL,
  cargo           VARCHAR(150) NULL,
  estado          ENUM('activo','retirado') NOT NULL DEFAULT 'activo',
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_evento (tenant_id, evento_id),
  CONSTRAINT fk_ei_evento  FOREIGN KEY (tenant_id, evento_id) REFERENCES evento (tenant_id, id),
  CONSTRAINT fk_ei_rol     FOREIGN KEY (rol_codigo)           REFERENCES investigacion_rol (codigo),
  CONSTRAINT fk_ei_usuario FOREIGN KEY (usuario_id)           REFERENCES usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Analisis causal: causas inmediatas (actos y condiciones) y basicas (factores personales y del trabajo).
CREATE TABLE evento_causa (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  evento_id       BIGINT UNSIGNED NOT NULL,
  tipo            ENUM('acto_inseguro','condicion_insegura','factor_personal','factor_trabajo') NOT NULL,
  descripcion     VARCHAR(1000) NOT NULL,
  estado          ENUM('activo','retirado') NOT NULL DEFAULT 'activo',
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_evento (tenant_id, evento_id),
  CONSTRAINT fk_ec2_evento FOREIGN KEY (tenant_id, evento_id) REFERENCES evento (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

-- Cerrado o anulado: final. Investigado: los hechos y el analisis quedan congelados.
CREATE TRIGGER trg_evento_bu BEFORE UPDATE ON evento FOR EACH ROW
BEGIN
  IF OLD.estado IN ('cerrado','anulado') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evento cerrado: no admite cambios';
  END IF;
  IF NOT (OLD.tenant_id <=> NEW.tenant_id AND OLD.empresa_id <=> NEW.empresa_id AND OLD.codigo <=> NEW.codigo
      AND OLD.tipo <=> NEW.tipo AND OLD.fecha_base <=> NEW.fecha_base AND OLD.persona_id <=> NEW.persona_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evento: tipo, persona y fecha base son inmutables (anule y registre de nuevo)';
  END IF;
  IF OLD.investigacion_cerrada_en IS NOT NULL AND NOT (OLD.metodologia <=> NEW.metodologia
      AND OLD.conclusiones <=> NEW.conclusiones AND OLD.informe_documento_id <=> NEW.informe_documento_id
      AND OLD.descripcion <=> NEW.descripcion AND OLD.gravedad <=> NEW.gravedad) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evento: la investigacion ya esta cerrada';
  END IF;
END$$

CREATE TRIGGER trg_evento_bd BEFORE DELETE ON evento FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evento no se borra: anule';
END$$

CREATE TRIGGER trg_evento_reporte_bu BEFORE UPDATE ON evento_reporte FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evento_reporte es inmutable';
END$$

CREATE TRIGGER trg_evento_reporte_bd BEFORE DELETE ON evento_reporte FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evento_reporte es inmutable';
END$$

CREATE TRIGGER trg_evento_investigador_bd BEFORE DELETE ON evento_investigador FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evento_investigador no se borra: retire';
END$$

CREATE TRIGGER trg_evento_causa_bd BEFORE DELETE ON evento_causa FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evento_causa no se borra: retire';
END$$

DELIMITER ;
