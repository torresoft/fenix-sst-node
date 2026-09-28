# 08 · Privacidad y trazabilidad probatoria

**Lectura obligatoria** antes de tocar cualquier cosa relacionada con salud,
firmas, logs o exportacion de expedientes.

## Parte A · El muro entre el empleador y la historia clinica

Si hay una sola decision de arquitectura que puede hundir el producto, es esta.
La normatividad colombiana prohibe expresamente que el empleador acceda a la
historia clinica ocupacional. Un software que la almacene en el tenant del
empleador incumple, y ademas maneja datos sensibles: la sancion maxima de la SIC
en datos sensibles es el **cierre inmediato y definitivo** de la operacion.

### Lo que SI puede ver el empleador

- Tipo de evaluacion y fecha
- Concepto de aptitud: apto / apto con restricciones / no apto / aplazado
- Restricciones y recomendaciones laborales
- Diagnostico de condiciones de salud **agregado**, sin datos individualizados
- Perfil sociodemografico
- Dias de incapacidad y ausentismo, **sin diagnostico**
- Informe psicosocial **consolidado por area**

### Lo que NO puede tocar

- Historia clinica ocupacional completa
- Anamnesis, examen fisico, impresion diagnostica
- Paraclinicos, audiometrias, espirometrias, radiografias
- Informes individuales de la bateria psicosocial
- Resultados de pruebas de embarazo o de sustancias psicoactivas
- Cualquier diagnostico asociado a una incapacidad

### Consecuencias de arquitectura

1. **Dos dominios de datos separados.** Si el producto tambien atiende IPS y
   prestadores de SST, ese modulo va en un esquema distinto, con control de
   acceso ligado al profesional de la salud y sin visibilidad cruzada hacia el
   tenant del empleador. No basta con ocultar campos por rol en la misma tabla.
2. **Canal de consulta del propio trabajador.** El paragrafo 3 del art.
   2.2.4.6.12 le da al trabajador derecho a consultar los registros relativos a
   su salud. Eso es un rol de usuario, no un tramite por correo.
3. **Consentimiento como objeto versionado.** Para datos sensibles la
   autorizacion debe ser previa, expresa e informada; hay que informar que **no
   esta obligado** a autorizarlos, decir cuales son sensibles, y **no
   condicionar ninguna actividad** a entregarlos.
4. **Retencion con dos relojes.** Conviven 20 anios (documentos del SG-SST desde
   el retiro), 15 anios (historia clinica: 5 en gestion + 10 en central) y el
   principio de caducidad de la Ley 1581. Tabla de retencion parametrizable por
   tipo documental, aplicando el plazo mas largo, con supresion auditada.

### Modelo de consentimiento

