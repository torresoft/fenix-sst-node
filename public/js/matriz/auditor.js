// Auditor: carga el archivo en el navegador (FileReader) y lo envia como texto.
(function ($) {
  'use strict';

  var LIMITE = 512 * 1024;

  $('#a-archivo').on('change', function () {
    var archivo = this.files && this.files[0];
    var form = $('#form-auditor');
    if (!archivo) return;
    if (archivo.size > LIMITE) {
      window.alert('El archivo supera 512 KB.');
      this.value = '';
      return;
    }
    $(this).next('.custom-file-label').text(archivo.name);
    var lector = new FileReader();
    lector.onload = function () {
      form.find('[name="texto"]').val(lector.result);
      form.find('[name="fuente"]').val('csv');
      form.find('[name="nombre_archivo"]').val(archivo.name);
    };
    lector.readAsText(archivo, 'UTF-8');
  });

  $('#a-texto').on('input', function () {
    var form = $('#form-auditor');
    if (!form.find('[name="nombre_archivo"]').val()) form.find('[name="fuente"]').val('manual');
  });
}(jQuery));
