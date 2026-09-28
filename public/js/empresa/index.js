// Empresa: modal de centro de trabajo (alta y edicion).
(function ($) {
  'use strict';

  var form = $('#form-centro');

  $('.js-nuevo-centro').on('click', function () {
    form.attr('action', '/empresa/centros').trigger('reset');
    form.find('.js-titulo').text('Nuevo centro de trabajo');
    $('#modal-centro').modal('show');
  });

  $('.js-editar-centro').on('click', function () {
    var b = $(this);
    form.attr('action', '/empresa/centros/' + encodeURIComponent(b.data('id')));
    form.find('.js-titulo').text('Editar centro de trabajo');
    form.find('[name="nombre"]').val(b.data('nombre'));
    form.find('[name="clase_riesgo"]').val(b.data('clase'));
    form.find('[name="direccion"]').val(b.data('direccion'));
    form.find('[name="municipio_divipola"]').val(String(b.data('municipio') || ''));
    form.find('[name="numero_trabajadores"]').val(b.data('trabajadores'));
    $('#modal-centro').modal('show');
  });
}(jQuery));
