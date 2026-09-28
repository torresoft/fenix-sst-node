// EPP: modal de entrega (precarga desde la matriz) y planilla segun la modalidad de firma.
(function ($) {
  'use strict';

  var form = $('#form-entrega');

  function modalidad() {
    var manuscrita = form.find('.js-modalidad').val() === 'manuscrita';
    form.find('.js-planilla').toggleClass('d-none', !manuscrita);
    form.find('[name="documento_id"]').prop('required', manuscrita);
  }

  form.find('.js-modalidad').on('change', modalidad);

  // Sin usuario no hay firma electronica posible.
  form.find('[name="persona_id"]').on('change', function () {
    var conUsuario = String($(this).find(':selected').data('usuario')) === '1';
    form.find('.js-modalidad option[value="electronica"]').prop('disabled', !conUsuario);
    if (!conUsuario) form.find('.js-modalidad').val('manuscrita');
    modalidad();
  });

  $('.js-entregar').on('click', function () {
    var b = $(this);
    form.trigger('reset');
    if (b.data('persona')) form.find('[name="persona_id"]').val(String(b.data('persona'))).trigger('change');
    if (b.data('elemento')) form.find('[name="elemento_id"]').val(String(b.data('elemento')));
    if (b.data('cantidad')) form.find('[name="cantidad"]').val(b.data('cantidad'));
    if (b.data('motivo')) form.find('[name="motivo"]').val(b.data('motivo'));
    modalidad();
    $('#modal-entrega').modal('show');
  });
}(jQuery));
