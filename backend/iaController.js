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
const multer = require('multer');
const { createApiClient } = require('./apiHttpClient');
const { exigirPermissao, obterPermissoesEfetivas } = require('./permissionsController');
const permissoesRepo = require('./permissionsRepository');
const provedores = require('./iaProvedores');
const leitura = require('./iaLeitura');
const esquemas = require('./iaEsquemas');
const estruturacao = require('./iaEstruturacao');
const reconciliacao = require('./iaReconciliacao');
const aplicacao = require('./iaAplicacao');

const router = express.Router();

/**
 * Os arquivos ficam SÓ na memória desta requisição.
 *
 * Nada de disco: gravar em disco criaria um segundo lugar onde o documento do
 * cliente existe, com ciclo de vida próprio para alguém esquecer de limpar. O
 * arquivo é lido, vira texto e some junto com a requisição.
 *
 * O limite do multer é a última barreira, não a primeira — o front também
 * confere, para o usuário não esperar o upload de um arquivo que vai ser
 * recusado no fim.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: provedores.LIMITES.arquivoMb() * 1024 * 1024,
    files: provedores.LIMITES.arquivos(),
    fields: 20
  }
});

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
  { id: 'rascunho', rotulo: 'Texto lido', descricao: 'Os arquivos foram lidos; os dados ainda não foram extraídos' },
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

/**
 * Token cru da requisição.
 *
 * A aplicação grava pelo módulo de destino, que usa o cliente `db` — e ele
 * resolve o token por AsyncLocalStorage. Sem repassar este valor, a entrada em
 * estoque sairia com o token de serviço do aplicativo e o histórico registraria
 * "o sistema" onde deveria registrar a pessoa.
 */
function tokenDaRequisicao(req) {
  return String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim() || null;
}

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

/**
 * Valores que já existem para os campos de lista do destino.
 *
 * Falha em silêncio de propósito: sem as sugestões a revisão continua
 * funcionando (o campo vira texto livre), e derrubar a abertura da leitura por
 * causa de um datalist seria uma troca ruim.
 */
/**
 * Registros do módulo de destino que um item pode apontar.
 *
 * É o que permite o revisor dizer "não é novo, é aquele ali" — o caso em que a
 * reconciliação avisou "parecido com X" mas não decidiu sozinha. Sem esta
 * lista, a única saída seria cadastrar um quase-duplicado e consertar depois no
 * outro módulo.
 *
 * Só id e nome: a tabela inteira do estoque numa resposta de modal seria
 * dezenas de campos por linha que a tela não usa.
 */
async function alvosDoDestino(api, destino) {
  const esquema = esquemas.obterEsquema(destino);
  if (!esquema) return [];
  try {
    const linhas = listaDe(await api.get(`/api/${esquema.tabelaAlvo}`));
    return linhas
      .map(l => ({ id: l.id, nome: l[esquema.campoDeExibicao] }))
      .filter(l => l.id && l.nome)
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  } catch (_) {
    return [];
  }
}

async function sugestoesDoDestino(api, destino) {
  if (destino !== 'materia_prima') return {};
  try {
    const [categorias, unidades] = await Promise.all([
      api.get('/api/categoria').then(listaDe).catch(() => []),
      api.get('/api/unidades').then(listaDe).catch(() => [])
    ]);
    return {
      categoria: categorias.map(c => c.nome_categoria).filter(Boolean).sort(),
      unidade: unidades.map(u => u.tipo).filter(Boolean).sort()
    };
  } catch (_) {
    return {};
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
// NOVA LEITURA (envio + leitura, na MESMA requisição)
//
// Envio e leitura não podem ser dois passos separados: o arquivo não é gravado
// em lugar nenhum, então numa segunda requisição os bytes já não existiriam.
// Por isso o POST recebe os arquivos, lê tudo e devolve a leitura pronta.
// ---------------------------------------------------------------------------

/** Roda as tarefas com no máximo `limite` em voo. */
async function emParalelo(itens, limite, tarefa) {
  const resultados = new Array(itens.length);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < itens.length) {
      const i = proximo++;
      resultados[i] = await tarefa(itens[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limite, itens.length) }, trabalhador));
  return resultados;
}

