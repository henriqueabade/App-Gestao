const { sendMail } = require('../lib/mail');
const { getLogoAttachment, renderLogoImage } = require('./logo');

/**
 * Envia o e-mail de confirmação de cadastro
 * @param {string} to   - endereço de e-mail do usuário
 * @param {string} nome - nome do usuário
 */
async function sendRegistrationEmail(to, nome) {
  const html = `
    <div style="font-family: 'Segoe UI', Tahoma, sans-serif; color: #1f2937; line-height: 1.6;">
      ${renderLogoImage()}
      <p>Olá ${nome}! 👋</p>
      <p>Seja muito bem-vindo(a) à plataforma Santíssimo Decor – Objetos de Design. Seu cadastro foi registrado com sucesso! 🔐✨</p>
      <p><strong>O que acontece agora?</strong></p>
      <ul>
        <li>Por segurança, nosso time precisa validar suas informações.</li>
        <li>Assim que o(a) Administrador(a) aprovar seu acesso, você receberá um novo e-mail de confirmação.</li>
        <li>Somente depois desse e-mail você conseguirá entrar no sistema com suas credenciais.</li>
      </ul>
      <p><strong>Precisa de ajuda?</strong></p>
      <p>Se tiver qualquer dúvida, basta responder a esta mensagem ou entrar em contato pelo suporte 📞 (suporte@santissimodecor.com.br). Estamos à disposição!</p>
      <p>Agradecemos a confiança e esperamos vê-lo(a) em breve utilizando todas as funcionalidades que preparamos com carinho. 🌟</p>
      <p>Cordialmente,<br>Equipe Santíssimo Decor<br>“Detalhes que transformam ambientes” 🏛️</p>
    </div>
  `;

  await sendMail({
    envelope: { from: process.env.FROM_EMAIL, to },
    fromOverride: `"Santíssimo Decor" <${process.env.FROM_EMAIL}>`,
    to,
    subject: 'Cadastro registrado',
    html,
    attachments: [getLogoAttachment()]
  });
}

module.exports = { sendRegistrationEmail };
