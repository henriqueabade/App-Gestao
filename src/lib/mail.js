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

  if (!isEmailSendingEnabled()) {
    console.info(
      `Email disabled (EMAIL_SENDING_ENABLED=false) – skipped sending to ${to}` +
        (finalOptions.subject ? ` (subject="${finalOptions.subject}")` : '')
    );
    return Promise.resolve();
  }

  await transporter.sendMail(finalOptions);
}

module.exports = {
  sendMail,
  isEmailSendingEnabled
};
