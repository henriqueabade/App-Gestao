// src/email/sendResetEmail.js
const transporter = require('./transporter'); // usamos o mesmo transporter verificado

/**
 * Envia o e-mail de redefinição de senha
 * @param {string} to — e-mail de destino
 * @param {string} token — token gerado pela rota
 */
async function sendResetEmail(to, token) {
  const resetLink = `${process.env.APP_URL}/reset-password?token=${token}`;

  await transporter.sendMail({
    envelope: { from: process.env.FROM_EMAIL, to },
    from: `"Santíssimo Decor" <${process.env.FROM_EMAIL}>`,
    to,
    subject: 'Redefinição de senha',
    html: `
      <p>Você solicitou a redefinição de sua senha.</p>
      <p>Clique no link abaixo para criar uma nova senha. O link expira em 30 minutos.</p>
      <p><a href="${resetLink}">${resetLink}</a></p>
    `
  });
}

module.exports = { sendResetEmail };
