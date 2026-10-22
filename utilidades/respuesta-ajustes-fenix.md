# Respuesta a la solicitud de ajustes – Sistema SG-SST FÉNIX

Respuesta a los correos del 2 y del 20 de octubre de 2026. Para cada punto se indica qué se cambió en el sistema y qué conviene tener en cuenta al usarlo.

---

## Correo del 2 de octubre

### 1. Cambiar «Disparo» por «Inicio» en Obligaciones y plazos
**Qué se hizo:** la columna ahora se llama **Inicio**.

**Para tener en cuenta:** es la fecha en que empieza a contar el plazo de la obligación (por ejemplo, el inicio del periodo del COPASST o la fecha de ocurrencia de un accidente). La fecha límite se calcula desde ahí, con el calendario de festivos.

### 2. Tipo de trabajadores: De planta, Contratistas y De misión
**Qué se hizo:**
- En **Empresa y centros › Tamaño y perfil** aparecen tres casillas nuevas: **De planta**, **Contratistas** y **De misión**.
- En **Personas**, los tipos de vinculación ahora se llaman *De planta*, *Contratista*, *De misión*, *Aprendiz* e *Independiente*.

**Para tener en cuenta:**
- Estas tres cifras **no se escriben a mano**. El sistema las cuenta solo, con las personas que tienen vinculación activa en **Personas**. Así no hay que actualizar dos veces la misma información y siempre coinciden con la realidad.
- Para que los números salgan bien, cada trabajador debe estar registrado en **Personas** con su tipo de vinculación correcto.
- El campo **Trabajadores \*** se mantiene, porque es el número declarado que define cuántos estándares de la Res. 0312 aplican. Si no coincide con las vinculaciones registradas, el botón **«Usar las N»** lo actualiza.

### 3. Quitar la palabra «ocupacional» y dejar solo «Salud»
**Qué se hizo:** el menú y el título del módulo ahora dicen **Salud**.

**Para tener en cuenta:** el cambio también tiene respaldo legal. Desde la Ley 1562 de 2012, «salud ocupacional» se reemplazó por «Seguridad y Salud en el Trabajo». El módulo sigue sin guardar historia clínica. Solo maneja el concepto de aptitud, las restricciones y recomendaciones, y las incapacidades sin diagnóstico (Res. 1843 de 2025).

### 4. Fórmulas de medición de los indicadores (Excel «Matriz de indicadores año 2026»)
**Qué se hizo:**
- En **Registrar medición**, al elegir un indicador se muestran su **fórmula oficial** y los **nombres reales** de los dos valores que hay que digitar. Por ejemplo, para Frecuencia de accidentalidad: *«N.º de accidentes de trabajo en el mes»* y *«N.º de trabajadores en el mes»*. Ya no aparecen los genéricos «Ejecutado/Programado».
- El **resultado** se calcula mientras se escribe, con el factor de cada indicador (×100 o ×100.000).
- Si el indicador es anual, el periodo cambia solo al formato AAAA.
- En los indicadores de estructura se registra existe (1) / no existe (0).
- Cada grupo (Resultado, Estructura, Proceso) muestra su **porcentaje de cumplimiento** con la misma fórmula de la hoja E-P-R del Excel: ítems cumplidos / ítems evaluados × 100.

**Para tener en cuenta:**
- Los seis indicadores del Excel ya estaban en el sistema con la fórmula del art. 30 de la Res. 0312 de 2019: severidad, frecuencia, proporción de AT mortales, prevalencia e incidencia de EL, y ausentismo.
- No hace falta digitarlos cada mes. El botón **Recalcular** los saca de los módulos (Incidentes/AT/EL, Personas, Ausentismo). El registro manual queda para corregir o completar.
- La **meta**, el **responsable** y la **frecuencia** de cada indicador (las columnas del Excel) se definen en la **Ficha técnica** (icono al final de cada fila). Para que el porcentaje E-P-R tenga sentido, hay que poner la meta de cada indicador. Sin meta, un indicador se muestra pero no se evalúa.
- **Diferencia con el Excel:**
  - **Proporción de AT mortales:** el Excel la mide mensual y el sistema anual, como la define la norma.
  - **Ausentismo:** el sistema toma como «días programados» los días hábiles del mes por el número de trabajadores.

---

## Correo del 20 de octubre

### 5. Plan anual de trabajo: casilla para el objetivo en la actividad
**Qué se hizo:**
- La casilla **Objetivo** ya existía en «Actividad del cronograma». Salía en «Ninguno» porque el plan todavía no tenía objetivos creados. Ahora, cuando no hay objetivos, el formulario explica dónde crearlos.
- En el cronograma, cada actividad muestra debajo el objetivo al que pertenece.

