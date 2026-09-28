-- Protecciones append-only a nivel de BD (Res. 1995/1999 art. 18). Requiere 02_nucleo.sql.
-- Complementar con privilegios del usuario de la app sobre auditoria_log y firma:
--   REVOKE UPDATE, DELETE, DROP ON <bd>.auditoria_log FROM <usuario_app>;  (idem firma)
-- TRUNCATE salta los triggers: el usuario de la app no debe tener DROP.

DELIMITER $$

CREATE TRIGGER trg_auditoria_log_bu BEFORE UPDATE ON auditoria_log FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'auditoria_log es append-only';
END$$

CREATE TRIGGER trg_auditoria_log_bd BEFORE DELETE ON auditoria_log FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'auditoria_log es append-only';
END$$

CREATE TRIGGER trg_firma_bu BEFORE UPDATE ON firma FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'firma es inmutable';
END$$

CREATE TRIGGER trg_firma_bd BEFORE DELETE ON firma FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'firma es inmutable';
END$$

-- Documento: solo el borrador es editable. Despues solo cambian estado, motivo y retencion.
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
        AND OLD.version <=> NEW.version
        AND OLD.documento_padre_id <=> NEW.documento_padre_id
        AND OLD.persona_id <=> NEW.persona_id
        AND OLD.vigencia_anio <=> NEW.vigencia_anio
        AND OLD.fecha_documento <=> NEW.fecha_documento
        AND OLD.fecha_vence <=> NEW.fecha_vence
        AND OLD.archivo_ruta <=> NEW.archivo_ruta
        AND OLD.archivo_hash <=> NEW.archivo_hash
        AND OLD.creado_por <=> NEW.creado_por
        AND OLD.creado_en <=> NEW.creado_en) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'documento_sst no borrador: cree una version nueva';
    END IF;
  END IF;

  IF OLD.estado <> NEW.estado AND NOT (
       (OLD.estado = 'borrador' AND NEW.estado IN ('vigente','anulado'))
    OR (OLD.estado = 'vigente'  AND NEW.estado IN ('reemplazado','anulado'))) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'documento_sst: transicion de estado no permitida';
  END IF;
END$$

CREATE TRIGGER trg_documento_sst_bd BEFORE DELETE ON documento_sst FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'documento_sst no se borra: anule o versione';
END$$

-- Consentimiento: solo se permite revocar una vez.
CREATE TRIGGER trg_consentimiento_bu BEFORE UPDATE ON consentimiento FOR EACH ROW
BEGIN
  IF NOT (OLD.tenant_id <=> NEW.tenant_id
      AND OLD.persona_id <=> NEW.persona_id
      AND OLD.finalidad <=> NEW.finalidad
      AND OLD.es_dato_sensible <=> NEW.es_dato_sensible
      AND OLD.politica_version <=> NEW.politica_version
      AND OLD.texto_mostrado <=> NEW.texto_mostrado
      AND OLD.otorgado <=> NEW.otorgado
      AND OLD.medio <=> NEW.medio
      AND OLD.ip <=> NEW.ip
      AND OLD.otorgado_en <=> NEW.otorgado_en) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'consentimiento: solo se permite la revocacion';
  END IF;
  IF OLD.revocado_en IS NOT NULL AND NOT (OLD.revocado_en <=> NEW.revocado_en) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'consentimiento ya revocado';
  END IF;
END$$

CREATE TRIGGER trg_consentimiento_bd BEFORE DELETE ON consentimiento FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'consentimiento no se borra';
END$$

-- Entidades con retencion legal: se inactivan, no se borran.
CREATE TRIGGER trg_empresa_bd BEFORE DELETE ON empresa FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'empresa no se borra: inactive';
END$$

CREATE TRIGGER trg_persona_bd BEFORE DELETE ON persona FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'persona no se borra: inactive';
END$$

CREATE TRIGGER trg_vinculacion_bd BEFORE DELETE ON vinculacion FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vinculacion no se borra: anule';
END$$

DELIMITER ;
