-- M17: convivencia, acoso y salud mental + consentimientos versionados. Requiere 01 a 15.
-- Reserva: hechos y partes de la queja solo los ve el rol 'convivencia' (Res. 3461/2025, D. 1040/2026).

INSERT IGNORE INTO rol (codigo, nombre, descripcion) VALUES
  ('convivencia', 'Comite de Convivencia', 'Tramita quejas con reserva: unico rol que ve hechos y partes');

CREATE TABLE queja_convivencia (
  id                          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id                   BIGINT UNSIGNED NOT NULL,
  empresa_id                  BIGINT UNSIGNED NOT NULL,
  radicado                    VARCHAR(20)  NOT NULL,
  canal                       ENUM('electronico','fisico','verbal') NOT NULL,
  tipo_conducta               ENUM('acoso_laboral','acoso_sexual','violencia','discriminacion','otra') NOT NULL,
  fecha_radicacion            DATE NOT NULL,
  quejoso_persona_id          BIGINT UNSIGNED NULL,
  quejoso_nombre              VARCHAR(150) NULL,
  implicados                  VARCHAR(500) NOT NULL,
  hechos                      TEXT NOT NULL,
  solicita_proteccion         TINYINT(1) NOT NULL DEFAULT 0,
  fecha_solicitud_proteccion  DATE NULL,
  resultado                   ENUM('acuerdo_conciliatorio','sin_acuerdo_remitida','desistimiento','no_competencia') NULL,
  fecha_cierre                DATE NULL,
  motivo_estado               VARCHAR(500) NULL,
  estado                      ENUM('radicada','en_tramite','cerrada','anulada') NOT NULL DEFAULT 'radicada',
  creado_por                  BIGINT UNSIGNED NULL,
  creado_en                   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en              DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_radicado (tenant_id, empresa_id, radicado),
  KEY idx_empresa_estado (tenant_id, empresa_id, estado),
  CONSTRAINT fk_qc_empresa FOREIGN KEY (tenant_id, empresa_id)         REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_qc_persona FOREIGN KEY (tenant_id, quejoso_persona_id) REFERENCES persona (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bitacora del tramite: append-only. Sin adjuntos en el gestor documental: romperia la reserva.
CREATE TABLE queja_actuacion (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id      BIGINT UNSIGNED NOT NULL,
  queja_id       BIGINT UNSIGNED NOT NULL,
  tipo           ENUM('citacion','reunion','audiencia','acuerdo','medida_proteccion','seguimiento','remision','cierre','anotacion') NOT NULL,
  fecha          DATE NOT NULL,
  descripcion    TEXT NOT NULL,
  creado_por     BIGINT UNSIGNED NULL,
  creado_en      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_queja (tenant_id, queja_id, fecha),
  CONSTRAINT fk_qa_queja FOREIGN KEY (tenant_id, queja_id) REFERENCES queja_convivencia (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bateria psicosocial: solo el consolidado. Los individuales quedan con el psicologo (Res. 2764/2022).
CREATE TABLE evaluacion_psicosocial (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id           BIGINT UNSIGNED NOT NULL,
  empresa_id          BIGINT UNSIGNED NOT NULL,
  fecha_aplicacion    DATE NOT NULL,
  psicologo_nombre    VARCHAR(150) NOT NULL,
  psicologo_licencia  VARCHAR(60)  NOT NULL,
  poblacion           INT UNSIGNED NOT NULL,
  evaluados           INT UNSIGNED NOT NULL,
  nivel_general       ENUM('sin_riesgo','bajo','medio','alto','muy_alto') NOT NULL,
  documento_id        BIGINT UNSIGNED NOT NULL,
  proxima             DATE NOT NULL,
  motivo_estado       VARCHAR(500) NULL,
  estado              ENUM('vigente','reemplazada','anulada') NOT NULL DEFAULT 'vigente',
  creado_por          BIGINT UNSIGNED NULL,
  creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en      DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_empresa (tenant_id, empresa_id, fecha_aplicacion),
  CONSTRAINT fk_ep_empresa FOREIGN KEY (tenant_id, empresa_id)   REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_ep_doc     FOREIGN KEY (tenant_id, documento_id) REFERENCES documento_sst (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE evaluacion_psicosocial_grupo (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  evaluacion_id   BIGINT UNSIGNED NOT NULL,
  grupo           VARCHAR(120) NOT NULL,
  evaluados       INT UNSIGNED NOT NULL,
  intralaboral    ENUM('sin_riesgo','bajo','medio','alto','muy_alto') NOT NULL,
  extralaboral    ENUM('sin_riesgo','bajo','medio','alto','muy_alto') NOT NULL,
  estres          ENUM('sin_riesgo','bajo','medio','alto','muy_alto') NOT NULL,
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_grupo (tenant_id, evaluacion_id, grupo),
  CONSTRAINT fk_epg_eval FOREIGN KEY (tenant_id, evaluacion_id) REFERENCES evaluacion_psicosocial (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Finalidades del tratamiento de datos (catalogo global versionado).
CREATE TABLE finalidad_datos (
  codigo             VARCHAR(40)  NOT NULL PRIMARY KEY,
  nombre             VARCHAR(150) NOT NULL,
  es_dato_sensible   TINYINT(1)   NOT NULL,
  norma_codigo       VARCHAR(40)  NOT NULL,
  version            VARCHAR(20)  NOT NULL,
  texto              TEXT NOT NULL,
  estado             ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual  TINYINT(1) NOT NULL DEFAULT 0,
  creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por    BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE consentimiento
  ADD COLUMN documento_id BIGINT UNSIGNED NULL AFTER medio,
  ADD CONSTRAINT fk_cons_doc FOREIGN KEY (tenant_id, documento_id) REFERENCES documento_sst (tenant_id, id);

DELIMITER $$

-- Radicado, fecha, canal, hechos y partes no cambian; cerrada o anulada queda congelada.
CREATE TRIGGER trg_queja_convivencia_bu BEFORE UPDATE ON queja_convivencia FOR EACH ROW
BEGIN
  IF OLD.estado IN ('cerrada','anulada') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'queja cerrada o anulada: no se modifica';
  END IF;
  IF NOT (OLD.radicado <=> NEW.radicado AND OLD.canal <=> NEW.canal AND OLD.tipo_conducta <=> NEW.tipo_conducta
      AND OLD.fecha_radicacion <=> NEW.fecha_radicacion AND OLD.quejoso_persona_id <=> NEW.quejoso_persona_id
      AND OLD.quejoso_nombre <=> NEW.quejoso_nombre AND OLD.implicados <=> NEW.implicados AND OLD.hechos <=> NEW.hechos) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'queja radicada: registre una actuacion';
  END IF;
END$$

CREATE TRIGGER trg_queja_convivencia_bd BEFORE DELETE ON queja_convivencia FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'queja_convivencia no se borra: anule';
END$$

CREATE TRIGGER trg_queja_actuacion_bu BEFORE UPDATE ON queja_actuacion FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'queja_actuacion es inmutable';
END$$

CREATE TRIGGER trg_queja_actuacion_bd BEFORE DELETE ON queja_actuacion FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'queja_actuacion es inmutable';
END$$

-- Solo cambia el estado (reemplazo o anulacion).
CREATE TRIGGER trg_evaluacion_psicosocial_bu BEFORE UPDATE ON evaluacion_psicosocial FOR EACH ROW
BEGIN
  IF OLD.estado <> 'vigente' OR NOT (OLD.fecha_aplicacion <=> NEW.fecha_aplicacion AND OLD.evaluados <=> NEW.evaluados
      AND OLD.poblacion <=> NEW.poblacion AND OLD.nivel_general <=> NEW.nivel_general AND OLD.documento_id <=> NEW.documento_id
      AND OLD.proxima <=> NEW.proxima) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evaluacion psicosocial: registre una nueva o anule';
  END IF;
END$$

CREATE TRIGGER trg_evaluacion_psicosocial_bd BEFORE DELETE ON evaluacion_psicosocial FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evaluacion_psicosocial no se borra: anule';
END$$

CREATE TRIGGER trg_evaluacion_psicosocial_grupo_bu BEFORE UPDATE ON evaluacion_psicosocial_grupo FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evaluacion_psicosocial_grupo es inmutable';
END$$

CREATE TRIGGER trg_evaluacion_psicosocial_grupo_bd BEFORE DELETE ON evaluacion_psicosocial_grupo FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'evaluacion_psicosocial_grupo es inmutable';
END$$

DELIMITER ;
