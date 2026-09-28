# 06 · Mapa de modulos

18 modulos. Los 12 primeros son el nucleo obligatorio para cualquier empresa;
los demas se activan por perfil. Esa activacion condicional es tambien el
esquema de planes comerciales.

## Nucleo

### M01 · Empresa y centros de trabajo
Datos del empleador, actividad economica (CIIU), **clase de riesgo I–V por
centro**, numero de trabajadores, ARL, representante legal.
De aqui sale la aplicabilidad de todo lo demas: estandares minimos, normas de
la matriz legal y modulos activos.

### M02 · Personas
Trabajadores dependientes, contratistas, aprendices, trabajadores en mision,
independientes. Cargo, area, perfil de riesgo del cargo, fechas de vinculacion
y retiro.
**El retiro dispara el reloj de conservacion de 20 anios** y la obligacion de
examen de egreso en 5 dias.

### M03 · Gestor documental del SG-SST
Los 16 documentos del art. 2.2.4.6.12 tipificados, con versionado, firma,
vigencia y tabla de retencion. Es la columna vertebral: todos los demas modulos
escriben aqui.

### M04 · Matriz legal
Catalogo normativo mantenido centralmente y heredado por cada tenant, con
aplicabilidad por perfil, estado de vigencia y evidencia de cumplimiento.
Actualizar una norma aqui actualiza a todos los clientes.
Incluye el **auditor de matriz legal**: detecta normas derogadas en la matriz
del cliente (ver listado en `01-marco-normativo.md`).

### M05 · Peligros y riesgos
Matriz con metodologia configurable (GTC 45 u otra), tareas rutinarias y no
rutinarias, controles en **jerarquia obligatoria** (eliminacion → sustitucion →
ingenieria → administrativos → EPP), versionado anual y disparador desde
eventos mortales. Incluye mediciones de higiene industrial.

### M06 · Planeacion y cronograma
Plan de trabajo anual, objetivos, metas, presupuesto SST, responsables,
gestion del cambio. Genera el % de ejecucion que alimenta los indicadores de
proceso.

### M07 · Formacion y competencias
Induccion **bloqueante** antes del inicio de labores, capacitaciones con
asistencia firmada, certificaciones con vencimiento (alturas, confinados,
electrico), curso de 50 h y actualizacion de 20 h del responsable, licencia SST.

### M08 · Eventos: incidentes, AT y EL
Reporte con reloj de 2 dias habiles, FURAT/FUREL, investigacion con equipo de
3 roles y analisis causal, plan de accion, estadistica y clasificacion contra
el Decreto 1477.

### M09 · Salud ocupacional
Ordenes de examen con perfil de cargo, conceptos de aptitud, restricciones,
reloj de adaptacion de 20 dias habiles, ausentismo e incapacidades,
diagnostico de condiciones de salud agregado.
**Sin historia clinica** — ver `08-privacidad-y-trazabilidad.md`.

### M10 · Comites
COPASST y Convivencia: eleccion, conformacion por tamanio, periodo de 2 anios,
actas mensuales, quorum, compromisos con responsable y fecha, informes
trimestrales y anual.

### M11 · Autoevaluacion y planes de mejora
Motor de la Res. 0312: aplicabilidad, puntaje PHVA, valoracion, simulacion de
brechas, plan de mejoramiento con seguimiento e informes semestrales,
exportacion para cargue.

### M12 · Indicadores y tablero
Fichas tecnicas, calculo automatico de los indicadores de resultado, estructura
y proceso derivados, tablero por empresa y por centro de trabajo.

## Por perfil

### M13 · Emergencias
Analisis de amenazas y vulnerabilidad, plan, brigada, inventario y vencimiento
de equipos, registro de simulacros con evaluacion. Se articula con el PGRDEPP
cuando aplica el Decreto 2157.

### M14 · Inspecciones y EPP
Inspecciones planeadas y preoperacionales con hallazgos y cierre; matriz de EPP
por cargo, entrega firmada, reposicion y stock.

### M15 · Permisos de alto riesgo
Alturas, espacios confinados, trabajo en caliente, riesgo electrico.
Permiso con **verificacion previa** de certificacion vigente, aptitud medica y
ATS. Bloquea la emision si algo esta vencido.

### M16 · Contratistas
Evaluacion y seleccion con criterios SST, verificacion de afiliacion y pago al
SGRL con clase de riesgo correcta, induccion, rotacion de personal, desempeno.

### M17 · Convivencia, acoso y salud mental
Canales de denuncia (electronico, fisico, verbal con registro obligatorio),
reserva, ruta de atencion, reloj de 5 dias habiles de proteccion y de 65 dias
del procedimiento, bateria psicosocial y programa del Decreto 0728.

### M18 · PESV, quimicos y especificos
PESV con 24 pasos por nivel, expedientes de conductores, inspeccion
preoperacional de vehiculos; inventario quimico con FDS y etiquetas SGA;
modulos sectoriales segun activacion.

## Transversales

### CAPA · Planes de accion
Una sola tabla de acciones correctivas y preventivas, alimentada por
auditorias, investigaciones, inspecciones, revision por la direccion y
autoevaluacion. Evita seis modulos con la misma logica.

### Auditoria y revision por la direccion
Programa anual, control de independencia del auditor, informe y acta
estructurada con los 8 puntos del art. 2.2.4.6.31.

### Notificaciones y alertas
Motor de plazos, vencimientos y escalamiento. Correo, panel y push.
Es lo que hace que el cliente entre al sistema todos los dias.

## Reglas de activacion por perfil

| Modulo | Se activa cuando |
|---|---|
| M13 Emergencias | Siempre (estandar minimo en todos los conjuntos) |
| M14 Inspecciones y EPP | Siempre |
| M15 Permisos de alto riesgo | La empresa declara tareas en alturas, espacios confinados, caliente o electrico |
| M16 Contratistas | La empresa declara que contrata terceros |
| M17 Convivencia y salud mental | Siempre (Ley 1010 y D. 1040 aplican a todos) |
| M18 PESV | > 10 vehiculos **o** >= 2 conductores |
| M18 Quimicos | La empresa declara manejo de productos quimicos |
