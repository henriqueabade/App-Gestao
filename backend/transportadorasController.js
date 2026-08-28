/**
 * Transportadoras de um cliente.
 *
 * ---------------------------------------------------------------------------
 * POR QUE O NOME É NORMALIZADO AQUI, E NÃO NA TELA
 *
 * A transportadora é gravada no orçamento como TEXTO — não como id. Duas
 * grafias da mesma empresa ("rodonaves", "RODONAVES", "Rodonaves") viram três
 * transportadoras diferentes na leitura de um relatório, e nada no sistema
 * volta a juntá-las depois.
 *
 * Normalizar na tela resolveria só a tela que lembrasse de fazê-lo. Aqui vale
 * para todo caminho que crie uma — inclusive o preenchimento pela IA e
 * qualquer tela futura.
 */
const express = require('express');
const { createApiClient } = require('./apiHttpClient');

const router = express.Router();

const ENDPOINT = '/api/transportadoras';

/**
 * "rodonaves express" → "Rodonaves Express".
 *
 * Só a inicial de cada palavra: mexer no resto transformaria "JSL" em "Jsl" e
 * "MG Log" em "Mg log" — siglas são metade dos nomes deste ramo.
 */
function comIniciaisMaiusculas(valor) {
  return String(valor ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map(parte => parte.charAt(0).toUpperCase() + parte.slice(1))
    .join(' ');
}

/** Caixa e acento não distinguem uma transportadora de outra. */
const normalizar = v => String(v ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

const comoLista = d => (Array.isArray(d) ? d : []);

function erro(status, mensagem, code) {
  const e = new Error(mensagem);
  e.status = status;
  if (code) e.code = code;
  return e;
}

/** As transportadoras de um cliente, como a tela as consome. */
async function listar(api, clienteId) {
  const linhas = await api.get(ENDPOINT, {
    query: { id_cliente: clienteId, order: 'transportadora' }
  });
  return comoLista(linhas).map(row => ({ id: row.id, nome: row.transportadora }));
}

// GET /api/transportadoras/:clienteId
router.get('/:clienteId', async (req, res) => {
  try {
    const api = createApiClient(req);
    res.json(await listar(api, req.params.clienteId));
  } catch (err) {
    console.error('Erro ao listar transportadoras:', err);
    res.status(err.status || 500).json({ error: 'Erro ao listar transportadoras' });
  }
});

/**
 * POST /api/transportadoras — cadastra uma para o cliente.
 *
 * Devolve a LISTA inteira, e não só a criada: quem chamou vai repintar o
 * seletor, e pedir a lista de novo logo depois seria uma segunda ida ao
 * servidor para saber o que esta resposta já sabe.
 */
router.post('/', async (req, res) => {
  try {
    const api = createApiClient(req);

    const clienteId = Number(req.body?.id_cliente);
    if (!Number.isFinite(clienteId)) throw erro(400, 'Informe o cliente da transportadora');

    const nome = comIniciaisMaiusculas(req.body?.transportadora);
    if (!nome) throw erro(400, 'Informe o nome da transportadora');
    if (nome.length > 120) throw erro(400, 'O nome da transportadora passa de 120 caracteres');

    // Duplicata é o caso comum, não o excepcional: quem não vê a empresa na
    // lista digita o nome dela de novo. Recusar com o nome que JÁ existe é o
    // que faz a pessoa procurar em vez de cadastrar uma segunda vez.
    const atuais = await listar(api, clienteId);
    const igual = atuais.find(t => normalizar(t.nome) === normalizar(nome));
    if (igual) {
      throw erro(409, `"${igual.nome}" já está cadastrada para este cliente`, 'TRANSPORTADORA_DUPLICADA');
    }

    await api.post(ENDPOINT, { id_cliente: clienteId, transportadora: nome });

    const lista = await listar(api, clienteId);
    res.status(201).json({
      nome,
      // O id vem da releitura: o upstream nem sempre devolve o registro criado.
      id: lista.find(t => normalizar(t.nome) === normalizar(nome))?.id ?? null,
      transportadoras: lista
    });
  } catch (err) {
    if (!err.status) console.error('Erro ao cadastrar transportadora:', err);
    res.status(err.status || 500).json({
      error: err.status ? err.message : 'Erro ao cadastrar transportadora',
      ...(err.code ? { code: err.code } : {})
    });
  }
});

/**
 * DELETE /api/transportadoras/:id — remove uma do cliente.
 *
 * O `id_cliente` vem junto e é CONFERIDO. Sem isso, um id qualquer apagaria a
 * transportadora de outra empresa — e o erro só apareceria quando alguém de lá
 * fosse montar um pedido.
 */
router.delete('/:id', async (req, res) => {
  try {
    const api = createApiClient(req);

    const id = Number(req.params.id);
    const clienteId = Number(req.query?.id_cliente ?? req.body?.id_cliente);
    if (!Number.isFinite(id)) throw erro(400, 'Transportadora inválida');
    if (!Number.isFinite(clienteId)) throw erro(400, 'Informe o cliente da transportadora');

    const atuais = await listar(api, clienteId);
    if (!atuais.some(t => Number(t.id) === id)) {
      throw erro(404, 'Esta transportadora não é deste cliente');
    }

    await api.delete(`${ENDPOINT}/${id}`);
    res.json({ sucesso: true, id, transportadoras: await listar(api, clienteId) });
  } catch (err) {
    if (!err.status) console.error('Erro ao excluir transportadora:', err);
    res.status(err.status || 500).json({
      error: err.status ? err.message : 'Erro ao excluir transportadora'
    });
  }
});

module.exports = router;
module.exports.comIniciaisMaiusculas = comIniciaisMaiusculas;