```sql
CREATE TABLE consentimiento (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tenant_id         BIGINT UNSIGNED NOT NULL,
  persona_id        BIGINT UNSIGNED NOT NULL,
  finalidad         VARCHAR(120) NOT NULL,
  es_dato_sensible  TINYINT(1) NOT NULL,
  politica_version  VARCHAR(20) NOT NULL,
  texto_mostrado    TEXT NOT NULL,        -- el texto exacto que vio
  otorgado          TINYINT(1) NOT NULL,
  medio             VARCHAR(30) NOT NULL, -- web | fisico_escaneado | verbal_registrado
  ip                VARBINARY(16) NULL,
  otorgado_en       DATETIME(3) NOT NULL,
  revocado_en       DATETIME(3) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Un booleano `acepta_datos = 1` **no es prueba**. La UI debe tener checkbox
separado, no premarcado, para los datos sensibles.

### Obligaciones de habeas data del SaaS

| Obligacion | Detalle | Quien responde |
|---|---|---|
| Rol en el tratamiento | La empresa cliente es **Responsable**; TORRESOFT es **Encargado**. Se requiere contrato de encargo con instrucciones documentadas | Ambos |
| Registro Nacional de Bases de Datos | Obligatorio para sociedades con activos > 100.000 UVT y personas juridicas publicas. Actualizacion anual entre el 2 de enero y el 31 de marzo; reporte de reclamos en los primeros 15 dias habiles de febrero y agosto | Cliente |
| Incidentes de seguridad | Reporte a la SIC dentro de los 15 dias habiles siguientes a su deteccion | Responsable, con soporte del Encargado |
| Consultas y reclamos | 10 y 15 dias habiles. El sistema debe tener el flujo, no un correo | Responsable |
| Transferencia internacional | Si el hosting esta fuera de Colombia, verificar el pais frente a la lista de niveles adecuados de la SIC y suscribir contrato de transmision | TORRESOFT |
| Sancion maxima | Hasta 2.000 SMLMV, suspension hasta 6 meses y **cierre inmediato y definitivo** de la operacion que involucre datos sensibles | — |

En 2025 la SIC abrio 101 investigaciones y sanciono por $5.157 millones, mas del
doble que en 2023. No es un riesgo teorico.

> **No verificado**: si la SIC modifico el Titulo V de la Circular Unica en
> 2025–2026. Confirmar el calendario de reportes en sic.gov.co antes de
> codificarlo.

## Parte B · Que el expediente electronico aguante una visita

El Decreto 1072 admite expresamente la documentacion en medio electronico:

> **Art. 2.2.4.6.12, paragrafo 1** — "Los documentos pueden existir en papel,
> disco magnetico, optico o electronico, fotografia, o una combinacion de estos
> y en custodia del responsable del desarrollo del Sistema de Gestion de la
> Seguridad y Salud en el Trabajo."

Lo que no admite es un expediente que no pueda demostrar quien hizo que y cuando.

| Requisito | Fundamento | Implementacion |
|---|---|---|
| Accesible para consulta posterior | Ley 527/1999 art. 6 | Exportacion a PDF/A legible sin el sistema en linea |
| Identificacion del firmante y aprobacion del contenido | Ley 527 art. 7 · D. 2364/2012 art. 3 | Autenticacion fuerte + acto explicito de firma registrado |
| Garantia de integridad desde la generacion | Ley 527 arts. 8 y 9 | Hash por documento y por version, con sello de tiempo |
| Deteccion de alteracion posterior a la firma | D. 2364 art. 4 | Firma sobre el hash; cualquier cambio invalida la verificacion |
| Conservar origen, destino, fecha y hora | Ley 527 art. 12 | Metadatos obligatorios en cada registro |
| Imposibilitar modificacion de datos guardados | Res. 1995/1999 art. 18 | Almacenamiento append-only; correcciones como version nueva |
| Identificacion del personal responsable | Res. 1995 art. 18 | Usuario nominal, **nunca cuentas compartidas** |
| Acuerdo sobre el metodo de firma | D. 2364 art. 7 | Clausula de aceptacion de firma electronica firmada por trabajadores y miembros de comites |

### Nivel de firma por tipo de documento

| Documento | Nivel minimo | Razon |
|---|---|---|
| Autorizacion de tratamiento de datos sensibles | Firma electronica con evidencia reforzada | Es la prueba exigida por el D. 1377 art. 8 |
| Actas de comites, capacitaciones, entrega de EPP | Firma electronica + acuerdo de uso | Volumen alto; el acuerdo previo la hace oponible |
| Politica de SST y plan de trabajo anual | Firma electronica robusta del rep. legal | La norma exige firma expresa |
| Autoevaluacion y plan de mejoramiento | Firma electronica robusta; digital certificada si se busca maxima oponibilidad | Es el documento que va al Ministerio |
| Concepto de aptitud medica | **Firma digital certificada** | Identificacion del profesional exigida en historia clinica |

La firma electronica propia (usuario + contrasena + OTP + manifiesto de
evidencia) cubre casi todo y es viable en casa. La firma digital certificada
exige un tercero acreditado ante el ONAC.

### Exportacion para la visita

Funcion concreta y muy vendible: un boton que genera el expediente completo del
SG-SST para una vigencia, en PDF/A, con indice, historial de versiones, sellos
de integridad y certificado de auditoria verificable **sin conexion al sistema**.
El inspector debe poder validarlo en su portatil. Eso convierte una visita de
tres dias en una de tres horas.

### Agravantes que hacen esto no negociable

El Decreto 472 de 2015 art. 4 incluye como agravantes de la multa: reincidencia,
**obstruccion a la investigacion o inspeccion**, **ocultamiento fraudulento** y
ausencia de actividades de prevencion. Un sistema que permita edicion
retroactiva sin rastro es un riesgo sancionatorio para el cliente, no solo una
deficiencia tecnica.
