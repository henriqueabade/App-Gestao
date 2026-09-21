// src/email/sendResetEmail.js
const { sendMail } = require('../lib/mail'); // usamos o mesmo transporte verificado
const { getLogoAttachment, renderLogoImage } = require('./logo');

/** O código em dois blocos de 4 ("1234 5678"), mais fácil de ler e digitar. */
function codigoLegivel(codigo) {
  const c = String(codigo);
  return c.length === 8 ? `${c.slice(0, 4)} ${c.slice(4)}` : c;
}

/**
 * Envia o CÓDIGO do "Esqueceu a senha?" (só com BANCO=DEV: em PROD quem manda
 * é a API, em Santissimo-db-API/senha/email.js, com o mesmo texto).
 *
 * Antes mandava um link para localhost:3000/reset-password, página que o
 * servidor local não servia e que não abriria no celular nem com o app
 * fechado. O código é digitado na própria tela de login.
 *
 * @param {{email: string, nome?: string, codigo: string, validadeMin: number}} dados
 * @returns {Promise<{enviado: boolean, motivo: string|null}>} se saiu de fato —
 *   com o envio desligado por configuração, nada é enviado e quem chamou
 *   precisa saber disso para não prometer um e-mail que não existe.
 */
async function sendResetEmail({ email, nome, codigo, validadeMin }) {
  const primeiroNome = nome ? String(nome).split(' ')[0].replace(/[<>&"]/g, '') : '';
  return sendMail({
    envelope: { from: process.env.FROM_EMAIL, to: email },
    fromOverride: `"Santíssimo Decor" <${process.env.FROM_EMAIL}>`,
    to: email,
    subject: 'Código para criar uma nova senha',
    text: `Seu código para criar uma nova senha no aplicativo: ${codigoLegivel(codigo)}\n` +
      `Vale por ${validadeMin} minutos. Se não foi você, ignore este e-mail.`,
    html: `
      <div style="font-family: 'Segoe UI', Tahoma, sans-serif; color: #1f2937; line-height: 1.6; max-width: 480px;">
        ${renderLogoImage()}
        <p>${primeiroNome ? `Olá, ${primeiroNome}.` : 'Olá.'} Recebemos um pedido para criar uma nova senha.</p>
        <p>No aplicativo, em <b>Esqueceu a senha?</b>, digite este código:</p>
        <p style="font-size: 30px; font-weight: 700; letter-spacing: 6px; color: #3d021f; margin: 16px 0;">${codigoLegivel(codigo)}</p>
        <p>O código vale por ${validadeMin} minutos e só pode ser usado uma vez.</p>
        <p style="color: #6b7280; font-size: 13px;">Se não foi você, ignore este e-mail: sua senha continua a mesma.</p>
      </div>
    `,
    attachments: [getLogoAttachment()]
  });
}

module.exports = { sendResetEmail, codigoLegivel };