/**
 * Opções da tela de nova leitura.
 *
 * `pode_aplicar` vem daqui e não de uma conta que o front faça sozinho: ler um
 * documento para um destino em que o usuário não pode gravar é gastar crédito
 * à toa. O destino aparece na tela mesmo assim, travado e com o motivo — some
 * a ação, não a informação de que ela existe.
 */
router.get('/opcoes', exigirPermissao('ia.upload'), async (req, res) => {
  try {
    const permissoes = await obterPermissoesEfetivas(req);
    const cfg = provedores.configuracao();

    res.json({
      destinos: DESTINOS.map(d => ({
        id: d.id,
        rotulo: d.rotulo,
        descricao: d.descricao,
        icone: d.icone,
        pode_aplicar: permissoesRepo.can(permissoes, d.permissao)
          && permissoesRepo.can(permissoes, d.moduloAlvo)
      })),
      extensoes: leitura.EXTENSOES_ACEITAS,
      limites: cfg.limites,
      // Sem chave não adianta deixar o usuário escolher arquivo: a leitura
      // falharia no fim, depois de ele já ter montado o lote.
      provedores: {
        gemini: cfg.gemini.configurado,
        groq: cfg.groq.configurado,
        pronto: cfg.pronto
      }
    });
  } catch (err) {
    responder(res, err, 'GET /api/ia/opcoes');
  }
});

/**
 * Cria a leitura e lê os arquivos.
 *
 * Exige `ia.upload` e `ia.extract` separadamente: enviar um arquivo e disparar
 * a IA (que consome crédito da conta) são decisões diferentes, e há perfil que
 * deve poder fazer a primeira sem a segunda.
 *
 * Se der ruim no meio, a leitura NÃO fica pendurada em "lendo": o catch marca
 * `erro` com a mensagem. Uma linha travada nesse estado ficaria para sempre com
 * o ponto piscando na grade, sem ninguém saber que já acabou.
 */
