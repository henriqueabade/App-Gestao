/**
 * GET /api/cep/:cep — o endereço do CEP para o cadastro de clientes e de
 * prospecções (backend/cep.js). Quem abre esses cadastros pode consultar:
 * é dado público de endereço, e a trava real é a da tela que grava.
 *
 * `criarRouter({ buscarNaRede })` existe para o teste não sair para a rede.
 */
const express = require('express');
const cep = require('./cep');
const { exigirAlgumaPermissao } = require('./permissionsController');

function criarRouter({ buscarNaRede = undefined } = {}) {
  const router = express.Router();

  router.get('/:cep', exigirAlgumaPermissao(['cli.view', 'pros.view']), async (req, res) => {
    try {
      const endereco = await cep.buscar(req.params.cep, buscarNaRede ? { buscarNaRede } : undefined);
      res.json(endereco);
    } catch (err) {
      const status = err?.status || 500;
      if (status >= 500) console.error('GET /api/cep:', err?.message || err);
      res.status(status).json({ error: err?.message || 'Não foi possível consultar o CEP.' });
    }
  });

  return router;
}

module.exports = criarRouter();
module.exports.criarRouter = criarRouter;
