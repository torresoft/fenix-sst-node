// Job diario del motor de plazos. Programarlo en el cron del servidor, p. ej.:
//   30 6 * * *  cd /ruta/fenix-sst && node scripts/job-diario.js >> logs/job-diario.log 2>&1
// Opciones: --sin-correo  |  --hoy=YYYY-MM-DD (reprocesar un corte)
const { ejecutarJobDiario } = require('../src/plazos/job');
const { procesarVencimientos } = require('../src/plataforma/suscripciones');
const { cerrar } = require('../src/db/carga-catalogos');

const arg = (nombre) => (process.argv.find((a) => a.startsWith(`--${nombre}=`)) || '').split('=')[1];

(async () => {
  const inicio = Date.now();
  try {
    const resumen = await ejecutarJobDiario({ hoy: arg('hoy') || undefined, notificar: !process.argv.includes('--sin-correo') });
    const errores = resumen.filter((r) => r.error).length;
    const sus = await procesarVencimientos(arg('hoy') || undefined, { notificar: !process.argv.includes('--sin-correo') });
    console.info(`job-diario: ${resumen.length} tenant(s), ${errores} con error, ${Date.now() - inicio} ms`);
    console.info(`suscripciones: ${sus.vencidas} vencida(s), ${sus.suspendidos} cliente(s) suspendido(s), ${sus.avisos} aviso(s), ${sus.correos} correo(s)`);
    process.exitCode = errores ? 1 : 0;
  } finally {
    await cerrar();
  }
})().catch((err) => {
  console.error(`job-diario: ${err.message}`);
  process.exit(1);
});
