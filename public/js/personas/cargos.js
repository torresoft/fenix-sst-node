// Cargos: modal de alta y edicion; el cargo tipo sugiere nombre y funciones si estan vacios.
(function ($) {
  'use strict';

  var form = $('#form-cargo');
  var tipos = {};
  (form.data('tipos') || []).forEach(function (t) { tipos[t.codigo] = t; });

  $('.js-nuevo').on('click', function () {
    form.trigger('reset').find('[name="id"]').val('');
    form.find('.js-titulo').text('Nuevo cargo');
    $('#modal-cargo').modal('show');
  });

  $('.js-editar').on('click', function () {
    var b = $(this);
    form.find('[name="id"]').val(b.data('id'));
    form.find('[name="nombre"]').val(b.data('nombre'));
    form.find('[name="cargo_tipo_codigo"]').val(b.data('tipo') || '');
    form.find('[name="descripcion"]').val(b.data('descripcion'));
    form.find('[name="perfil_riesgo"]').val(b.data('perfil'));
    form.find('.js-titulo').text('Editar cargo');
    $('#modal-cargo').modal('show');
  });

  form.on('change', '.js-tipo', function () {
    var t = tipos[this.value];
    if (!t) return;
    ['nombre', 'descripcion'].forEach(function (n) {
      var c = form.find('[name="' + n + '"]');
      if (!$.trim(c.val())) c.val(t[n] || '');
    });
  });
}(jQuery));
