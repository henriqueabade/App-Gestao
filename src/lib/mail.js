const transporter = require('../email/transporter');

function isEmailSendingEnabled() {
  const flag = process.env.EMAIL_SENDING_ENABLED;
  if (typeof flag !== 'string') {
    return false;
  }
  const normalized = flag.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return ['true', '1', 'yes', 'on'].includes(normalized);
}

async function sendMail(options) {
  if (!options || typeof options !== 'object') {
    throw new TypeError('sendMail(options) exige um objeto de opções.');
  }

  const { to, subject, fromOverride, ...mailOptions } = options;

  if (!to) {
    throw new Error('Parâmetro "to" é obrigatório para envio de e-mail.');
  }

  const finalOptions = {
    ...mailOptions,
    to
  };

  if (fromOverride) {
    finalOptions.from = fromOverride;
  }

  if (subject) {
    finalOptions.subject = subject;
  }

  if (!finalOptions.subject) {
    throw new Error('Parâmetro "subject" é obrigatório para envio de e-mail.');
  }

  // O RETORNO DIZ SE O E-MAIL SAIU.
  //
  // Antes esta função resolvia igual nos dois casos, e quem chamava não tinha
  // como saber que o envio estava desligado por configuração. A tela então
  // afirmava "enviamos um e-mail" enquanto nada tinha sido enviado — e o
  // usuário esperava por uma mensagem que nunca chegaria.
  if (!isEmailSendingEnabled()) {
    const motivo = 'envio de e-mail desativado no servidor (EMAIL_SENDING_ENABLED)';
    console.info(
      `Email disabled (EMAIL_SENDING_ENABLED=false) – skipped sending to ${to}` +
        (finalOptions.subject ? ` (subject="${finalOptions.subject}")` : '')
    );
    return { enviado: false, motivo };
  }

  await transporter.sendMail(finalOptions);
  return { enviado: true, motivo: null };
}

module.exports = {
  sendMail,
  isEmailSendingEnabled
};
