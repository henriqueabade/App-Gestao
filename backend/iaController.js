// Rotas do módulo IA.
//
// O módulo lê planilhas, PDFs e fotos e usa o conteúdo para preencher os
// OUTROS módulos. Uma "leitura" (ia_extracoes) é o lote: os arquivos enviados,
// o texto que a IA extraiu de cada um e as linhas estruturadas que saíram daí.
// Nada é gravado no módulo de destino sem passar pela revisão do usuário.
//
// ---------------------------------------------------------------------------
// AS MESMAS TRÊS LIMITAÇÕES DA API REMOTA DE SEMPRE (DEV-ONBOARDING.md, §3)
//
//   1. `order`/`limit`/`offset`/`select` são descartados em silêncio
//      -> ordenar e recortar acontece aqui.
//   2. Não existe filtro por lista de ids (`?id=1&id=2` devolve HTTP 500)
//      -> vínculos se resolvem trazendo a tabela de apoio e casando em memória.
//   3. Não há agregação
//      -> as contagens por situação são feitas aqui.
//
// ---------------------------------------------------------------------------
// POR QUE `dados` DOS ITENS É TEXTO E NÃO OBJETO
//
// `ia_extracao_itens.dados` guarda o JSON do item em uma coluna TEXT. A API é
// um CRUD genérico: devolve a coluna como o driver a serializou, e depender
// disso é exatamente o tipo de suposição que já custou caro neste projeto.
// Com texto, o parse é nosso — e um JSON corrompido vira um item com erro
// visível na revisão, não uma exceção que derruba a lista inteira.

const express = require('express');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao } = require('./permissionsController');
const provedores = require('./iaProvedores');

const router = express.Router();

// ---------------------------------------------------------------------------
// Destinos
// ---------------------------------------------------------------------------

/**
 * Para onde uma leitura pode ir. `permissao` é a ação que o usuário precisa
 * ter para APLICAR naquele destino — separada de `ia.extract`, porque ler um
 * documento e gravar no estoque são responsabilidades diferentes.
 *
 * `moduloAlvo` é a permissão do módulo de destino. A aplicação exige as duas:
 * quem pode aplicar em Matéria-prima pela IA também precisa poder cadastrar
 * insumo pelo módulo dela. Sem isso, `ia.apply.mp` viraria um atalho para
 * furar a permissão do outro módulo.
 */
const DESTINOS = [
  {
    id: 'materia_prima',
    rotulo: 'Matéria-prima (estoque)',
    descricao: 'Cadastrar insumos novos e dar entrada nos que já existem',
    icone: 'fa-boxes-stacked',
    permissao: 'ia.apply.mp',
    moduloAlvo: 'mp.create'
  },
  {
    id: 'produto_insumos',
    rotulo: 'Insumos de produtos',
    descricao: 'Preencher a ficha de insumos de um produto',
    icone: 'fa-diagram-project',
    permissao: 'ia.apply.prod',
    moduloAlvo: 'prod.edit'
  },
  {
    id: 'clientes',
    rotulo: 'Clientes e contatos',
    descricao: 'Cadastrar ou atualizar cliente com os contatos da empresa',
    icone: 'fa-user-tie',
    permissao: 'ia.apply.cli',
    moduloAlvo: 'cli.create'
  },
  {
    id: 'prospeccoes',
    rotulo: 'Prospecções e contatos',
    descricao: 'Cadastrar ou atualizar prospecção com os contatos da empresa',
    icone: 'fa-user-plus',
    permissao: 'ia.apply.pros',
    moduloAlvo: 'pros.create'
  },
  {
    id: 'orcamentos',
    rotulo: 'Orçamentos',
    descricao: 'Montar um orçamento a partir de uma lista de itens',
    icone: 'fa-file-invoice-dollar',
    permissao: 'ia.apply.orc',
    moduloAlvo: 'orc.create'
  }
];

const DESTINO_POR_ID = new Map(DESTINOS.map(d => [d.id, d]));

