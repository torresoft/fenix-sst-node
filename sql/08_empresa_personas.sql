-- Empresa y personas (M01 / M02). Requiere 01 a 07.

ALTER TABLE empresa
  ADD COLUMN actividad_economica VARCHAR(255) NULL AFTER ciiu_codigo;

ALTER TABLE persona
  ADD COLUMN eps VARCHAR(100) NULL AFTER telefono,
  ADD COLUMN afp VARCHAR(100) NULL AFTER eps;

ALTER TABLE vinculacion
  ADD COLUMN observacion VARCHAR(500) NULL AFTER motivo_retiro;

DELIMITER $$

-- Una vinculacion retirada o anulada queda cerrada (un reintegro es una vinculacion nueva).
CREATE TRIGGER trg_vinculacion_bu BEFORE UPDATE ON vinculacion FOR EACH ROW
BEGIN
  IF OLD.estado <> 'activa' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vinculacion cerrada: registre una nueva';
  END IF;
  IF NOT (OLD.tenant_id <=> NEW.tenant_id AND OLD.empresa_id <=> NEW.empresa_id
      AND OLD.persona_id <=> NEW.persona_id AND OLD.fecha_ingreso <=> NEW.fecha_ingreso) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'vinculacion: persona, empresa e ingreso son inmutables';
  END IF;
END$$

CREATE TRIGGER trg_centro_trabajo_bd BEFORE DELETE ON centro_trabajo FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'centro_trabajo no se borra: inactive';
END$$

CREATE TRIGGER trg_cargo_bd BEFORE DELETE ON cargo FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'cargo no se borra: inactive';
END$$

DELIMITER ;
