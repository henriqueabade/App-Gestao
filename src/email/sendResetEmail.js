// src/email/sendResetEmail.js
const fs = require('fs');
const path = require('path');
const { sendMail } = require('../lib/mail'); // usamos o mesmo transporte verificado

// Visual: o modelo dos e-mails do Monitoramento Túnel Bancos Físicos
// (emailTemplate em monitor.js) — fundo vinho, cartão com a logo redonda no
// topo, título dourado e o código na faixa dourada, como o PIN. É o MESMO
// e-mail que a API manda em PROD (Santissimo-db-API/senha/email.js): mudou
// um, mude o outro.
const LOGO_ARQUIVO = path.join(__dirname, '../assets/Logo SideBar.png');
const LOGO_CID = 'logo-sidebar';

function escapar(texto) {
  return String(texto ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** O código em dois blocos de 4 ("1234 5678"), mais fácil de ler e digitar. */
function codigoLegivel(codigo) {
  const c = String(codigo);
  return c.length === 8 ? `${c.slice(0, 4)} ${c.slice(4)}` : c;
}

/** O cartão padrão dos e-mails da Santíssimo (logo, título dourado, conteúdo). */
function modeloDoEmail(titulo, conteudoHtml, { comLogo = true } = {}) {
  const logo = comLogo
    ? `<img src="cid:${LOGO_CID}" alt="Santíssimo Decor" width="150" style="width:150px;margin-bottom:18px;">`
    : '';
  return `
  <div style="margin:0;padding:32px;background:linear-gradient(135deg,#310017 0%,#1a0009 100%);
    font-family:'Segoe UI',Arial,Helvetica,sans-serif;color:#f7f2d2;">
    <table role="presentation" cellspacing="0" cellpadding="0"
      style="width:100%;max-width:560px;margin:0 auto;background:#310017;
      border-radius:20px;overflow:hidden;box-shadow:0 22px 60px rgba(0,0,0,0.38);
      border:1px solid rgba(182,160,62,0.28);">
      <tr>
        <td style="padding:30px;text-align:center;
          background:linear-gradient(135deg,rgba(106,21,44,0.92) 0%,rgba(49,0,23,0.95) 100%);
          border-bottom:1px solid rgba(212,193,105,0.4);">
          ${logo}
          <h1 style="margin:0;font-size:24px;font-weight:600;color:#d4c169;">
            ${titulo}
          </h1>
        </td>
      </tr>
      <tr>
        <td style="padding:32px;color:#f7f2d2;font-size:14px;line-height:1.6;">
          ${conteudoHtml}
        </td>
      </tr>
    </table>
    <p style="margin:26px auto 0;text-align:center;font-size:11px;
      color:rgba(247,242,210,0.55);max-width:540px;">
      Santíssimo Decor · Aplicativo de Gestão
    </p>
  </div>`;
}

function htmlDoCodigo({ nome, codigo, validadeMin }, opcoes) {
  const primeiroNome = String(nome || '').trim().split(/\s+/)[0];
  const saudacao = primeiroNome ? `Olá <strong>${escapar(primeiroNome)}</strong>,` : 'Olá,';
  return modeloDoEmail(
    '🔐 Código para Nova Senha',
    `
    <p style="margin:0 0 12px;">${saudacao}</p>
    <p style="margin:0 0 12px;">Recebemos um pedido para criar uma nova senha no aplicativo.
      Em <strong>Esqueceu a senha?</strong>, digite este código:</p>
    <div style="margin:20px 0;padding:20px;background:linear-gradient(135deg,#b6a03e 0%,#7f6a27 100%);
      border-radius:16px;text-align:center;">
      <span style="font-size:34px;font-weight:bold;color:#310017;letter-spacing:6px;">
        ${escapar(codigoLegivel(codigo))}
      </span>
    </div>
    <p style="margin:0 0 18px;">Vale por <strong>${escapar(validadeMin)} minutos</strong> e só pode ser usado uma vez.
      Se pedir outro, só o último vale.</p>
    <div style="padding:14px 16px;background:rgba(20,4,11,0.62);border:1px solid rgba(212,193,105,0.32);border-radius:12px;">
      <span style="display:inline-block;padding:4px 10px;margin-bottom:8px;border-radius:999px;
        background:rgba(212,193,105,0.2);color:#d4c169;font-size:11px;font-weight:700;
        letter-spacing:.4px;text-transform:uppercase;">Não foi você?</span>
      <p style="margin:0;color:#f7f2d2;line-height:1.55;">Ignore este e-mail: sua senha continua a mesma.
        Ninguém troca a senha sem este código.</p>
    </div>
    `,
    opcoes
  );
}

/**
 * Envia o CÓDIGO do "Esqueceu a senha?" (só com BANCO=DEV: em PROD quem manda
 * é a API, com este mesmo e-mail).
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
  const comLogo = fs.existsSync(LOGO_ARQUIVO);
  return sendMail({
    envelope: { from: process.env.FROM_EMAIL, to: email },
    fromOverride: `"Santíssimo Decor" <${process.env.FROM_EMAIL}>`,
    to: email,
    subject: '🔐 Código para criar uma nova senha',
    text: `Seu código para criar uma nova senha no aplicativo: ${codigoLegivel(codigo)}\n` +
      `Vale por ${validadeMin} minutos. Se não foi você, ignore este e-mail.`,
    html: htmlDoCodigo({ nome, codigo, validadeMin }, { comLogo }),
    attachments: comLogo ? [{ filename: 'logo.png', path: LOGO_ARQUIVO, cid: LOGO_CID }] : []
  });
}

module.exports = { sendResetEmail, htmlDoCodigo, codigoLegivel, LOGO_ARQUIVO };