/** Situações de uma leitura, na ordem em que acontecem. */
const SITUACOES = [
  { id: 'rascunho', rotulo: 'Rascunho', descricao: 'Arquivos enviados, leitura ainda não executada' },
  { id: 'lendo', rotulo: 'Lendo', descricao: 'A IA está processando os arquivos' },
  { id: 'revisao', rotulo: 'Em revisão', descricao: 'Leitura pronta, esperando conferência' },
  { id: 'aplicada', rotulo: 'Aplicada', descricao: 'Os itens já foram gravados no módulo de destino' },
  { id: 'erro', rotulo: 'Erro', descricao: 'A leitura falhou' },
  { id: 'cancelada', rotulo: 'Cancelada', descricao: 'Descartada sem aplicar' }
];

const SITUACOES_VALIDAS = new Set(SITUACOES.map(s => s.id));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function erro(status, mensagem) {
  const e = new Error(mensagem);
  e.status = status;
  return e;
}

const texto = v => (v === undefined || v === null ? null : String(v).trim() || null);

/** Id do usuário autenticado, lido do JWT sem validar assinatura (só leitura). */
function usuarioDaRequisicao(req) {
  try {
    const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
    const parte = token.split('.')[1];
    if (!parte) return null;
    const json = Buffer.from(parte.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    const payload = JSON.parse(json);
    return payload.id ?? payload.userId ?? payload.sub ?? null;
  } catch (_) {
    return null;
  }
}

/**
 * JSON gravado como texto. Devolve `{ ok, valor }` em vez de lançar: um item
 * corrompido precisa aparecer na revisão com o problema à mostra, não derrubar
 * a leitura inteira junto com os itens que estão bons.
 */
function lerDados(bruto) {
  if (bruto === null || bruto === undefined || bruto === '') return { ok: true, valor: {} };
  if (typeof bruto === 'object') return { ok: true, valor: bruto };
  try {
    const valor = JSON.parse(String(bruto));
    if (!valor || typeof valor !== 'object') return { ok: false, valor: {} };
    return { ok: true, valor };
  } catch (_) {
    return { ok: false, valor: {} };
  }
}

const listaDe = resposta => (Array.isArray(resposta) ? resposta : []);

/** Data mais recente primeiro; sem data vai para o fim. */
function ordenarPorRecente(itens, campo = 'criado_em') {
  return itens.slice().sort((a, b) => {
    const x = a?.[campo] ? Date.parse(a[campo]) : NaN;
    const y = b?.[campo] ? Date.parse(b[campo]) : NaN;
    if (Number.isNaN(x) && Number.isNaN(y)) return (Number(b?.id) || 0) - (Number(a?.id) || 0);
    if (Number.isNaN(x)) return 1;
    if (Number.isNaN(y)) return -1;
    return y - x;
  });
}

async function buscarExtracao(api, id) {
  const row = await api.get(`/api/ia_extracoes/${id}`);
  if (!row || row.error === 'Not found') throw erro(404, 'Leitura não encontrada');
  return row;
}

/**
 * Nome dos usuários por id. Uma requisição só para a tabela inteira: a API não
 * aceita filtro por lista de ids (ver o cabeçalho deste arquivo).
 */
async function nomesDeUsuarios(api) {
  try {
    const usuarios = listaDe(await api.get('/api/usuarios'));
    return new Map(usuarios.map(u => [Number(u.id), u.nome || null]));
  } catch (_) {
    // Sem os nomes a lista ainda serve; o responsável fica vazio.
    return new Map();
  }
}

function responder(res, err, contexto) {
  const status = err?.status || 500;
  if (status >= 500) console.error(`Erro em ${contexto}:`, err);
  res.status(status).json({ error: err?.message || 'Erro interno no módulo de IA' });
}

// ---------------------------------------------------------------------------
// CONFIGURAÇÃO DOS PROVEDORES
//
// As chaves ficam no .env do backend local e NUNCA são devolvidas ao renderer.
// O que sai daqui é o estado ("está preenchida?") e os quatro últimos
// caracteres, para o usuário conferir que colou a chave certa.
// ---------------------------------------------------------------------------

router.get('/config/estado', exigirPermissao('ia.config'), (req, res) => {
  try {
    res.json(provedores.configuracao());
  } catch (err) {
    responder(res, err, 'GET /api/ia/config/estado');
  }
});

/**
 * Bate nos dois provedores e devolve o que a conta tem.
 *
 * POST e não GET porque a chamada sai para fora e consome cota — um GET seria
 * cacheável e passível de pré-busca pelo navegador, o que dispararia tráfego
 * para o Google e para a Groq sem ninguém ter pedido.
 */
router.post('/config/testar', exigirPermissao('ia.config'), async (req, res) => {
  try {
    res.json(await provedores.testarConexao());
  } catch (err) {
    responder(res, err, 'POST /api/ia/config/testar');
  }
});

// ---------------------------------------------------------------------------
// LISTA
// ---------------------------------------------------------------------------

/**
 * Tudo o que a tela precisa numa requisição: as leituras já ordenadas e com o
 * nome do responsável resolvido, os destinos e as situações. Os catálogos vêm
 * daqui e não de uma constante no front para não existirem duas listas que
 * podem divergir — foi assim que as etapas do funil ficaram fora de sincronia.
 */
router.get('/lista', exigirPermissao('ia.view'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const [brutas, nomes] = await Promise.all([
      api.get('/api/ia_extracoes').then(listaDe),
      nomesDeUsuarios(api)
    ]);

    const itens = ordenarPorRecente(brutas).map(e => ({
      id: e.id,
      titulo: e.titulo || null,
      destino: e.destino,
      destino_rotulo: DESTINO_POR_ID.get(e.destino)?.rotulo || e.destino,
      status: e.status,
      modelo_ocr: e.modelo_ocr || null,
      modelo_llm: e.modelo_llm || null,
      arquivos_qtd: Number(e.arquivos_qtd) || 0,
      itens_qtd: Number(e.itens_qtd) || 0,
      aplicados_qtd: Number(e.aplicados_qtd) || 0,
      erro: e.erro || null,
      usuario_id: e.usuario_id ?? null,
      usuario_nome: nomes.get(Number(e.usuario_id)) || null,
      criado_em: e.criado_em || null,
      aplicado_em: e.aplicado_em || null
    }));

    // Contagem por situação: a API não agrega, então é aqui ou lugar nenhum.
    const resumo = {};
    for (const s of SITUACOES) resumo[s.id] = 0;
    for (const item of itens) {
      if (resumo[item.status] === undefined) resumo[item.status] = 0;
      resumo[item.status] += 1;
    }

    res.json({ itens, destinos: DESTINOS, situacoes: SITUACOES, resumo });
  } catch (err) {
    responder(res, err, 'GET /api/ia/lista');
  }
});

