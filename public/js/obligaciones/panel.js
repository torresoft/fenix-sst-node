// Panel de obligaciones: modales de cumplimiento / responsable.
(function ($) {
  'use strict';

  $('.js-cumplir').on('click', function () {
    var b = $(this);
    var form = $('#form-cumplir');
    form.attr('action', '/obligaciones/' + encodeURIComponent(b.data('id')) + '/cumplir');
    form.find('[name="empresa_id"]').val(b.data('empresa'));
    form.find('[name="fecha"]').attr('min', b.data('disparo'));
    form.find('[name="observacion"]').val('');
    form.find('.js-descripcion').text(b.data('descripcion'));
    $('#modal-cumplir').modal('show');
  });

  $('.js-responsable').on('click', function () {
    var b = $(this);
    var form = $('#form-responsable');
    var select = form.find('[name="responsable_id"]');
    form.attr('action', '/obligaciones/' + encodeURIComponent(b.data('id')) + '/responsable');
    form.find('[name="empresa_id"]').val(b.data('empresa'));
    form.find('.js-descripcion').text(b.data('descripcion'));
    select.prop('disabled', true).find('option:not(:first)').remove();

    $.get('/obligaciones/responsables', { empresa_id: b.data('empresa') }).done(function (r) {
      $.each(r.usuarios || [], function (i, u) {
        select.append($('<option>').val(u.id).text(u.nombre));
      });
      select.val(String(b.data('responsable') || '')).prop('disabled', false);
    });
    $('#modal-responsable').modal('show');
  });
}(jQuery));
