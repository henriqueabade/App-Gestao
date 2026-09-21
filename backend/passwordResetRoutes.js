// backend/passwordResetRoutes.js — "Esqueceu a senha?" da tela de login.
//
// Fluxo (docs/redefinicao-de-senha.md): a tela pede um código pelo e-mail
// (POST /password-reset-request), o código de 8 números chega ao e-mail
// cadastrado e a própria tela troca a senha com ele (POST /password-reset).
//
// Quem esqueceu a senha não tem sessão. Antes estas rotas exigiam o token do
// app e liam/gravavam pela API genérica: em PROD, na tela de login, não há JWT
// válido e tudo caía em 401; o e-mail trazia um link para localhost que o
// servidor local nem servia (e que não abre no celular nem com o app fechado).
// Agora:
//   - PROD: repassa para a API (/senha/esqueci e /senha/redefinir, públicas).
//     O código nasce e sai por e-mail de lá — nunca passa por aqui;
//   - DEV: faz o mesmo contra o banco local (backend/redefinicaoSenha.js).
// A senha nova segue a regra de src/js/utils/senha-forte.js, conferida aqui
// antes de sair e de novo por quem grava. Senha trocada libera o bloqueio de
// tentativas de login desta máquina (main.js escuta `eventos`).

const express = require('express');
const bcrypt = require('bcrypt');
const { EventEmitter } = require('events');
const { isDev } = require('./dataConfig');
const SenhaForte = require('../src/js/utils/senha-forte');
const { criarRedefinicaoDeSenha, normalizarCodigo } = require('./redefinicaoSenha');

const router = express.Router();
const eventos = new EventEmitter();

const API_BASE_URL = (
  (process.env.API_BASE_URL && process.env.API_BASE_URL.trim()) ||
  (process.env.API_URL && process.env.API_URL.trim()) ||
  'https://api.santissimodecor.com.br'
).replace(/\/+$/, '').replace(/\/api$/, '');

// Trocáveis só pelos testes.
const dependencias = { fetch: (...args) => fetch(...args), emDev: isDev, local: null };

function redefinicaoLocal() {
  if (!dependencias.local) {
    dependencias.local = criarRedefinicaoDeSenha({
      pool: require('./localDatabase'),
      bcrypt,
      mensagemDaSenha: SenhaForte.mensagem,
      enviarCodigo: async dados => {
        const envio = await require('../src/email/sendResetEmail').sendResetEmail(dados);
        // Só em DEV e só com o envio desligado: sem isto não há como testar.
        if (envio?.enviado === false) {
          console.info(`[senha] DEV com e-mail desligado — código para ${dados.email}: ${dados.codigo}`);
        }
        return envio;
      }
    });
  }
  return dependencias.local;
}

/** Chama a rota pública da API e devolve { status, corpo } para a tela. */
async function naApi(caminho, corpo) {
  let resposta;
  try {
    resposta = await dependencias.fetch(`${API_BASE_URL}${caminho}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo)
    });
  } catch (err) {
    console.error(`[senha] sem resposta da API em ${caminho}:`, err?.message || err);
    return { status: 503, corpo: { error: 'Sem conexão com o servidor. Verifique a internet e tente de novo.' } };
  }
  const dados = await resposta.json().catch(() => null);
  if (!dados || typeof dados !== 'object') {
    // 404 sem JSON = a API ainda não tem as rotas (não foi atualizada).
    const error = resposta.status === 404
      ? 'O servidor ainda não tem a troca de senha pelo código. Avise o administrador para atualizar a API.'
      : 'Resposta inesperada do servidor. Tente de novo em instantes.';
    return { status: 503, corpo: { error } };
  }
  return { status: resposta.status, corpo: dados };
}

function responder(res, { status, corpo }) {
  res.status(status).json(corpo);
}

router.post('/password-reset-request', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  try {
    const resultado = dependencias.emDev
      ? await redefinicaoLocal().pedirCodigo({ email })
      : await naApi('/senha/esqueci', { email });
    if (resultado.status === 200) resultado.corpo = { ...resultado.corpo, dev: dependencias.emDev };
    responder(res, resultado);
  } catch (err) {
    console.error('password-reset-request error', err);
    res.status(500).json({ error: 'Não foi possível pedir o código agora. Tente de novo em instantes.' });
  }
});

router.post('/password-reset', async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const codigo = normalizarCodigo(req.body?.codigo);
  const novaSenha = typeof req.body?.novaSenha === 'string' ? req.body.novaSenha : '';

  // Conferido aqui para a resposta ser imediata; quem grava confere de novo.
  if (codigo.length !== 8) {
    return res.status(400).json({ error: 'Informe o código de 8 números que chegou no e-mail.' });
  }
  const fraca = SenhaForte.mensagem(novaSenha);
  if (fraca) return res.status(400).json({ error: fraca });

  try {
    const resultado = dependencias.emDev
      ? await redefinicaoLocal().redefinir({ email, codigo, novaSenha })
      : await naApi('/senha/redefinir', { email, codigo, novaSenha });
    if (resultado.status === 200) eventos.emit('senha-redefinida', email);
    responder(res, resultado);
  } catch (err) {
    console.error('password-reset error', err);
    res.status(500).json({ error: 'Não foi possível trocar a senha agora. Tente de novo em instantes.' });
  }
});

module.exports = router;
module.exports.eventos = eventos;
module.exports._dependencias = dependencias;