// ---------------------------------------------------------------------------
// DETALHE
// ---------------------------------------------------------------------------

router.get('/:id', exigirPermissao('ia.details.view'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw erro(400, 'Leitura inválida');

    const extracao = await buscarExtracao(api, id);
    const [arquivos, itens, nomes] = await Promise.all([
      api.get('/api/ia_extracao_arquivos', { query: { extracao_id: id } }).then(listaDe),
      api.get('/api/ia_extracao_itens', { query: { extracao_id: id } }).then(listaDe),
      nomesDeUsuarios(api)
    ]);

    res.json({
      ...extracao,
      destino_rotulo: DESTINO_POR_ID.get(extracao.destino)?.rotulo || extracao.destino,
      status_rotulo: SITUACOES.find(s => s.id === extracao.status)?.rotulo || extracao.status,
      usuario_nome: nomes.get(Number(extracao.usuario_id)) || null,
      arquivos: ordenarPorRecente(arquivos).reverse().map(a => ({
        id: a.id,
        nome_arquivo: a.nome_arquivo,
        tipo_mime: a.tipo_mime || null,
        tamanho_bytes: Number(a.tamanho_bytes) || 0,
        origem: a.origem || null,
        paginas: a.paginas ?? null,
        // O texto extraído pode ter dezenas de milhares de caracteres. A lista
        // devolve só o tamanho; quem quiser ler abre o arquivo pela rota dele.
        texto_tamanho: a.texto ? String(a.texto).length : 0,
        erro: a.erro || null
      })),
      itens: itens
        .slice()
        .sort((a, b) => (Number(a.linha) || 0) - (Number(b.linha) || 0))
        .map(i => {
          const { ok, valor } = lerDados(i.dados);
          return {
            id: i.id,
            linha: Number(i.linha) || 0,
            dados: valor,
            dados_corrompidos: !ok,
            acao: i.acao || 'criar',
            alvo_tabela: i.alvo_tabela || null,
            alvo_id: i.alvo_id ?? null,
            confianca: i.confianca === null || i.confianca === undefined ? null : Number(i.confianca),
            status: i.status || 'pendente',
            mensagem: !ok ? 'O conteúdo lido não pôde ser interpretado' : (i.mensagem || null)
          };
        })
    });
  } catch (err) {
    responder(res, err, 'GET /api/ia/:id');
  }
});

