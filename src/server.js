const config = require('./config');
const fechas = require('./fechas');
const app = require('./app');

(async () => {
  const cal = await fechas.inicializar();
  app.listen(config.puerto, () => {
    console.info(`fenix-sst escuchando en :${config.puerto} (festivos ${cal.desde} a ${cal.hasta}, TZ ${config.zonaHoraria})`);
  });
})().catch((err) => {
  console.error('No se pudo iniciar:', err.message);
  process.exit(1);
});
