-- Gestor documental (M03): archivo, firma electronica, versionado y retencion. Requiere 01 a 06.

ALTER TABLE tipo_documental
  ADD COLUMN solo_referencia   TINYINT(1) NOT NULL DEFAULT 0 AFTER requiere_firma,
  ADD COLUMN modalidades_firma JSON NULL AFTER solo_referencia;

ALTER TABLE documento_sst
  MODIFY estado ENUM('borrador','en_firma','vigente','reemplazado','anulado') NOT NULL DEFAULT 'borrador',
  ADD COLUMN archivo_nombre     VARCHAR(255) NULL AFTER archivo_hash,
  ADD COLUMN archivo_mime       VARCHAR(100) NULL AFTER archivo_nombre,
  ADD COLUMN archivo_bytes      INT UNSIGNED NULL AFTER archivo_mime,
  ADD COLUMN modalidad_firma    ENUM('electronica','manuscrita','digital_externa') NULL AFTER archivo_bytes,
  ADD COLUMN firmantes_externos VARCHAR(500) NULL AFTER modalidad_firma,
  ADD COLUMN referencia_custodio VARCHAR(255) NULL AFTER firmantes_externos,
  ADD COLUMN descripcion        VARCHAR(1000) NULL AFTER titulo;

-- Tabla de retencion de la empresa para los tipos sin plazo legal fijo (par. art. 2.2.4.6.13).
CREATE TABLE retencion_empresa (
  id               BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id        BIGINT UNSIGNED NOT NULL,
  empresa_id       BIGINT UNSIGNED NOT NULL,
  tipo_documental  VARCHAR(60) NOT NULL,
  anios            SMALLINT UNSIGNED NOT NULL,
  estado           ENUM('activo','inactivo') NOT NULL DEFAULT 'activo',
  creado_por       BIGINT UNSIGNED NULL,
  creado_en        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en   DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_empresa_tipo (tenant_id, empresa_id, tipo_documental),
  CONSTRAINT fk_re_empresa FOREIGN KEY (tenant_id, empresa_id) REFERENCES empresa (tenant_id, id),
  CONSTRAINT fk_re_tipo    FOREIGN KEY (tipo_documental)       REFERENCES tipo_documental (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Aceptacion del acuerdo de uso de firma electronica (D. 2364 art. 7). Append-only.
CREATE TABLE acuerdo_firma (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id    BIGINT UNSIGNED NOT NULL,
  usuario_id   BIGINT UNSIGNED NOT NULL,
  version      VARCHAR(20) NOT NULL,
  texto        TEXT NOT NULL,
  ip           VARBINARY(16) NULL,
  user_agent   VARCHAR(255) NULL,
  aceptado_en  DATETIME(3) NOT NULL,
  UNIQUE KEY uq_usuario_version (tenant_id, usuario_id, version),
  CONSTRAINT fk_af_tenant  FOREIGN KEY (tenant_id)  REFERENCES tenant (id),
  CONSTRAINT fk_af_usuario FOREIGN KEY (usuario_id) REFERENCES usuario (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE firma_solicitud (
  id              BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id       BIGINT UNSIGNED NOT NULL,
  documento_id    BIGINT UNSIGNED NOT NULL,
  usuario_id      BIGINT UNSIGNED NOT NULL,
  rol_firmante    VARCHAR(60) NOT NULL,
  firma_id        BIGINT UNSIGNED NULL,
  firmado_en      DATETIME NULL,
  estado          ENUM('pendiente','firmada','anulada') NOT NULL DEFAULT 'pendiente',
  creado_por      BIGINT UNSIGNED NULL,
  creado_en       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en  DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  UNIQUE KEY uq_documento_usuario (tenant_id, documento_id, usuario_id),
  KEY idx_usuario_estado (tenant_id, usuario_id, estado),
  CONSTRAINT fk_fs_documento FOREIGN KEY (tenant_id, documento_id) REFERENCES documento_sst (tenant_id, id),
  CONSTRAINT fk_fs_usuario   FOREIGN KEY (usuario_id)              REFERENCES usuario (id),
  CONSTRAINT fk_fs_firma     FOREIGN KEY (firma_id)                REFERENCES firma (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Codigo de un solo uso para firmar. Solo se guarda su hash.
CREATE TABLE firma_otp (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id     BIGINT UNSIGNED NOT NULL,
  solicitud_id  BIGINT UNSIGNED NOT NULL,
  usuario_id    BIGINT UNSIGNED NOT NULL,
  codigo_hash   CHAR(64) NOT NULL,
  expira_en     DATETIME NOT NULL,
  intentos      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  usado_en      DATETIME NULL,
  estado        ENUM('activo','usado','expirado') NOT NULL DEFAULT 'activo',
  creado_por    BIGINT UNSIGNED NULL,
  creado_en     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tenant_id (tenant_id, id),
  KEY idx_solicitud (tenant_id, solicitud_id, estado),
  CONSTRAINT fk_fo_solicitud FOREIGN KEY (tenant_id, solicitud_id) REFERENCES firma_solicitud (tenant_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

DROP TRIGGER trg_documento_sst_bu;

DELIMITER $$

-- Solo el borrador es editable. En firma o despues solo cambian estado, motivo y retencion.
CREATE TRIGGER trg_documento_sst_bu BEFORE UPDATE ON documento_sst FOR EACH ROW
BEGIN
  IF NOT (OLD.tenant_id <=> NEW.tenant_id AND OLD.id <=> NEW.id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'documento_sst: tenant_id e id son inmutables';
  END IF;

  IF OLD.estado <> 'borrador' THEN
    IF NOT (OLD.empresa_id <=> NEW.empresa_id
        AND OLD.tipo_documental <=> NEW.tipo_documental
        AND OLD.codigo <=> NEW.codigo
        AND OLD.titulo <=> NEW.titulo
        AND OLD.descripcion <=> NEW.descripcion
        AND OLD.version <=> NEW.version
        AND OLD.documento_padre_id <=> NEW.documento_padre_id
        AND OLD.persona_id <=> NEW.persona_id
        AND OLD.vigencia_anio <=> NEW.vigencia_anio
        AND OLD.fecha_documento <=> NEW.fecha_documento
        AND OLD.fecha_vence <=> NEW.fecha_vence
        AND OLD.archivo_ruta <=> NEW.archivo_ruta
        AND OLD.archivo_hash <=> NEW.archivo_hash
        AND OLD.archivo_nombre <=> NEW.archivo_nombre
        AND OLD.modalidad_firma <=> NEW.modalidad_firma
        AND OLD.firmantes_externos <=> NEW.firmantes_externos
        AND OLD.referencia_custodio <=> NEW.referencia_custodio
        AND OLD.creado_por <=> NEW.creado_por
        AND OLD.creado_en <=> NEW.creado_en) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'documento_sst no borrador: cree una version nueva';
    END IF;
  END IF;

  IF OLD.estado <> NEW.estado AND NOT (
       (OLD.estado = 'borrador' AND NEW.estado IN ('en_firma','vigente','anulado'))
    OR (OLD.estado = 'en_firma' AND NEW.estado IN ('vigente','anulado'))
    OR (OLD.estado = 'vigente'  AND NEW.estado IN ('reemplazado','anulado'))) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'documento_sst: transicion de estado no permitida';
  END IF;
END$$

CREATE TRIGGER trg_acuerdo_firma_bu BEFORE UPDATE ON acuerdo_firma FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'acuerdo_firma es append-only';
END$$

CREATE TRIGGER trg_acuerdo_firma_bd BEFORE DELETE ON acuerdo_firma FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'acuerdo_firma es append-only';
END$$

-- Una solicitud firmada o anulada queda cerrada.
CREATE TRIGGER trg_firma_solicitud_bu BEFORE UPDATE ON firma_solicitud FOR EACH ROW
BEGIN
  IF OLD.estado <> 'pendiente' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'firma_solicitud cerrada';
  END IF;
END$$

CREATE TRIGGER trg_firma_solicitud_bd BEFORE DELETE ON firma_solicitud FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'firma_solicitud no se borra';
END$$

CREATE TRIGGER trg_retencion_empresa_bd BEFORE DELETE ON retencion_empresa FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'retencion_empresa no se borra: inactive';
END$$

DELIMITER ;