router.post('/',
  exigirPermissao(['ia.upload', 'ia.extract']),
  upload.array('arquivos'),
  async (req, res) => {
    const api = createApiClient(req);
    let extracaoId = null;

    try {
      const destino = texto(req.body?.destino);
      if (!destino || !DESTINO_POR_ID.has(destino)) {
        throw erro(400, 'Escolha para onde os dados lidos vão.');
      }

      const arquivos = Array.isArray(req.files) ? req.files : [];
      if (!arquivos.length) throw erro(400, 'Envie pelo menos um arquivo.');

      // Falha cedo, antes de criar a leitura e antes de gastar crédito: um
      // tipo não aceito no meio do lote é problema de escolha, não de leitura.
      for (const a of arquivos) leitura.classificarArquivo(a.originalname, a.mimetype);

      const cfg = provedores.configuracao();
      const precisaGemini = arquivos.some(a =>
        leitura.classificarArquivo(a.originalname, a.mimetype).origem !== 'planilha');
      if (precisaGemini && !cfg.gemini.configurado) {
        throw erro(400,
          'PDF e foto precisam da GEMINI_API_KEY no .env. Planilhas são lidas sem ela.');
      }

      const titulo = texto(req.body?.titulo)
        || (arquivos.length === 1 ? arquivos[0].originalname : `${arquivos.length} arquivos`);

      const criada = await api.post('/api/ia_extracoes', {
        titulo: titulo.slice(0, 200),
        destino,
        status: 'lendo',
        arquivos_qtd: arquivos.length,
        itens_qtd: 0,
        aplicados_qtd: 0,
        usuario_id: usuarioDaRequisicao(req)
      });
      extracaoId = criada?.id;
      if (!extracaoId) throw erro(502, 'Não foi possível registrar a leitura.');

      // Três em voo: um lote de dez PDFs em série levaria minutos, e todos de
      // uma vez bateria no limite de uso do provedor — que devolve 429 e
      // derruba justamente os arquivos do fim da fila.
      const lidos = await emParalelo(arquivos, 3, async arquivo => {
        const r = await leitura.lerArquivo({
          nome: arquivo.originalname,
          mime: arquivo.mimetype,
          buffer: arquivo.buffer
        });
        return { arquivo, ...r };
      });

      let usouGemini = false;
      for (const item of lidos) {
        if (item.origem && item.origem !== 'planilha' && !item.erro) usouGemini = true;
        await api.post('/api/ia_extracao_arquivos', {
          extracao_id: extracaoId,
          nome_arquivo: String(item.arquivo.originalname).slice(0, 255),
          tipo_mime: item.mime || null,
          tamanho_bytes: item.arquivo.size ?? null,
          origem: item.origem || null,
          paginas: item.paginas ?? null,
          texto: item.texto || null,
          // O aviso de corte também vira "erro" da linha, para aparecer no
          // detalhe: texto cortado pela metade é exatamente o tipo de coisa
          // que faz um item sumir sem explicação.
          erro: item.erro || item.aviso || null
        });
      }

      const comTexto = lidos.filter(l => l.texto).length;
      const falharam = lidos.filter(l => l.erro);

      // Um arquivo ruim no meio de dez não é falha do lote: o que foi lido
      // segue valendo. Só quando NADA foi lido a leitura vira erro.
      const status = comTexto ? 'rascunho' : 'erro';
      const resumoErro = falharam.length
        ? falharam.map(l => `${l.arquivo.originalname}: ${l.erro}`).join(' | ').slice(0, 1000)
        : null;

      await api.put(`/api/ia_extracoes/${extracaoId}`, {
        status,
        modelo_ocr: usouGemini ? provedores.modeloGemini() : null,
        erro: comTexto ? resumoErro : (resumoErro || 'Nenhum arquivo pôde ser lido.')
      });

      res.status(201).json({
        id: extracaoId,
        status,
        destino,
        titulo,
        arquivos_lidos: comTexto,
        arquivos_com_falha: falharam.length,
        erro: comTexto ? resumoErro : (resumoErro || 'Nenhum arquivo pôde ser lido.')
      });
    } catch (err) {
      // A leitura já existe e ficaria em "lendo" para sempre — o ponto ficaria
      // piscando na grade sem nunca terminar.
      if (extracaoId) {
        await api.put(`/api/ia_extracoes/${extracaoId}`, {
          status: 'erro',
          erro: String(err?.message || 'Falha ao ler os arquivos').slice(0, 1000)
        }).catch(() => {});
      }
      responder(res, err, 'POST /api/ia');
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
    const esquema = esquemas.obterEsquema(extracao.destino);

    const [arquivos, itens, nomes, sugestoes] = await Promise.all([
      api.get('/api/ia_extracao_arquivos', { query: { extracao_id: id } }).then(listaDe),
      api.get('/api/ia_extracao_itens', { query: { extracao_id: id } }).then(listaDe),
      nomesDeUsuarios(api),
      // Categoria e unidade em texto livre é como a mesma coisa vira três
      // grafias. A grade oferece o que já existe para o revisor encaixar.
      sugestoesDoDestino(api, extracao.destino)
    ]);

    // A lista de alvos só faz sentido enquanto há o que revisar, e é a maior
    // parte da resposta. Depois de aplicada, a leitura não precisa dela.
    const alvos = extracao.status === 'revisao' || extracao.status === 'rascunho'
      ? await alvosDoDestino(api, extracao.destino)
      : [];

    res.json({
      ...extracao,
      // A grade de revisão é montada a partir DAQUI, não de colunas escritas
      // no HTML: é o que faz um destino novo aparecer na tela sem tocar no
      // front, e o que impede a tela de pedir campo que ninguém extraiu.
      campos: esquemas.camposParaTela(extracao.destino),
      sugestoes,
      alvos,
      pode_estruturar: Boolean(esquema),
      // A grade precisa saber que este destino não cadastra: é o que decide
      // mostrar o seletor de destino e esconder a opção "Cadastrar".
      exige_alvo: Boolean(esquema?.exigeAlvo),
      alvo_eh_vinculo: Boolean(esquema?.alvoEhVinculo),
      rotulo_alvo: esquema?.rotuloAlvo || null,
      // A grade oferece só as ações que fazem sentido no destino.
      acoes: esquemas.acoesDoDestino(extracao.destino),
      pode_aplicar_destino: aplicacao.DESTINOS_APLICAVEIS.includes(extracao.destino),
      explicacoes: esquema
        ? { criar: esquema.explicacaoCriar || null, atualizar: esquema.explicacaoAtualizar || null }
        : null,
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
// EXTRAÇÃO DOS DADOS
//
// O texto lido já está gravado, então este passo pode ser repetido sem pedir
// os arquivos de novo. É a razão de guardar o texto: um esquema melhorado ou
// um modelo diferente reprocessam o mesmo documento sem novo upload.
// ---------------------------------------------------------------------------

/** Texto de todos os arquivos de uma leitura, na ordem em que entraram. */
function juntarTextos(arquivos) {
  return arquivos
    .filter(a => a.texto)
    .map(a => `### ${a.nome_arquivo}\n${a.texto}`)
    .join('\n\n');
}

/**
 * Troca os itens de uma leitura pelos que acabaram de ser extraídos.
 *
 * Apaga antes de inserir porque extrair de novo é REFAZER, não acrescentar —
 * sem isso, reprocessar dobraria a lista e o revisor aprovaria tudo duas vezes.
 * Itens já APLICADOS ficam: eles viraram estoque, e apagá-los apagaria a
 * procedência de um saldo que existe.
 */
async function trocarItens(api, extracaoId, novos) {
  const atuais = listaDe(
    await api.get('/api/ia_extracao_itens', { query: { extracao_id: extracaoId } })
  );
  const preservados = atuais.filter(i => i.status === 'aplicado');
  const descartaveis = atuais.filter(i => i.status !== 'aplicado');

  await Promise.all(descartaveis.map(i => api.delete(`/api/ia_extracao_itens/${i.id}`)));

  let linha = preservados.length;
  for (const item of novos) {
    linha += 1;
    await api.post('/api/ia_extracao_itens', {
      extracao_id: extracaoId,
      linha,
      dados: JSON.stringify(item.dados || {}),
      acao: item.acao || 'criar',
      alvo_tabela: item.alvo_tabela || null,
      alvo_id: item.alvo_id ?? null,
      confianca: item.confianca ?? null,
      status: 'pendente',
      mensagem: item.mensagem || null
    });
  }

  return preservados.length + novos.length;
}

router.post('/:id/estruturar', exigirPermissao('ia.extract'), async (req, res) => {
  const api = createApiClient(req);
  const id = Number(req.params.id);

  try {
    if (!Number.isFinite(id)) throw erro(400, 'Leitura inválida');

    const extracao = await buscarExtracao(api, id);
    if (extracao.status === 'aplicada') {
      throw erro(409, 'Esta leitura já foi aplicada. Extrair de novo não mudaria o que já entrou no sistema.');
    }
    if (!esquemas.obterEsquema(extracao.destino)) {
      throw erro(400, `O destino "${extracao.destino}" ainda não sabe extrair dados.`);
    }

    const arquivos = listaDe(
      await api.get('/api/ia_extracao_arquivos', { query: { extracao_id: id } })
    );
    const texto = juntarTextos(arquivos);
    if (!texto.trim()) {
      throw erro(400, 'Nenhum arquivo desta leitura tem texto para extrair.');
    }

    await api.put(`/api/ia_extracoes/${id}`, { status: 'lendo' });

    const extraidos = await estruturacao.estruturar({ texto, destino: extracao.destino });

    // A reconciliação precisa da tabela de destino INTEIRA: a API não filtra
    // por lista de valores, então casar em memória é o único caminho.
    const existentes = listaDe(
      await api.get(`/api/${esquemas.obterEsquema(extracao.destino).tabelaAlvo}`)
    );
    const itens = reconciliacao.reconciliar({
      destino: extracao.destino,
      itens: extraidos.itens,
      existentes
    });

    const total = await trocarItens(api, id, itens);

    // Linha descartada e resposta cortada não são detalhe: quem revisa precisa
    // saber que o documento tinha mais do que está na tela — senão confere o
    // que veio, aprova, e o resto some sem ninguém notar.
    const avisos = [];
    if (extraidos.descartados.length) {
      avisos.push(`${extraidos.descartados.length} linha(s) descartada(s): `
        + extraidos.descartados.slice(0, 5).map(d => `linha ${d.linha} (${d.motivo})`).join('; '));
    }
    if (extraidos.truncado) {
      avisos.push('A resposta do modelo foi cortada por tamanho — pode faltar item do fim da lista.');
    }

    await api.put(`/api/ia_extracoes/${id}`, {
      status: total ? 'revisao' : 'erro',
      itens_qtd: total,
      modelo_llm: extraidos.modelo,
      erro: total
        ? (avisos.join(' | ').slice(0, 1000) || null)
        : 'A IA não encontrou nenhum item neste documento.'
    });

    res.json({
      id,
      status: total ? 'revisao' : 'erro',
      itens_qtd: total,
      descartados: extraidos.descartados.length,
      truncado: extraidos.truncado,
      avisos
    });
  } catch (err) {
    // Sem isto a leitura ficaria em "lendo" para sempre, com o ponto piscando
    // na grade sem nunca terminar.
    await api.put(`/api/ia_extracoes/${id}`, {
      status: 'erro',
      erro: String(err?.message || 'Falha ao extrair os dados').slice(0, 1000)
    }).catch(() => {});
    responder(res, err, 'POST /api/ia/:id/estruturar');
  }
});

// ---------------------------------------------------------------------------
// REVISÃO
// ---------------------------------------------------------------------------

const ACOES_VALIDAS = new Set(['criar', 'atualizar', 'ignorar']);

/**
 * Corrige um item antes de aplicar.
 *
 * Os valores passam pela MESMA coerção da extração. Sem isso, o revisor
 * digitaria "189,90" no campo de preço e gravaria a string — o modelo teria
 * seus números validados e a pessoa não.
 */
router.put('/:id/itens/:itemId', exigirPermissao('ia.review.edit'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const id = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(id) || !Number.isFinite(itemId)) throw erro(400, 'Item inválido');

    const extracao = await buscarExtracao(api, id);
    const esquema = esquemas.obterEsquema(extracao.destino);
    if (!esquema) throw erro(400, 'Este destino ainda não tem revisão.');

    const item = await api.get(`/api/ia_extracao_itens/${itemId}`);
    if (!item || item.error === 'Not found') throw erro(404, 'Item não encontrado');
    if (Number(item.extracao_id) !== id) throw erro(404, 'Item não encontrado');
    if (item.status === 'aplicado') {
      throw erro(409, 'Este item já foi gravado no sistema e não pode mais ser editado.');
    }

    const payload = {};
    const problemas = [];

    if (req.body?.dados !== undefined) {
      const atual = lerDados(item.dados).valor;
      const enviados = req.body.dados || {};
      const novos = { ...atual };

      for (const campo of esquema.campos) {
        if (!Object.prototype.hasOwnProperty.call(enviados, campo.chave)) continue;
        const valor = estruturacao.coagir(campo, enviados[campo.chave]);
        if (valor === undefined) {
          problemas.push(`${campo.rotulo}: valor não reconhecido`);
          continue;
        }
        novos[campo.chave] = valor;
      }
      if (problemas.length) throw erro(400, problemas.join('; '));
      payload.dados = JSON.stringify(novos);
    }

    if (req.body?.acao !== undefined) {
      const acao = texto(req.body.acao);
      if (!ACOES_VALIDAS.has(acao)) throw erro(400, `Ação inválida: ${acao}`);
      payload.acao = acao;
      // Trocar para "cadastrar" solta o alvo: senão o item sairia como novo
      // apontando para um registro existente, e o próximo salvamento gravaria
      // um em cima do outro.
      //
      // MENOS quando o alvo é um vínculo. No orçamento, o alvo é o cliente a
      // quem o orçamento novo se prende — soltá-lo ao escolher "cadastrar"
      // deixaria o item sem cliente justo na ação em que ele mais precisa.
      const soltaAlvo = acao === 'ignorar'
        || (acao !== 'atualizar' && !esquema.alvoEhVinculo);
      if (soltaAlvo) { payload.alvo_id = null; payload.alvo_tabela = null; }
    }

    if (req.body?.alvo_id !== undefined) {
      const alvo = req.body.alvo_id === null ? null : Number(req.body.alvo_id);
      if (alvo !== null && !Number.isFinite(alvo)) throw erro(400, 'Destino inválido');
      payload.alvo_id = alvo;
      payload.alvo_tabela = alvo === null ? null : esquema.tabelaAlvo;
      // Escolher o destino já define a ação: "atualizar" nos destinos comuns,
      // "criar" onde o alvo é vínculo (o orçamento nasce preso ao cliente).
      if (alvo !== null) payload.acao = payload.acao || esquema.acaoAoCasar || 'atualizar';
    }

    if (!Object.keys(payload).length) throw erro(400, 'Nada para alterar');

    // Correção do revisor apaga a ressalva da IA: ela falava do valor antigo.
    payload.mensagem = null;
    const salvo = await api.put(`/api/ia_extracao_itens/${itemId}`, payload);

    res.json({
      id: salvo.id,
      linha: Number(salvo.linha) || 0,
      dados: lerDados(salvo.dados).valor,
      acao: salvo.acao,
      alvo_id: salvo.alvo_id ?? null,
      status: salvo.status,
      mensagem: salvo.mensagem || null
    });
  } catch (err) {
    responder(res, err, 'PUT /api/ia/:id/itens/:itemId');
  }
});

// ---------------------------------------------------------------------------
// APLICAÇÃO
// ---------------------------------------------------------------------------

/**
 * Grava os itens revisados no módulo de destino.
 *
 * Exige DUAS permissões: a de aplicar pela IA (`ia.apply.*`) e a do módulo de
 * destino. Sem a segunda, `ia.apply.mp` viraria um atalho para cadastrar
 * insumo sem ter permissão de cadastrar insumo.
 */
router.post('/:id/aplicar',
  exigirPermissao(req => {
    // A permissão depende do destino, que só se conhece lendo a leitura. Como
    // o guard roda antes, ele usa o destino informado no corpo — e a rota
    // confere logo abaixo se bate com o que está gravado. Informar um destino
    // mais frouxo no corpo não ajuda: a checagem de baixo recusa.
    const destino = String(req.body?.destino || '');
    const d = DESTINO_POR_ID.get(destino);
    return d ? [d.permissao, d.moduloAlvo] : ['ia.apply.mp'];
  }),
  async (req, res) => {
    const api = createApiClient(req);
    const id = Number(req.params.id);

    try {
      if (!Number.isFinite(id)) throw erro(400, 'Leitura inválida');

      const extracao = await buscarExtracao(api, id);
      // O corpo precisa repetir o destino: é ele que o guard de permissão usa
      // para saber QUAL `ia.apply.*` exigir, e esta conferência é o que impede
      // alguém de informar um destino mais frouxo para escapar do guard.
      const destinoInformado = String(req.body?.destino || '');
      if (destinoInformado !== extracao.destino) {
        throw erro(400, destinoInformado
          ? `Esta leitura é para "${extracao.destino}", e veio "${destinoInformado}".`
          : `Informe o destino "${extracao.destino}" no corpo do pedido.`);
      }
      if (extracao.status === 'aplicada') {
        throw erro(409, 'Esta leitura já foi aplicada.');
      }
      if (!aplicacao.DESTINOS_APLICAVEIS.includes(extracao.destino)) {
        throw erro(400, `Ainda não é possível aplicar em "${extracao.destino}".`);
      }

      const brutos = listaDe(
        await api.get('/api/ia_extracao_itens', { query: { extracao_id: id } })
      );
      if (!brutos.length) throw erro(400, 'Esta leitura não tem itens para aplicar.');

      const itens = brutos
        .slice()
        .sort((a, b) => (Number(a.linha) || 0) - (Number(b.linha) || 0))
        .map(i => ({
          id: i.id,
          linha: Number(i.linha) || 0,
          dados: lerDados(i.dados).valor,
          acao: i.acao || 'criar',
          alvo_id: i.alvo_id ?? null,
          status: i.status || 'pendente',
          mensagem: i.mensagem || null
        }));

      const resultados = await aplicacao.aplicar({
        destino: extracao.destino,
        itens,
        // Empresa e contato são CRUD puro na API: vão pelo cliente HTTP da
        // requisição. Estoque é diferente — passa pelo materiaPrima.js, que usa
        // o cliente `db`, e é por isso que o token também é repassado.
        api,
        usuarioId: usuarioDaRequisicao(req),
        token: tokenDaRequisicao(req),
        extracaoId: id,
        titulo: extracao.titulo
      });

      // O resultado de cada item volta para a linha dele: é o que permite
      // reaplicar só o que falhou, em vez de repetir o lote inteiro.
      const agora = new Date().toISOString();
      for (const r of resultados) {
        await api.put(`/api/ia_extracao_itens/${r.id}`, {
          status: r.status,
          alvo_id: r.alvo_id,
          mensagem: r.mensagem || null,
          aplicado_em: r.status === 'aplicado' ? agora : null
        }).catch(() => {});
      }

      const aplicados = resultados.filter(r => r.status === 'aplicado').length;
      const comErro = resultados.filter(r => r.status === 'erro').length;
      const ignorados = resultados.filter(r => r.status === 'ignorado').length;

      // Só encerra a leitura quando NADA ficou pendente. Com item em erro ela
      // continua em revisão — é o que deixa corrigir e aplicar de novo, sem
      // reaplicar o que já entrou.
      const concluida = comErro === 0;
      await api.put(`/api/ia_extracoes/${id}`, {
        status: concluida ? 'aplicada' : 'revisao',
        aplicados_qtd: aplicados,
        aplicado_em: concluida ? agora : null,
        erro: comErro ? `${comErro} item(ns) não puderam ser gravados.` : null
      });

      res.json({ id, status: concluida ? 'aplicada' : 'revisao', aplicados, ignorados, com_erro: comErro, itens: resultados });
    } catch (err) {
      responder(res, err, 'POST /api/ia/:id/aplicar');
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

/**
 * Erros do multer.
 *
 * Eles nascem no middleware, antes do handler — o try/catch da rota nunca os
 * veria. Sem isto, quem enviasse um arquivo grande demais recebia
 * "File too large" em inglês, ou um 500 mudo.
 */
router.use((err, req, res, next) => {
  if (!err || err.name !== 'MulterError') return next(err);

  const mb = provedores.LIMITES.arquivoMb();
  const max = provedores.LIMITES.arquivos();
  const mensagens = {
    LIMIT_FILE_SIZE: `Arquivo grande demais. O limite é ${mb} MB por arquivo.`,
    LIMIT_FILE_COUNT: `Arquivos demais. O limite é ${max} por leitura.`,
    LIMIT_UNEXPECTED_FILE: 'Campo de arquivo inesperado no envio.'
  };
  res.status(400).json({ error: mensagens[err.code] || 'Falha ao receber os arquivos.' });
});

module.exports = router;
module.exports.DESTINOS = DESTINOS;
module.exports.DESTINO_POR_ID = DESTINO_POR_ID;
module.exports.SITUACOES = SITUACOES;
module.exports.SITUACOES_VALIDAS = SITUACOES_VALIDAS;
module.exports.usuarioDaRequisicao = usuarioDaRequisicao;
module.exports.lerDados = lerDados;
module.exports.emParalelo = emParalelo;
module.exports.tokenDaRequisicao = tokenDaRequisicao;
module.exports.juntarTextos = juntarTextos;
module.exports.texto = texto;
