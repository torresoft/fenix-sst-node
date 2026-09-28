// Salud: enfasis sugerido y modales de concepto y adaptacion.
(function ($) {
  'use strict';

  $('.js-persona-orden').on('change', function () {
    var enfasis = $('#form-orden [name="enfasis"]');
    if (!this.value || enfasis.val()) return;
    $.get('/salud/enfasis', { persona_id: this.value }).done(function (r) { if (r.enfasis) enfasis.val(r.enfasis); });
  });

  $('.js-concepto').on('click', function () {
    var b = $(this);
    var form = $('#form-concepto').attr('action', '/salud/evaluaciones/' + encodeURIComponent(b.data('id')) + '/concepto');
    form.find('.js-nombre').text(b.data('nombre'));
    form.find('[name="fecha_examen"]').attr('min', b.data('orden')).val('');
    form.find('.js-proximo').toggle(b.data('tipo') !== 'egreso');
    // Solo conceptos de esta persona (o sin persona asignada).
    form.find('[name="documento_id"] option').each(function () {
      var p = String($(this).data('persona') || '');
      $(this).toggle(!this.value || !p || p === String(b.data('persona')));
    });
    form.find('[name="documento_id"]').val('');
    $('#modal-concepto').modal('show');
  });

  $('.js-adaptacion').on('click', function () {
    var form = $('#form-adaptacion').attr('action', '/salud/evaluaciones/' + encodeURIComponent($(this).data('id')) + '/adaptacion');
    form.find('[name="fecha"]').attr('min', $(this).data('examen'));
    form.find('[name="observacion"]').val('');
    $('#modal-adaptacion').modal('show');
  });
}(jQuery));