**Para tener en cuenta:** el orden de trabajo es:
1. En la tarjeta **Objetivos y metas** (abajo, en la misma página, botón **+**) se registran los objetivos con su meta y su indicador.
2. Al crear cada actividad se elige a qué objetivo apunta.

Así queda la trazabilidad objetivo → meta → indicador → actividades que pide la Res. 0312. Los objetivos se definen mientras el plan está en borrador, antes de aprobarlo.

### 6. Recursos como lista: Físicos, Tecnológicos y Humanos
**Qué se hizo:** el campo Recursos ahora es una **selección múltiple** con *Físicos*, *Tecnológicos* y *Humanos*. Se pueden marcar varios, porque una actividad casi siempre usa más de uno. Además, quedó un campo **Detalle de recursos** opcional para precisar (por ejemplo: «Sala de juntas y videobeam»). En el cronograma y en el Excel los recursos aparecen como etiquetas.

**Para tener en cuenta:** los recursos **financieros** se registran en el campo **Presupuesto $** de cada actividad. El sistema suma esos presupuestos y los compara con el presupuesto SST del plan.

### 7. Fechas: dejar solo la fecha programada de la actividad
**Qué se hizo:** «Inicio» y «Fin» se reemplazaron por un solo campo, **Fecha programada**, limitado al año del plan. La opción **Reprogramar** también trabaja sobre esa fecha.

**Para tener en cuenta:**
- Una actividad se marca **vencida** cuando pasa su fecha programada sin ejecutarse.
- Las actividades creadas antes de este cambio conservan sus dos fechas y se ven igual que antes.

### 8. Descargar el Plan de Trabajo en Excel
**Qué se hizo:** botón **Excel** en la barra del plan de trabajo. Descarga un archivo `.xlsx` con dos hojas:
- **Plan de trabajo:**
  - Encabezado: empresa y NIT, vigencia, estado, presupuesto y cumplimiento al corte.
  - Columnas del cronograma: N.º, actividad, objetivo, meta, PHVA, responsable, fecha programada, recursos, detalle de recursos, presupuesto, estado, fecha de ejecución y observación.
- **Objetivos y metas**, con el indicador asociado.

**Para tener en cuenta:** el plan que exige la norma es el **firmado** por el representante legal. El Excel se puede usar como base para ese documento. Una vez firmado, se sube en **Documentos** como tipo PLAN_ANUAL y se asocia al plan para aprobarlo.

### 9. Matriz de peligros: Zona/Lugar después de Proceso, y Cargo
**Qué se hizo:**
- Se agregó **Zona / Lugar** justo después de Proceso, como en el Anexo B de la GTC 45. El campo sugiere las zonas que ya se han usado.
- **Cargo** ahora está en la sección **Identificación**, después de Actividad y Tarea. Se pueden seleccionar varios con Ctrl + clic.
- La zona también se ve en la tabla de la matriz y sale en el CSV exportado.

**Para tener en cuenta:** la casilla de cargos **ya existía** con el nombre «Cargos expuestos» (al final de Valoración). Se movió y no se duplicó. Los cargos marcados alimentan las necesidades de formación y el perfil de riesgo de cada cargo.

### 10. Sección final «Jerarquización de controles GTC 45»
**Qué se hizo:** al final del formulario del peligro hay una sección nueva, **Jerarquización de controles (GTC 45)**. Tiene una casilla por cada nivel de las Medidas de Intervención de la matriz:
1. Eliminación
2. Sustitución
3. Controles de ingeniería
4. Controles administrativos, señalización y advertencia
5. Equipos y elementos de protección personal

Cada medida escrita queda registrada como **propuesta** en el plan de intervención. Al editar un peligro, la sección muestra las medidas que ya tiene y su estado (propuesta, implementada o descartada). Si el peligro se eligió del catálogo, en la misma sección aparecen las medidas sugeridas para marcar.

**Para tener en cuenta:**
- Las medidas propuestas se cierran (implementada o descartada) desde la matriz, con el enlace «cerrar» junto a cada medida. Su avance alimenta el indicador de proceso **«Intervención de peligros identificados»**.
- Para los riesgos de nivel I y II el sistema avisa si no tienen medidas, o si solo tienen EPP o controles administrativos (D. 1072, art. 2.2.4.6.24).
- El **CSV de la matriz** ahora sale en el orden del Anexo B, con una columna por cada nivel de la jerarquía.