/** Texto que a IA leu de um arquivo. Separado do detalhe por ser grande. */
router.get('/:id/arquivos/:arquivoId/texto', exigirPermissao('ia.details.view'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const id = Number(req.params.id);
    const arquivoId = Number(req.params.arquivoId);
    if (!Number.isFinite(id) || !Number.isFinite(arquivoId)) throw erro(400, 'Arquivo inválido');

    const arquivo = await api.get(`/api/ia_extracao_arquivos/${arquivoId}`);
    if (!arquivo || arquivo.error === 'Not found') throw erro(404, 'Arquivo não encontrado');
    // Confere o vínculo: sem isto, qualquer id de arquivo seria legível por
    // quem só tem acesso a outra leitura.
    if (Number(arquivo.extracao_id) !== id) throw erro(404, 'Arquivo não encontrado');

    res.json({
      id: arquivo.id,
      nome_arquivo: arquivo.nome_arquivo,
      origem: arquivo.origem || null,
      texto: arquivo.texto || '',
      erro: arquivo.erro || null
    });
  } catch (err) {
    responder(res, err, 'GET /api/ia/:id/arquivos/:arquivoId/texto');
  }
});

// ---------------------------------------------------------------------------
// EXCLUSÃO
// ---------------------------------------------------------------------------

/**
 * Apaga a leitura e o que saiu dela.
 *
 * O que já foi APLICADO não volta atrás: os insumos, clientes e orçamentos
 * criados continuam nos módulos deles. Apagar a leitura só remove o registro
 * de onde aqueles dados vieram — por isso a rota recusa leituras aplicadas, em
 * vez de apagar em silêncio e deixar os registros órfãos de origem.
 *
 * O ON DELETE CASCADE do banco cuidaria dos filhos, mas a API é um CRUD
 * genérico: um DELETE numa linha pai não dispara nada além do próprio DELETE.
 * Por isso os filhos saem explicitamente, e ANTES do pai — o contrário
 * deixaria arquivos e itens apontando para uma extração que não existe mais.
 */
router.delete('/:id', exigirPermissao('ia.delete'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw erro(400, 'Leitura inválida');

    const extracao = await buscarExtracao(api, id);
    if (extracao.status === 'aplicada') {
      throw erro(409, 'Esta leitura já foi aplicada e não pode ser excluída');
    }

    const [arquivos, itens] = await Promise.all([
      api.get('/api/ia_extracao_arquivos', { query: { extracao_id: id } }).then(listaDe),
      api.get('/api/ia_extracao_itens', { query: { extracao_id: id } }).then(listaDe)
    ]);

    await Promise.all([
      ...itens.map(i => api.delete(`/api/ia_extracao_itens/${i.id}`)),
      ...arquivos.map(a => api.delete(`/api/ia_extracao_arquivos/${a.id}`))
    ]);
    await api.delete(`/api/ia_extracoes/${id}`);

    res.json({ sucesso: true, id, arquivos: arquivos.length, itens: itens.length });
  } catch (err) {
    responder(res, err, 'DELETE /api/ia/:id');
  }
});

module.exports = router;
module.exports.DESTINOS = DESTINOS;
module.exports.DESTINO_POR_ID = DESTINO_POR_ID;
module.exports.SITUACOES = SITUACOES;
module.exports.SITUACOES_VALIDAS = SITUACOES_VALIDAS;
module.exports.usuarioDaRequisicao = usuarioDaRequisicao;
module.exports.lerDados = lerDados;
module.exports.texto = texto;
