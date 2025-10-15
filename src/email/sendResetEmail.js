// src/email/sendResetEmail.js
const { sendMail } = require('../lib/mail'); // usamos o mesmo transporte verificado
const { getLogoAttachment, renderLogoImage } = require('./logo');

/**
 * Envia o e-mail de redefinição de senha
 * @param {string} to — e-mail de destino
 * @param {string} token — token gerado pela rota
 */
async function sendResetEmail(to, token) {
  const resetLink = `${process.env.APP_URL}/reset-password?token=${token}`;

  await sendMail({
    envelope: { from: process.env.FROM_EMAIL, to },
    fromOverride: `"Santíssimo Decor" <${process.env.FROM_EMAIL}>`,
    to,
    subject: 'Redefinição de senha',
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, sans-serif; color: #1f2937; line-height: 1.6;">
        ${renderLogoImage()}
        <p>Você solicitou a redefinição de sua senha.</p>
        <p>Clique no link abaixo para criar uma nova senha. O link expira em 30 minutos.</p>
        <p><a href="${resetLink}" style="color: #b6a03e;">${resetLink}</a></p>
      </div>
    `,
    attachments: [getLogoAttachment()]
  });
}

module.exports = { sendResetEmail };
