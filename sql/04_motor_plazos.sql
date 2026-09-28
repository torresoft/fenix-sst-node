-- Motor de plazos y alertas. Requiere 01 a 03.

ALTER TABLE plazo_legal
  ADD COLUMN severidad          ENUM('critica','alta','media') NOT NULL DEFAULT 'media' AFTER modulo,
  ADD COLUMN dias_alerta_previa SMALLINT UNSIGNED NOT NULL DEFAULT 3 AFTER severidad,
  ADD COLUMN correr_si_inhabil  TINYINT(1) NOT NULL DEFAULT 0 AFTER dias_alerta_previa;

-- mes_dia_limite 'MM-DD': vence en esa fecha fija del anio siguiente (p. ej. RNBD 03-31).
ALTER TABLE vencimiento_recurrente
  ADD COLUMN severidad      ENUM('critica','alta','media') NOT NULL DEFAULT 'media' AFTER dias_alerta_previa,
  ADD COLUMN mes_dia_limite CHAR(5) NULL AFTER severidad;

ALTER TABLE tipo_documental
  ADD COLUMN vencimiento_codigo VARCHAR(40) NULL AFTER vigencia_meses,
  ADD CONSTRAINT fk_td_vencimiento FOREIGN KEY (vencimiento_codigo) REFERENCES vencimiento_recurrente (codigo);

ALTER TABLE empresa
  ADD COLUMN representante_legal_email VARCHAR(190) NULL AFTER representante_legal_documento;

-- Instancia de un plazo legal o vencimiento en un tenant. Los datos del catalogo se copian
-- al crearla: si la norma cambia despues, el plazo ya calculado conserva su base.
CREATE TABLE obligacion_pendiente (
  id                       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id                BIGINT UNSIGNED NOT NULL,
  empresa_id               BIGINT UNSIGNED NOT NULL,
  origen                   ENUM('evento','vencimiento') NOT NULL,
  plazo_codigo             VARCHAR(40)  NOT NULL,
  descripcion              VARCHAR(255) NOT NULL,
  norma_codigo             VARCHAR(40)  NOT NULL,
  severidad                ENUM('critica','alta','media') NOT NULL,
  tipo_plazo               ENUM('habil','calendario','mes','anio','dia','fecha_fija') NOT NULL,
  cantidad                 SMALLINT UNSIGNED NULL,
  dias_alerta_previa       SMALLINT UNSIGNED NOT NULL,
  entidad_origen_tipo      VARCHAR(60)  NOT NULL,
  entidad_origen_id        BIGINT UNSIGNED NOT NULL,
  fecha_disparo            DATE NOT NULL,
  fecha_limite             DATE NOT NULL,
  fecha_cumplimiento       DATE NULL,
  evidencia_documento_id   BIGINT UNSIGNED NULL,
  observacion              VARCHAR(500) NULL,
  responsable_id           BIGINT UNSIGNED NULL,
  escalado_en              DATETIME NULL,
  estado                   ENUM('en_termino','por_vencer','vencido','cumplido','anulado') NOT NULL DEFAULT 'en_termino',
  creado_por               BIGINT UNSIGNED NULL,
  creado_en                DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en           DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_origen (tenant_id, plazo_codigo, entidad_origen_tipo, entidad_origen_id, fecha_disparo),
  KEY idx_estado_limite (tenant_id, estado, fecha_limite),
  KEY idx_empresa (tenant_id, empresa_id, estado),
  KEY idx_responsable (tenant_id, responsable_id, estado),
  KEY idx_entidad (tenant_id, entidad_origen_tipo, entidad_origen_id),
  CONSTRAINT fk_obl_empresa     FOREIGN KEY (tenant_id, empresa_id)             REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_obl_evidencia   FOREIGN KEY (tenant_id, evidencia_documento_id) REFERENCES documento_sst (tenant_id, id),
  CONSTRAINT fk_obl_responsable FOREIGN KEY (responsable_id)                    REFERENCES usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Traza de alertas enviadas: prueba de que el sistema aviso a tiempo. Append-only.
CREATE TABLE notificacion_envio (
  id                       BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id                BIGINT UNSIGNED NOT NULL,
  tipo                     ENUM('resumen_diario','escalamiento') NOT NULL,
  fecha_corte              DATE NOT NULL,
  destinatario_usuario_id  BIGINT UNSIGNED NULL,
  destinatario_email       VARCHAR(190) NOT NULL,
  asunto                   VARCHAR(255) NOT NULL,
  obligaciones             JSON NOT NULL,
  estado                   ENUM('enviado','fallido','omitido') NOT NULL,
  error                    VARCHAR(500) NULL,
  enviado_en               DATETIME(3) NOT NULL,
  KEY idx_tenant_tipo_fecha (tenant_id, tipo, fecha_corte),
  CONSTRAINT fk_notif_tenant FOREIGN KEY (tenant_id) REFERENCES tenant (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DELIMITER $$

CREATE TRIGGER trg_obligacion_pendiente_bu BEFORE UPDATE ON obligacion_pendiente FOR EACH ROW
BEGIN
  IF NOT (OLD.tenant_id <=> NEW.tenant_id AND OLD.empresa_id <=> NEW.empresa_id
      AND OLD.plazo_codigo <=> NEW.plazo_codigo AND OLD.fecha_disparo <=> NEW.fecha_disparo
      AND OLD.fecha_limite <=> NEW.fecha_limite AND OLD.entidad_origen_tipo <=> NEW.entidad_origen_tipo
      AND OLD.entidad_origen_id <=> NEW.entidad_origen_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'obligacion_pendiente: origen y fecha limite son inmutables';
  END IF;
  IF OLD.estado IN ('cumplido','anulado') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'obligacion_pendiente cerrada: no admite cambios';
  END IF;
END$$

CREATE TRIGGER trg_obligacion_pendiente_bd BEFORE DELETE ON obligacion_pendiente FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'obligacion_pendiente no se borra: anule';
END$$

CREATE TRIGGER trg_notificacion_envio_bu BEFORE UPDATE ON notificacion_envio FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'notificacion_envio es append-only';
END$$

CREATE TRIGGER trg_notificacion_envio_bd BEFORE DELETE ON notificacion_envio FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'notificacion_envio es append-only';
END$$

DELIMITER ;
