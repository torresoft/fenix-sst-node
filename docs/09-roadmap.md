# 09 · Roadmap

Orden por dependencia tecnica y por velocidad de llegada a un producto
demostrable. Criterio: la primera version vendible es la que ya calcula el
puntaje de la Res. 0312, porque es lo unico que el cliente puede comparar con
su realidad actual.

| Fase | Alcance | Por que en este orden |
|---|---|---|
| **F1 · Cimientos** | M01 empresa y perfil de aplicabilidad · M02 personas · M03 gestor documental con versionado, firma y retencion · auditoria append-only · multitenancy · helper de dias habiles | Todo lo demas escribe aqui. Si el gestor documental y el log se hacen mal, se rehace el producto entero. |
| **F2 · MVP vendible** | M04 matriz legal + auditor de derogadas · M11 autoevaluacion Res. 0312 · M06 plan de trabajo anual · M12 indicadores basicos · exportacion del expediente | Con esto el cliente ve su puntaje real y su brecha. Demostrable en una reunion de 20 minutos. |
| **F3 · Operacion diaria** | M05 peligros y riesgos · M08 eventos con relojes de 2 y 15 dias · M07 formacion y competencias · M10 comites · motor de alertas | Es lo que hace que el usuario entre todos los dias en vez de una vez al anio. |
| **F4 · Salud y personas** | M09 salud ocupacional bajo Res. 1843/2025 · M17 convivencia, acoso y salud mental · consentimientos versionados | El bloque con mas carga juridica; abordarlo cuando la arquitectura de permisos ya este probada. |
| **F5 · Alto riesgo** | M13 emergencias · M14 inspecciones y EPP · M15 permisos de alto riesgo · M16 contratistas | Habilita a los clientes de riesgo IV y V, que son los que mas pagan. |
| **F6 · Especificos** | M18 PESV, quimicos y sectoriales · integraciones PILA / ARL / nomina | Diferenciacion por nicho una vez el nucleo este estable. |

## Decisiones a tomar antes de escribir codigo

1. **¿El producto incluye modulo clinico?** Si si, es otro dominio de datos y
   probablemente otro producto. Si no, el modulo de salud se limita a conceptos
   de aptitud y restricciones: mucho mas simple y sin exposicion a la sancion de
   cierre por datos sensibles.
2. **Region de hosting.** Determina si hay transferencia internacional de datos
   sensibles y que contratos se necesitan.
3. **Metodologia de valoracion de riesgos.** ¿Se fija GTC 45 o se hace
   configurable? Configurable cuesta el triple; fijarla cierra la puerta a
   clientes que ya usan otra.
4. **Modelo de firma.** Firma electronica propia cubre casi todo. La digital
   certificada solo se necesita para conceptos medicos y, opcionalmente, la
   autoevaluacion.
5. **Quien mantiene los catalogos normativos.** Es trabajo recurrente y
   especializado. Sin alguien asignado, el diferenciador principal del producto
   se degrada en doce meses.

## Planes comerciales

La segmentacion ya la hizo la Resolucion 0312: 7, 21 y 60 estandares.
Tres planes que corresponden a tres realidades operativas distintas, con precios
defendibles porque el cliente entiende de donde salen.

Cuarto perfil: **consultor SST** que atiende varias empresas desde una cuenta,
con cambio de empresa sin cerrar sesion y tablero consolidado de sus clientes.
Es canal de distribucion, no solo un rol.

## Integraciones que valen la pena

- **Cargue a `sgrl.mintrabajo.gov.co`** — hoy manual; generar el archivo listo
  ya es valor. Vigilar si el Ministerio expone un canal automatizado.
- **PILA** — verificacion de afiliacion y pago al SGRL de contratistas e
  independientes, exigida por el art. 2.2.4.6.28.
- **ARL** — cada ARL tiene su propio portal; no hay estandar. Empezar por
  exportar el FURAT en el formato que acepte la ARL del cliente.
- **Nomina / RRHH del cliente** — ingresos y retiros deben llegar solos: un
  retiro no registrado rompe el reloj de conservacion de 20 anios y deja
  examenes de egreso sin practicar.
