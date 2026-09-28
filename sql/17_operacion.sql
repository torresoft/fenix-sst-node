-- F5: M13 emergencias, M14 inspecciones y EPP, M15 permisos de alto riesgo, M16 contratistas. Requiere 01 a 16.

ALTER TABLE accion_mejora
  MODIFY origen ENUM('autoevaluacion','auditoria','evento','inspeccion','revision_direccion','simulacro','contratista','permiso') NOT NULL;

-- ---------- Catalogos globales ----------

CREATE TABLE equipo_tipo (
  codigo             VARCHAR(30)  NOT NULL PRIMARY KEY,
  nombre             VARCHAR(150) NOT NULL,
  meses_vigencia     SMALLINT UNSIGNED NOT NULL,
  estado             ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual  TINYINT(1) NOT NULL DEFAULT 0,
  creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por    BIGINT UNSIGNED NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE permiso_tipo (
  codigo              VARCHAR(30)  NOT NULL PRIMARY KEY,
  nombre              VARCHAR(150) NOT NULL,
  competencia_codigo  VARCHAR(30)  NULL,
  norma_codigo        VARCHAR(40)  NOT NULL,
  documento_tipo      VARCHAR(40)  NULL,
  verificaciones      JSON NOT NULL,
  estado              ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  modificado_manual   TINYINT(1) NOT NULL DEFAULT 0,
  creado_en           DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en      DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  actualizado_por     BIGINT UNSIGNED NULL,
  CONSTRAINT fk_ptipo_comp FOREIGN KEY (competencia_codigo) REFERENCES competencia_tipo (codigo),
  CONSTRAINT fk_ptipo_doc  FOREIGN KEY (documento_tipo)     REFERENCES tipo_documental (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- M13 Emergencias ----------

CREATE TABLE brigada_miembro (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id          BIGINT UNSIGNED NOT NULL,
  empresa_id         BIGINT UNSIGNED NOT NULL,
  persona_id         BIGINT UNSIGNED NOT NULL,
  rol                ENUM('jefe','primeros_auxilios','evacuacion','contra_incendio','comunicaciones') NOT NULL,
  fecha_designacion  DATE NOT NULL,
  fecha_retiro       DATE NULL,
  estado             ENUM('activo','retirado') NOT NULL DEFAULT 'activo',
  creado_por         BIGINT UNSIGNED NULL,
  creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_empresa (tenant_id, empresa_id, estado),
  CONSTRAINT fk_bm_empresa FOREIGN KEY (tenant_id, empresa_id) REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_bm_persona FOREIGN KEY (tenant_id, persona_id) REFERENCES persona (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE equipo_emergencia (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id          BIGINT UNSIGNED NOT NULL,
  empresa_id         BIGINT UNSIGNED NOT NULL,
  centro_trabajo_id  BIGINT UNSIGNED NULL,
  tipo_codigo        VARCHAR(30)  NOT NULL,
  codigo             VARCHAR(40)  NOT NULL,
  ubicacion          VARCHAR(150) NOT NULL,
  capacidad          VARCHAR(60)  NULL,
  fecha_vence        DATE NOT NULL,
  motivo_estado      VARCHAR(500) NULL,
  estado             ENUM('activo','baja') NOT NULL DEFAULT 'activo',
  creado_por         BIGINT UNSIGNED NULL,
  creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_codigo (tenant_id, empresa_id, codigo),
  KEY idx_vence (tenant_id, empresa_id, estado, fecha_vence),
  CONSTRAINT fk_eqe_empresa FOREIGN KEY (tenant_id, empresa_id)        REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_eqe_centro  FOREIGN KEY (tenant_id, centro_trabajo_id) REFERENCES centro_trabajo (tenant_id, id),
  CONSTRAINT fk_eqe_tipo    FOREIGN KEY (tipo_codigo)                  REFERENCES equipo_tipo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE equipo_revision (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id          BIGINT UNSIGNED NOT NULL,
  equipo_id          BIGINT UNSIGNED NOT NULL,
  fecha              DATE NOT NULL,
  tipo               ENUM('inspeccion','recarga','mantenimiento','reposicion') NOT NULL,
  resultado          ENUM('conforme','no_conforme') NOT NULL,
  nueva_fecha_vence  DATE NULL,
  observacion        VARCHAR(1000) NULL,
  creado_por         BIGINT UNSIGNED NULL,
  creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_equipo (tenant_id, equipo_id, fecha),
  CONSTRAINT fk_eqr_equipo FOREIGN KEY (tenant_id, equipo_id) REFERENCES equipo_emergencia (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE simulacro (
  id                      BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id               BIGINT UNSIGNED NOT NULL,
  empresa_id              BIGINT UNSIGNED NOT NULL,
  centro_trabajo_id       BIGINT UNSIGNED NULL,
  fecha                   DATE NOT NULL,
  amenaza                 VARCHAR(150) NOT NULL,
  alcance                 ENUM('parcial','total') NOT NULL,
  anunciado               TINYINT(1) NOT NULL DEFAULT 1,
  participantes           INT UNSIGNED NOT NULL,
  tiempo_respuesta_seg    INT UNSIGNED NULL,
  tiempo_evacuacion_seg   INT UNSIGNED NULL,
  fortalezas              TEXT NULL,
  oportunidades           TEXT NULL,
  documento_id            BIGINT UNSIGNED NULL,
  motivo_estado           VARCHAR(500) NULL,
  estado                  ENUM('registrado','anulado') NOT NULL DEFAULT 'registrado',
  creado_por              BIGINT UNSIGNED NULL,
  creado_en               DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en          DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_empresa (tenant_id, empresa_id, fecha),
  CONSTRAINT fk_sim_empresa FOREIGN KEY (tenant_id, empresa_id)        REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_sim_centro  FOREIGN KEY (tenant_id, centro_trabajo_id) REFERENCES centro_trabajo (tenant_id, id),
  CONSTRAINT fk_sim_doc     FOREIGN KEY (tenant_id, documento_id)      REFERENCES documento_sst (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- M14 Inspecciones y EPP ----------

CREATE TABLE inspeccion (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id          BIGINT UNSIGNED NOT NULL,
  empresa_id         BIGINT UNSIGNED NOT NULL,
  centro_trabajo_id  BIGINT UNSIGNED NULL,
  tipo               ENUM('locativa','equipos','herramientas','epp','emergencias','orden_aseo','otra') NOT NULL,
  area               VARCHAR(150) NOT NULL,
  fecha_programada   DATE NOT NULL,
  fecha_realizada    DATE NULL,
  inspector          VARCHAR(150) NULL,
  con_copasst        TINYINT(1) NOT NULL DEFAULT 0,
  resumen            TEXT NULL,
  documento_id       BIGINT UNSIGNED NULL,
  motivo_estado      VARCHAR(500) NULL,
  estado             ENUM('programada','realizada','anulada') NOT NULL DEFAULT 'programada',
  creado_por         BIGINT UNSIGNED NULL,
  creado_en          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en     DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_empresa (tenant_id, empresa_id, estado, fecha_programada),
  CONSTRAINT fk_insp_empresa FOREIGN KEY (tenant_id, empresa_id)        REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_insp_centro  FOREIGN KEY (tenant_id, centro_trabajo_id) REFERENCES centro_trabajo (tenant_id, id),
  CONSTRAINT fk_insp_doc     FOREIGN KEY (tenant_id, documento_id)      REFERENCES documento_sst (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE inspeccion_hallazgo (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  inspeccion_id     BIGINT UNSIGNED NOT NULL,
  numero            SMALLINT UNSIGNED NOT NULL,
  descripcion       VARCHAR(1000) NOT NULL,
  nivel             ENUM('bajo','medio','alto') NOT NULL,
  accion_mejora_id  BIGINT UNSIGNED NULL,
  creado_por        BIGINT UNSIGNED NULL,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_numero (tenant_id, inspeccion_id, numero),
  CONSTRAINT fk_ih_insp   FOREIGN KEY (tenant_id, inspeccion_id)    REFERENCES inspeccion (tenant_id, id),
  CONSTRAINT fk_ih_accion FOREIGN KEY (tenant_id, accion_mejora_id) REFERENCES accion_mejora (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE epp_elemento (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id        BIGINT UNSIGNED NOT NULL,
  empresa_id       BIGINT UNSIGNED NOT NULL,
  nombre           VARCHAR(150) NOT NULL,
  especificacion   VARCHAR(300) NULL,
  vida_util_dias   INT UNSIGNED NULL,
  estado           ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  creado_por       BIGINT UNSIGNED NULL,
  creado_en        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en   DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_nombre (tenant_id, empresa_id, nombre),
  CONSTRAINT fk_eppe_empresa FOREIGN KEY (tenant_id, empresa_id) REFERENCES empresa (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cargo_epp (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  cargo_id        BIGINT UNSIGNED NOT NULL,
  elemento_id     BIGINT UNSIGNED NOT NULL,
  cantidad        SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  estado          ENUM('activo','retirado') NOT NULL DEFAULT 'activo',
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_cargo_elemento (tenant_id, cargo_id, elemento_id),
  CONSTRAINT fk_ce_cargo    FOREIGN KEY (tenant_id, cargo_id)    REFERENCES cargo (tenant_id, id),
  CONSTRAINT fk_ce_elemento FOREIGN KEY (tenant_id, elemento_id) REFERENCES epp_elemento (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE epp_ingreso (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  elemento_id     BIGINT UNSIGNED NOT NULL,
  fecha           DATE NOT NULL,
  cantidad        INT UNSIGNED NOT NULL,
  proveedor       VARCHAR(150) NULL,
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  CONSTRAINT fk_eppi_elemento FOREIGN KEY (tenant_id, elemento_id) REFERENCES epp_elemento (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Entrega individual: se conserva 20 anios. Firma electronica del trabajador o planilla manuscrita.
CREATE TABLE epp_entrega (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  empresa_id        BIGINT UNSIGNED NOT NULL,
  persona_id        BIGINT UNSIGNED NOT NULL,
  elemento_id       BIGINT UNSIGNED NOT NULL,
  cantidad          SMALLINT UNSIGNED NOT NULL,
  fecha             DATE NOT NULL,
  motivo            ENUM('dotacion_inicial','reposicion','perdida','danio','cambio_talla') NOT NULL,
  fecha_reposicion  DATE NULL,
  modalidad         ENUM('electronica','manuscrita') NOT NULL,
  documento_id      BIGINT UNSIGNED NULL,
  motivo_estado     VARCHAR(500) NULL,
  estado            ENUM('pendiente_firma','entregada','anulada') NOT NULL,
  creado_por        BIGINT UNSIGNED NULL,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_persona (tenant_id, persona_id, elemento_id, fecha),
  CONSTRAINT fk_eent_empresa  FOREIGN KEY (tenant_id, empresa_id)   REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_eent_persona  FOREIGN KEY (tenant_id, persona_id)   REFERENCES persona (tenant_id, id),
  CONSTRAINT fk_eent_elemento FOREIGN KEY (tenant_id, elemento_id)  REFERENCES epp_elemento (tenant_id, id),
  CONSTRAINT fk_eent_doc      FOREIGN KEY (tenant_id, documento_id) REFERENCES documento_sst (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- M15 Permisos de alto riesgo ----------

CREATE TABLE permiso_trabajo (
  id                   BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id            BIGINT UNSIGNED NOT NULL,
  empresa_id           BIGINT UNSIGNED NOT NULL,
  centro_trabajo_id    BIGINT UNSIGNED NULL,
  tipo_codigo          VARCHAR(30)  NOT NULL,
  numero               VARCHAR(20)  NOT NULL,
  fecha                DATE NOT NULL,
  hora_inicio          TIME NOT NULL,
  hora_fin             TIME NOT NULL,
  lugar                VARCHAR(200) NOT NULL,
  tarea                TEXT NOT NULL,
  ats                  TEXT NOT NULL,
  verificaciones       JSON NOT NULL,
  supervisor           VARCHAR(150) NOT NULL,
  documento_id         BIGINT UNSIGNED NULL,
  cierre_observacion   VARCHAR(1000) NULL,
  cerrado_en           DATETIME NULL,
  estado               ENUM('emitido','cerrado','suspendido','anulado') NOT NULL DEFAULT 'emitido',
  creado_por           BIGINT UNSIGNED NULL,
  creado_en            DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en       DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_numero (tenant_id, empresa_id, numero),
  KEY idx_empresa (tenant_id, empresa_id, fecha),
  CONSTRAINT fk_pt_empresa FOREIGN KEY (tenant_id, empresa_id)        REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_pt_centro  FOREIGN KEY (tenant_id, centro_trabajo_id) REFERENCES centro_trabajo (tenant_id, id),
  CONSTRAINT fk_pt_tipo    FOREIGN KEY (tipo_codigo)                  REFERENCES permiso_tipo (codigo),
  CONSTRAINT fk_pt_doc     FOREIGN KEY (tenant_id, documento_id)      REFERENCES documento_sst (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Foto de la verificacion al emitir: certificacion, aptitud e induccion de cada ejecutor.
CREATE TABLE permiso_ejecutor (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  permiso_id      BIGINT UNSIGNED NOT NULL,
  persona_id      BIGINT UNSIGNED NOT NULL,
  verificacion    JSON NOT NULL,
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_permiso_persona (tenant_id, permiso_id, persona_id),
  CONSTRAINT fk_pe_permiso FOREIGN KEY (tenant_id, permiso_id) REFERENCES permiso_trabajo (tenant_id, id),
  CONSTRAINT fk_pe_persona FOREIGN KEY (tenant_id, persona_id) REFERENCES persona (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- M16 Contratistas ----------

CREATE TABLE contratista (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  empresa_id        BIGINT UNSIGNED NOT NULL,
  nit               VARCHAR(20)  NOT NULL,
  razon_social      VARCHAR(200) NOT NULL,
  actividad         VARCHAR(300) NOT NULL,
  clase_riesgo      ENUM('I','II','III','IV','V') NOT NULL,
  contacto_nombre   VARCHAR(150) NULL,
  contacto_email    VARCHAR(150) NULL,
  fecha_inicio      DATE NULL,
  fecha_fin         DATE NULL,
  estado            ENUM('en_evaluacion','aprobado','condicionado','rechazado','inactivo') NOT NULL DEFAULT 'en_evaluacion',
  creado_por        BIGINT UNSIGNED NULL,
  creado_en         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en    DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_nit (tenant_id, empresa_id, nit),
  CONSTRAINT fk_ctr_empresa FOREIGN KEY (tenant_id, empresa_id) REFERENCES empresa (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE contratista_evaluacion (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id        BIGINT UNSIGNED NOT NULL,
  contratista_id   BIGINT UNSIGNED NOT NULL,
  tipo             ENUM('seleccion','desempeno') NOT NULL,
  fecha            DATE NOT NULL,
  respuestas       JSON NOT NULL,
  puntaje          DECIMAL(5,2) NOT NULL,
  resultado        ENUM('aprobado','condicionado','rechazado') NOT NULL,
  observacion      VARCHAR(1000) NULL,
  creado_por       BIGINT UNSIGNED NULL,
  creado_en        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en   DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_contratista (tenant_id, contratista_id, fecha),
  CONSTRAINT fk_cev_ctr FOREIGN KEY (tenant_id, contratista_id) REFERENCES contratista (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE contratista_trabajador (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id        BIGINT UNSIGNED NOT NULL,
  contratista_id   BIGINT UNSIGNED NOT NULL,
  persona_id       BIGINT UNSIGNED NOT NULL,
  fecha_ingreso    DATE NOT NULL,
  fecha_retiro     DATE NULL,
  estado           ENUM('activo','retirado') NOT NULL DEFAULT 'activo',
  creado_por       BIGINT UNSIGNED NULL,
  creado_en        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en   DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_contratista (tenant_id, contratista_id, estado),
  CONSTRAINT fk_ctt_ctr     FOREIGN KEY (tenant_id, contratista_id) REFERENCES contratista (tenant_id, id),
  CONSTRAINT fk_ctt_persona FOREIGN KEY (tenant_id, persona_id)     REFERENCES persona (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Verificacion mensual de afiliacion y pago al SGRL (planilla PILA) por trabajador del contratista.
CREATE TABLE sgrl_verificacion (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id        BIGINT UNSIGNED NOT NULL,
  contratista_id   BIGINT UNSIGNED NOT NULL,
  persona_id       BIGINT UNSIGNED NOT NULL,
  periodo          CHAR(7) NOT NULL,
  planilla         VARCHAR(30) NOT NULL,
  arl              VARCHAR(100) NOT NULL,
  fecha_pago       DATE NOT NULL,
  clase_cotizada   ENUM('I','II','III','IV','V') NOT NULL,
  resultado        ENUM('conforme','inconsistente') NOT NULL,
  observacion      VARCHAR(500) NULL,
  creado_por       BIGINT UNSIGNED NULL,
  creado_en        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en   DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_periodo (tenant_id, contratista_id, periodo),
  CONSTRAINT fk_sv_ctr     FOREIGN KEY (tenant_id, contratista_id) REFERENCES contratista (tenant_id, id),
  CONSTRAINT fk_sv_persona FOREIGN KEY (tenant_id, persona_id)     REFERENCES persona (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

CREATE TRIGGER trg_brigada_miembro_bu BEFORE UPDATE ON brigada_miembro FOR EACH ROW
BEGIN
  IF OLD.estado = 'retirado' OR NOT (OLD.persona_id <=> NEW.persona_id AND OLD.rol <=> NEW.rol AND OLD.fecha_designacion <=> NEW.fecha_designacion) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'brigada: retire y designe de nuevo';
  END IF;
END$$

CREATE TRIGGER trg_brigada_miembro_bd BEFORE DELETE ON brigada_miembro FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'brigada_miembro no se borra: retire';
END$$

CREATE TRIGGER trg_equipo_emergencia_bu BEFORE UPDATE ON equipo_emergencia FOR EACH ROW
BEGIN
  IF OLD.estado = 'baja' OR NOT (OLD.codigo <=> NEW.codigo AND OLD.tipo_codigo <=> NEW.tipo_codigo) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'equipo dado de baja o codigo inmutable';
  END IF;
END$$

CREATE TRIGGER trg_equipo_emergencia_bd BEFORE DELETE ON equipo_emergencia FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'equipo_emergencia no se borra: de de baja';
END$$

CREATE TRIGGER trg_equipo_revision_bu BEFORE UPDATE ON equipo_revision FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'equipo_revision es inmutable';
END$$

CREATE TRIGGER trg_equipo_revision_bd BEFORE DELETE ON equipo_revision FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'equipo_revision es inmutable';
END$$

CREATE TRIGGER trg_simulacro_bu BEFORE UPDATE ON simulacro FOR EACH ROW
BEGIN
  IF OLD.estado = 'anulado' OR NOT (OLD.fecha <=> NEW.fecha AND OLD.participantes <=> NEW.participantes
      AND OLD.fortalezas <=> NEW.fortalezas AND OLD.oportunidades <=> NEW.oportunidades AND OLD.documento_id <=> NEW.documento_id
      AND OLD.tiempo_evacuacion_seg <=> NEW.tiempo_evacuacion_seg AND OLD.tiempo_respuesta_seg <=> NEW.tiempo_respuesta_seg) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'simulacro registrado: anule y registre de nuevo';
  END IF;
END$$

CREATE TRIGGER trg_simulacro_bd BEFORE DELETE ON simulacro FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'simulacro no se borra: anule';
END$$

CREATE TRIGGER trg_inspeccion_bu BEFORE UPDATE ON inspeccion FOR EACH ROW
BEGIN
  IF OLD.estado IN ('realizada','anulada') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'inspeccion realizada o anulada: no se modifica';
  END IF;
END$$

CREATE TRIGGER trg_inspeccion_bd BEFORE DELETE ON inspeccion FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'inspeccion no se borra: anule';
END$$

CREATE TRIGGER trg_inspeccion_hallazgo_bu BEFORE UPDATE ON inspeccion_hallazgo FOR EACH ROW
BEGIN
  IF NOT (OLD.descripcion <=> NEW.descripcion AND OLD.nivel <=> NEW.nivel AND OLD.numero <=> NEW.numero AND OLD.inspeccion_id <=> NEW.inspeccion_id)
      OR (OLD.accion_mejora_id IS NOT NULL AND NOT (OLD.accion_mejora_id <=> NEW.accion_mejora_id)) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'inspeccion_hallazgo es inmutable';
  END IF;
END$$

CREATE TRIGGER trg_inspeccion_hallazgo_bd BEFORE DELETE ON inspeccion_hallazgo FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'inspeccion_hallazgo es inmutable';
END$$

CREATE TRIGGER trg_epp_ingreso_bu BEFORE UPDATE ON epp_ingreso FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'epp_ingreso es inmutable: registre un ajuste';
END$$

CREATE TRIGGER trg_epp_ingreso_bd BEFORE DELETE ON epp_ingreso FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'epp_ingreso es inmutable';
END$$

-- Solo cambia estado y motivo; entregada o anulada es final. La firma se liga por firma.entidad = epp_entrega.
CREATE TRIGGER trg_epp_entrega_bu BEFORE UPDATE ON epp_entrega FOR EACH ROW
BEGIN
  IF OLD.estado IN ('entregada','anulada') OR NOT (OLD.persona_id <=> NEW.persona_id AND OLD.elemento_id <=> NEW.elemento_id
      AND OLD.cantidad <=> NEW.cantidad AND OLD.fecha <=> NEW.fecha AND OLD.motivo <=> NEW.motivo AND OLD.modalidad <=> NEW.modalidad) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'entrega de EPP: no se modifica';
  END IF;
END$$

CREATE TRIGGER trg_epp_entrega_bd BEFORE DELETE ON epp_entrega FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'epp_entrega no se borra: anule';
END$$

CREATE TRIGGER trg_permiso_trabajo_bu BEFORE UPDATE ON permiso_trabajo FOR EACH ROW
BEGIN
  IF OLD.estado IN ('cerrado','anulado') OR NOT (OLD.numero <=> NEW.numero AND OLD.fecha <=> NEW.fecha AND OLD.tipo_codigo <=> NEW.tipo_codigo
      AND OLD.tarea <=> NEW.tarea AND OLD.ats <=> NEW.ats AND OLD.verificaciones <=> NEW.verificaciones AND OLD.lugar <=> NEW.lugar) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'permiso emitido: no se modifica';
  END IF;
END$$

CREATE TRIGGER trg_permiso_trabajo_bd BEFORE DELETE ON permiso_trabajo FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'permiso_trabajo no se borra: anule';
END$$

CREATE TRIGGER trg_permiso_ejecutor_bu BEFORE UPDATE ON permiso_ejecutor FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'permiso_ejecutor es inmutable';
END$$

CREATE TRIGGER trg_permiso_ejecutor_bd BEFORE DELETE ON permiso_ejecutor FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'permiso_ejecutor es inmutable';
END$$

CREATE TRIGGER trg_contratista_bd BEFORE DELETE ON contratista FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'contratista no se borra: inactive';
END$$

CREATE TRIGGER trg_contratista_evaluacion_bu BEFORE UPDATE ON contratista_evaluacion FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'contratista_evaluacion es inmutable';
END$$

CREATE TRIGGER trg_contratista_evaluacion_bd BEFORE DELETE ON contratista_evaluacion FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'contratista_evaluacion es inmutable';
END$$

CREATE TRIGGER trg_contratista_trabajador_bu BEFORE UPDATE ON contratista_trabajador FOR EACH ROW
BEGIN
  IF OLD.estado = 'retirado' OR NOT (OLD.persona_id <=> NEW.persona_id AND OLD.fecha_ingreso <=> NEW.fecha_ingreso) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'contratista_trabajador: retire y vincule de nuevo';
  END IF;
END$$

CREATE TRIGGER trg_contratista_trabajador_bd BEFORE DELETE ON contratista_trabajador FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'contratista_trabajador no se borra: retire';
END$$

CREATE TRIGGER trg_sgrl_verificacion_bu BEFORE UPDATE ON sgrl_verificacion FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sgrl_verificacion es inmutable';
END$$

CREATE TRIGGER trg_sgrl_verificacion_bd BEFORE DELETE ON sgrl_verificacion FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sgrl_verificacion es inmutable';
END$$

DELIMITER ;
