// Valoracion en vivo del peligro con las escalas de la metodologia (el servidor recalcula al guardar)
// y llenado desde el catalogo de peligros tipo.
(function ($) {
  'use strict';

  var form = $('#form-item');
  var esc = form.data('escalas');
  var catalogo = form.data('catalogo') || {};
  var jerarquia = form.data('jerarquia') || {};
  var colores = { I: 'danger', II: 'warning', III: 'info', IV: 'success' };
  var valor = function (lista, codigo) { var x = lista.filter(function (e) { return e.codigo === codigo; })[0]; return x ? x.valor : 0; };
  var rango = function (lista, v) { return lista.filter(function (e) { return v >= e.min && v <= e.max; })[0]; };
  var campo = function (n) { return form.find('[name="' + n + '"]'); };

  function calcular() {
    var np = valor(esc.nd, campo('nd').val()) * valor(esc.ne, campo('ne').val());
    var nr = np * valor(esc.nc, campo('nc').val());
    var n = rango(esc.nr, nr) || {};
    form.find('.js-resultado').empty()
      .append($('<div class="small text-muted">').text('NP ' + np + ' · NR ' + nr))
      .append($('<span class="badge">').addClass('badge-' + (colores[n.codigo] || 'secondary')).text('Riesgo ' + (n.codigo || '?')))
      .append($('<div class="small">').text(n.aceptabilidad || ''));
  }

  // Medidas del catalogo como casillas; en un peligro nuevo van marcadas.
  function medidas(t, marcar) {
    var caja = form.find('.js-medidas').empty();
    form.find('.js-medidas-card').toggleClass('d-none', !t || !t.controles.length);
    if (!t) return;
    t.controles.forEach(function (c, i) {
      var id = 'med-' + i;
      $('<div class="custom-control custom-checkbox">')
        .append($('<input type="checkbox" class="custom-control-input" name="medidas_sugeridas">').attr({ id: id, value: i }).prop('checked', marcar))
        .append($('<label class="custom-control-label font-weight-normal">').attr('for', id)
          .append($('<span class="badge badge-light mr-1">').text(jerarquia[c.jerarquia] || c.jerarquia))
          .append(document.createTextNode(c.descripcion)))
        .appendTo(caja);
    });
    caja.append($('<small class="text-muted d-block mt-2">').text('Las marcadas se agregan como medidas propuestas del plan de intervencion.'));
  }

  form.on('change', '.js-tipo', function () {
    var t = catalogo[this.value];
    medidas(t, true);
    if (!t) return;
    campo('clase_peligro').val(t.clase);
    campo('peligro').val(t.nombre);
    campo('efectos').val(t.efectos || '');
    campo('peor_consecuencia').val(t.peor || '');
    campo('norma_codigo').val(t.norma || '');
    if (t.nc) campo('nc').val(t.nc);
    calcular();
  });

  form.on('change', '.js-valor', calcular);
  medidas(catalogo[form.find('.js-tipo').val()], form.data('nuevo') === 1);
  calcular();
}(jQuery));
