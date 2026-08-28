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
const { exigirPermissao, exigirSupAdmin, ehSupAdmin, obterPermissoesEfetivas } = require('./permissionsController');
const permissoesRepo = require('./permissionsRepository');
const provedores = require('./iaProvedores');
const leitura = require('./iaLeitura');
const esquemas = require('./iaEsquemas');
const estruturacao = require('./iaEstruturacao');
const reconciliacao = require('./iaReconciliacao');
const aplicacao = require('./iaAplicacao');
const preenchimento = require('./iaPreenchimento');
const configArmazenada = require('./iaConfiguracao');
const { paraDecimal } = require('./numeros');

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
  { id: 'aplicada', rotulo: 'Concluída', descricao: 'Não há mais linha pendente nesta leitura' },
  { id: 'erro', rotulo: 'Erro', descricao: 'A leitura falhou' },
  { id: 'cancelada', rotulo: 'Descartada', descricao: 'Todas as linhas foram descartadas; nada foi cadastrado' }
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
    const linhas = await registrosAlvo(api, destino);
    const varias = esquemas.tabelasAlvoDo(destino).length > 1;
    return linhas
      .map(l => {
        // Cadastro pela metade existe: registro sem nome de exibição. Montar o
        // rótulo antes de conferir transformava o vazio no TEXTO "null", que é
        // verdadeiro e passava pelo filtro — e a lista de escolha oferecia
        // "null (Cliente)" para se apontar um pedido.
        const nome = texto(l?.[esquema.campoDeExibicao]);
        if (!nome) return null;
        return {
          id: l.id,
          // Com duas tabelas, o nome sozinho é ambíguo: a mesma empresa pode
          // estar nas duas, e o revisor precisa ver qual ele está escolhendo.
          nome: varias ? `${nome} (${l._rotulo})` : nome,
          tabela: l._tabela
        };
      })
      .filter(l => l && l.id && l.nome)
      .sort((a, b) => String(a.nome).localeCompare(String(b.nome)));
  } catch (_) {
    return [];
  }
}

/**
 * Registros em que o destino procura o alvo, de todas as tabelas dele.
 *
 * Cada linha sai carimbada com `_tabela` e `_rotulo`: é assim que a
 * reconciliação sabe de onde veio o casamento — e, no orçamento, é isso que
 * decide se o número sai como ORC (cliente) ou OCRP (prospecção).
 */
async function registrosAlvo(api, destino) {
  const tabelas = esquemas.tabelasAlvoDo(destino).filter(t => t.tabela);
  const listas = await Promise.all(tabelas.map(t =>
    api.get(`/api/${t.tabela}`)
      .then(listaDe)
      .then(linhas => linhas.map(l => ({ ...l, _tabela: t.tabela, _rotulo: t.rotulo })))
      .catch(() => [])
  ));
  return listas.flat();
}

/**
 * As listas que a grade oferece para o revisor escolher.
 *
 * ---------------------------------------------------------------------------
 * A DIFERENÇA ENTRE SUGERIR E RESTRINGIR
 *
 * Categoria de insumo é texto livre no cadastro: sugerir o que já existe evita
 * que a mesma coisa vire três grafias, mas digitar uma nova é legítimo.
 *
 * Unidade, processo e nome de insumo NÃO são: os três são tabela, com cadastro
 * e edição próprios. Digitar "ml" à mão num deles não cria a unidade — cria um
 * texto que não corresponde a nada, e o formulário do outro lado o ignora em
 * silêncio. Por isso vão marcados como `restrito`: a grade aceita digitar para
 * procurar, mas só grava o que existe.
 */
async function sugestoesDoDestino(api, destino) {
  try {
    if (destino === 'materia_prima') {
      const [categorias, unidades] = await Promise.all([
        api.get('/api/categoria').then(listaDe).catch(() => []),
        api.get('/api/unidades').then(listaDe).catch(() => [])
      ]);
      return {
        categoria: categorias.map(c => c.nome_categoria).filter(Boolean).sort(),
        unidade: unidades.map(u => u.tipo).filter(Boolean).sort()
      };
    }

    if (destino === 'orcamentos') {
      const produtos = await catalogoDeProdutos(api);
      return {
        // A peça se ESCOLHE. Digitar um nome livre num pedido cria um item que
        // o orçamento recusa — e o erro só aparece do outro lado.
        'itens.nome': produtos.map(p => p.nome).filter(Boolean).sort(),
        __restritos: ['itens.nome']
      };
    }

    if (destino === 'produto_insumos') {
      const [materias, unidades, etapas] = await Promise.all([
        api.get('/api/materia_prima').then(listaDe).catch(() => []),
        api.get('/api/unidades').then(listaDe).catch(() => []),
        api.get('/api/etapas_producao').then(listaDe).catch(() => [])
      ]);

      return {
        // Prefixadas com `insumos.` porque valem para os SUBCAMPOS da lista de
        // insumos, não para as colunas de cima.
        'insumos.nome': materias.map(m => m.nome).filter(Boolean).sort(),
        'insumos.unidade': unidades.map(u => u.tipo).filter(Boolean).sort(),
        'insumos.processo': etapas
          .slice()
          .sort((a, b) => (Number(a.ordem) || 0) - (Number(b.ordem) || 0))
          .map(e => e.nome).filter(Boolean),
        // Os três são tabela: aceitar texto livre criaria um valor que não
        // corresponde a nada e que o formulário ignora sem avisar.
        __restritos: ['insumos.nome', 'insumos.unidade', 'insumos.processo']
      };
    }

    return {};
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

router.get('/config/estado', exigirPermissao('ia.config'), async (req, res) => {
  try {
    // A configuração vem do banco antes de responder: o cache pode estar
    // vencido, e mostrar o valor de antes na tela de configuração é o pior
    // lugar possível para mostrar um valor de antes.
    const api = createApiClient(req);
    await configArmazenada.carregar(api);
    res.json({
      ...provedores.configuracao(),
      ultimo_uso: await ultimoConsumo(api),
      // Quem NÃO é Sup Admin vê tudo e não muda nada. Ver ajuda a entender por
      // que uma leitura saiu como saiu; mudar o modelo altera o resultado, o
      // custo e o limite de todo mundo.
      pode_editar: await ehSupAdmin(req)
    });
  } catch (err) {
    responder(res, err, 'GET /api/ia/config/estado');
  }
});

/**
 * Quanto de contexto a leitura mais recente gastou.
 *
 * "Cabe neste modelo?" é a pergunta que decide trocar de modelo ou dividir o
 * documento. Contra o tamanho de contexto que a tela já mostra ao lado de cada
 * modelo, este número responde — e é a leitura mais recente porque é ela que a
 * pessoa acabou de fazer e está tentando entender.
 *
 * Um total acumulado do mês não responderia nada: ele mistura documentos de
 * tamanhos diferentes e não diz se ALGUM deles chegou perto do teto.
 */
async function ultimoConsumo(api) {
  const leituras = await api.get('/api/ia_extracoes').then(listaDe).catch(() => []);
  const comUso = leituras.filter(l =>
    Number(l.tokens_entrada) > 0 || Number(l.tokens_ocr_entrada) > 0);
  if (!comUso.length) return null;

  const recente = ordenarPorRecente(comUso)[0];
  return {
    titulo: recente.titulo || `Leitura #${recente.id}`,
    entrada: Number(recente.tokens_entrada) || 0,
    saida: Number(recente.tokens_saida) || 0,
    // Um bloco por provedor: são modelos diferentes, com contextos diferentes,
    // e a tela compara cada consumo com o contexto do SEU modelo.
    gemini: {
      modelo: recente.modelo_ocr || null,
      entrada: Number(recente.tokens_ocr_entrada) || 0,
      saida: Number(recente.tokens_ocr_saida) || 0
    },
    groq: {
      modelo: recente.modelo_llm || null,
      entrada: Number(recente.tokens_llm_entrada) || 0,
      saida: Number(recente.tokens_llm_saida) || 0
    }
  };
}

/**
 * Grava a configuração. Restrito ao Sup Admin.
 *
 * Sem permissão própria de propósito: uma permissão que se pode conceder seria
 * exatamente o que se quer evitar aqui.
 */
router.put('/config', exigirSupAdmin, async (req, res) => {
  try {
    const api = createApiClient(req);
    const { valores, erros } = configArmazenada.validar(req.body || {});
    if (erros.length) throw erro(400, erros.join(' | '));
    if (!Object.keys(valores).length) throw erro(400, 'Nada para salvar.');

    await configArmazenada.gravar(api, valores, usuarioDaRequisicao(req));
    await configArmazenada.carregar(api);

    res.json({ ...provedores.configuracao(), pode_editar: true });
  } catch (err) {
    responder(res, err, 'PUT /api/ia/config');
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
      // Quem lê e os limites de envio podem ter mudado na tela. Sem carregar, o
      // upload usaria o provedor do cache vencido — ou o padrão, ignorando a
      // escolha que alguém acabou de fazer.
      await configArmazenada.carregar(api);

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

      // O MODELO que leu, e não o provedor padrão: a leitura pode ter sido
      // feita pela Groq, e gravar o modelo do Gemini nesse caso faria a lista
      // dizer que um arquivo foi lido por quem não o leu.
      let modeloQueLeu = null;
      for (const item of lidos) {
        if (item.origem && item.origem !== 'planilha' && !item.erro) {
          modeloQueLeu = item.modelo || null;
        }
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

      // Consumo da LEITURA, somado sobre os arquivos. Guardado desde já, e não
      // só na extração: uma leitura que nunca foi extraída também gastou
      // contexto, e é o Gemini quem gasta mais dele.
      const gasto = lidos.reduce((soma, l) => ({
        entrada: soma.entrada + (Number(l?.consumo?.entrada) || 0),
        saida: soma.saida + (Number(l?.consumo?.saida) || 0)
      }), { entrada: 0, saida: 0 });

      await api.put(`/api/ia_extracoes/${extracaoId}`, {
        status,
        modelo_ocr: modeloQueLeu,
        ...(gasto.entrada ? {
          tokens_ocr_entrada: gasto.entrada,
          tokens_ocr_saida: gasto.saida,
          tokens_entrada: gasto.entrada,
          tokens_saida: gasto.saida
        } : {}),
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

    // O catálogo de matéria-prima, para dizer na grade como cada insumo casou.
    // Vem aqui e não na hora de abrir o formulário porque a tela precisa
    // MOSTRAR o resultado do casamento antes de qualquer clique: é olhando
    // para a lista que a pessoa descobre que "Couro Serpente Amêndoa" não
    // existe no estoque, e não depois de abrir o formulário e ver que ele não
    // veio.
    // O catálogo de matéria-prima E as etapas de produção: a anotação de
    // casamento precisa das duas, porque um insumo só casa dentro da etapa que
    // a ficha declara.
    // Para a ficha técnica, o catálogo é a matéria-prima; para o pedido, são os
    // produtos. Nos dois casos é a MESMA pergunta — "isto existe no sistema?" —
    // e a mesma anotação responde.
    let materias = [];
    let etapas = [];
    let empresa = null;
    if (extracao.destino === 'produto_insumos') {
      [materias, etapas] = await Promise.all([
        api.get('/api/materia_prima').then(listaDe).catch(() => []),
        api.get('/api/etapas_producao').then(listaDe).catch(() => [])
      ]);
    } else if (extracao.destino === 'orcamentos') {
      [materias, empresa] = await Promise.all([
        catalogoDeProdutos(api),
        contextoDeEmpresa(api, extracao.destino, alvos)
      ]);
    }

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
      // Excluir uma linha apaga o rastro do que foi lido e decidido. É remédio
      // para o que não deveria estar ali, não passo de revisão — e por isso não
      // é permissão de módulo: é Sup Admin ou ninguém.
      pode_excluir_linha: await ehSupAdmin(req),
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
        // O recorte que vai para a IA, quando existe. A tela mostra os dois
        // números para deixar claro que o que será processado é menor.
        ajustado_tamanho: a.texto_ajustado ? String(a.texto_ajustado).length : 0,
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
            ...anotarLinha(extracao.destino, valor, i, { materias, etapas, empresa }),
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

/**
 * Carrega adiante o nome que o DOCUMENTO trouxe.
 *
 * A coerção do esquema derruba tudo o que não é subcampo declarado — e `_lido`
 * não é: ele é anotação, não dado do documento. Só que, sem carregá-lo, trocar
 * o nome à mão apagava a única prova de que a ficha dizia outra coisa, e o (i)
 * ficava vazio justo nas linhas em que a pessoa mexeu.
 *
 * A correspondência é por POSIÇÃO. Por nome seria circular: é justamente o
 * nome que acabou de mudar.
 */
function carregarLido(coagida, anterior) {
  if (!Array.isArray(coagida)) return coagida;
  const antes = Array.isArray(anterior) ? anterior : [];

  // A coerção já traz o `_lido` de cada linha junto com ela (ver
  // `coagirLista`). O que sobra para aqui é a leitura ANTIGA, gravada antes de
  // o `_lido` existir: nessas, o nome que está no banco é o que o documento
  // escreveu, porque ninguém tinha corrigido nada ainda.
  //
  // Só essa herança é por posição, e ela é segura: não houve edição, então
  // nenhuma linha foi descartada entre uma lista e a outra.
  if (coagida.some(sub => sub && sub._lido)) return coagida;

  return coagida.map((sub, i) => {
    const lido = antes[i]?._lido || antes[i]?.nome;
    return lido ? { ...sub, _lido: lido } : sub;
  });
}

/**
 * Anota, em cada insumo da ficha, COMO ele casou com o cadastro.
 *
 * Três desfechos, e a tela desenha os três de forma diferente:
 *
 *   exato ......... o nome bate letra por letra. Nada a dizer.
 *   semelhante .... casou com outro nome. A tela mostra o nome LIDO com um
 *                   (i) que revela para qual cadastro ele foi — porque é um
 *                   palpite bom, não uma certeza, e quem confere precisa poder
 *                   pegar o palpite errado.
 *   null .......... não existe no estoque. A linha inteira fica vermelha: ela
 *                   NÃO vai para o formulário, e descobrir isso depois de
 *                   salvar é descobrir tarde demais.
 *
 * As anotações vão com `_` na frente porque não são dados lidos do documento:
 * são o resultado de uma conta feita agora, contra o estoque de agora. Elas
 * não são gravadas em lugar nenhum e se refazem a cada abertura — que é o que
 * mantém a tela certa depois de alguém cadastrar o insumo que faltava.
 */
/**
 * Anota, em cada item do pedido, COMO ele casou com o catálogo.
 *
 * As mesmas três respostas dos insumos, e pelo mesmo motivo: o que vai para o
 * orçamento é a peça do CATÁLOGO, com o código e o preço dela. Um item que não
 * casou não pode ir, e um que casou por semelhança é um palpite que alguém
 * precisa conferir antes de o preço sair para o cliente.
 *
 * `_preco` vem junto, e é por isso que a coluna de valor na grade é só de
 * leitura: o preço de venda é do cadastro, não do documento. O que o pedido
 * escreveu fica no (i), para conferência — não para uso.
 */
function anotarProdutos(dados, produtos) {
  if (!Array.isArray(dados?.itens)) return dados;

  const porCodigo = preenchimento.indexarPor(produtos, 'codigo');
  const porNome = preenchimento.indexarPor(produtos, 'nome');

  return {
    ...dados,
    itens: dados.itens.map(linha => {
      const nome = String(linha?.nome ?? '').trim();
      if (!nome && !String(linha?.codigo ?? '').trim()) return linha;

      const { registro, tipo, ambiguo } =
        preenchimento.casarProduto(
          linha.codigo, nome, porCodigo, porNome, produtos, linha.valor_unitario);

      return {
        ...linha,
        _lido: linha._lido || nome,
        _casamento: tipo,
        _cadastro: registro ? registro.nome : null,
        // O código e o preço são do CATÁLOGO e não se digitam: trocar a peça
        // troca os dois de uma vez, e é a peça que se escolhe.
        codigo: registro ? (registro.codigo || null) : linha.codigo,
        _preco: registro ? precoDeVenda(registro) : null,
        _ambiguo: ambiguo || null
      };
    })
  };
}

/**
 * Tudo o que a grade precisa saber sobre uma linha: os dados anotados e as
 * opções de cada campo.
 *
 * As opções são por LINHA e não por leitura porque dependem do cliente
 * apontado: os contatos são os DAQUELE cliente, e duas linhas do mesmo pedido
 * podem apontar clientes diferentes. As de `sugestoes` continuam valendo para
 * o que é igual na leitura inteira.
 */
function anotarLinha(destino, dados, item, ctx) {
  const anotados = anotarCasamento(destino, dados, ctx.materias, ctx.etapas);
  const { dados: comEmpresa, opcoes } = anotarEmpresa(anotados, item, ctx.empresa);
  return { dados: comEmpresa, opcoes };
}

/**
 * O que `anotarEmpresa` precisa saber, montado uma vez por requisição.
 *
 * `alvos` já vem carregado pelas duas rotas — reusá-lo evita uma terceira
 * varredura de clientes e prospecções por leitura aberta.
 */
async function contextoDeEmpresa(api, destino, alvos) {
  const esquema = esquemas.obterEsquema(destino);
  const [cadastroClientes, linhas] = await Promise.all([
    cadastroDosClientes(api),
    registrosAlvo(api, destino).catch(() => [])
  ]);

  // A chave é TABELA + ID: o id sozinho é ambíguo quando o destino procura em
  // duas tabelas, e o cliente 50 não é a prospecção 50.
  const porChave = new Map();
  for (const l of linhas) {
    const id = Number(l?.id);
    if (!Number.isFinite(id)) continue;
    porChave.set(`${l._tabela}:${id}`, {
      id,
      tabela: l._tabela,
      // O nome LIMPO, sem o "(Cliente)" que a lista de escolha acrescenta para
      // desambiguar: o que vai para o campo é o nome da empresa, não o rótulo
      // da tabela em que ela mora.
      nome: texto(l?.[esquema?.campoDeExibicao]),
      registro: l
    });
  }

  return {
    cadastroClientes,
    porChave,
    // A lista de escolha, essa sim com o sufixo — é ela que a pessoa lê.
    nomesDeAlvo: (Array.isArray(alvos) ? alvos : []).map(a => a.nome).filter(Boolean)
  };
}

/**
 * O que o cadastro do CLIENTE tem para oferecer a cada linha do pedido.
 *
 * Uma consulta por cliente seria uma por linha da grade; estas duas trazem
 * tudo de uma vez e agrupam por id, que é como todo consumidor quer.
 */
async function cadastroDosClientes(api) {
  const [contatos, transportadoras] = await Promise.all([
    api.get('/api/contatos_cliente').then(listaDe).catch(() => []),
    api.get('/api/transportadoras').then(listaDe).catch(() => [])
  ]);

  const agrupar = (linhas, campoNome) => {
    const mapa = new Map();
    for (const l of linhas) {
      const id = Number(l?.id_cliente);
      if (!Number.isFinite(id)) continue;
      const nome = texto(l?.[campoNome]).trim();
      if (!nome) continue;
      if (!mapa.has(id)) mapa.set(id, []);
      mapa.get(id).push({ id: Number(l.id), nome });
    }
    return mapa;
  };

  return {
    // A coluna chama `transportadora`, não `nome` — é o nome dela na tabela.
    contatos: agrupar(contatos, 'nome'),
    transportadoras: agrupar(transportadoras, 'transportadora')
  };
}

/**
 * Preenche o bloco comercial do pedido a partir do CLIENTE apontado.
 *
 * O pedido nasce preso a uma empresa, e o cadastro dela já sabe a razão
 * social, o CNPJ, quem é o contato e por quem se entrega. Deixar esses campos
 * como o documento os escreveu significava mandar para o orçamento um texto
 * que o formulário ignora — ele quer o ID do contato, não o nome.
 *
 * A regra é: o que o documento trouxe VALE, se existir no cadastro. Não
 * existindo, e havendo uma só opção, ela entra — é o que o sistema sabe, e
 * saber é melhor que deixar em branco. Havendo várias e nenhuma batendo, fica
 * vazio para a pessoa escolher; a grade oferece a lista.
 *
 * Devolve também as OPÇÕES de cada campo, que são por LINHA e não por leitura:
 * os contatos são os daquele cliente, e duas linhas do mesmo pedido podem
 * apontar clientes diferentes.
 */
function anotarEmpresa(dados, item, ctx) {
  if (!ctx?.porChave) return { dados, opcoes: {} };

  // A lista de empresas não depende de qual delas foi apontada: ela existe
  // JUSTAMENTE para a linha que ainda não tem uma. Sem isto, a linha travada
  // ficava com um campo de texto livre — que é o que a pessoa não pode usar.
  const semAlvo = { dados, opcoes: { cliente: ctx.nomesDeAlvo || [] } };

  const alvo = ctx.porChave.get(`${item?.alvo_tabela}:${Number(item?.alvo_id)}`);
  if (!alvo || !alvo.nome) return semAlvo;

  const opcoes = { cliente: ctx.nomesDeAlvo || [] };
  const saida = { ...dados };
  const origem = {};
  const lidos = {};

  // O nome da empresa passa a ser o do CADASTRO. É ele que identifica o
  // registro, e é contra ele que a pessoa confere na próxima vez.
  const nomeLido = texto(dados?.cliente);
  if (nomeLido && normalizarTexto(nomeLido) !== normalizarTexto(alvo.nome)) {
    lidos.cliente = nomeLido;
  }
  saida.cliente = alvo.nome;
  origem.cliente = 'cadastro';

  // Razão social e CNPJ não se escolhem: são do registro, e mudam só quando o
  // cliente muda.
  if (alvo.tabela === 'clientes') {
    for (const [chave, coluna] of [['razao_social', 'razao_social'], ['cnpj', 'cnpj']]) {
      const doCadastro = texto(alvo.registro?.[coluna]);
      if (!doCadastro) continue;
      const lido = texto(dados?.[chave]);
      if (lido && normalizarTexto(lido) !== normalizarTexto(doCadastro)) lidos[chave] = lido;
      saida[chave] = doCadastro;
      origem[chave] = 'cadastro';
    }
  }

  for (const [chave, mapa] of [
    ['contato', ctx.cadastroClientes.contatos],
    ['transportadora', ctx.cadastroClientes.transportadoras]
  ]) {
    const lista = (alvo.tabela === 'clientes' ? mapa.get(Number(alvo.id)) : null) || [];
    opcoes[chave] = lista.map(o => o.nome);
    if (!lista.length) continue;

    const lido = texto(dados?.[chave]);
    const achado = lista.find(o => normalizarTexto(o.nome) === normalizarTexto(lido));

    if (achado) { saida[chave] = achado.nome; origem[chave] = 'cadastro'; continue; }
    // Uma opção só: é o que o sistema sabe, e saber é melhor que branco.
    if (lista.length === 1) {
      if (lido) lidos[chave] = lido;
      saida[chave] = lista[0].nome;
      origem[chave] = 'cadastro';
      continue;
    }
    // Várias e nenhuma batendo: fica para a pessoa escolher da lista.
    if (lido) { lidos[chave] = lido; saida[chave] = null; }
  }

  if (Object.keys(origem).length) saida._origem = origem;
  if (Object.keys(lidos).length) saida._lidos = lidos;
  return { dados: saida, opcoes };
}

/**
 * Catálogo de peças COM o preço praticado.
 *
 * `preco_tabela` não é coluna de `produtos`: mora em `tabela_fixa` e é acoplada
 * por quem lista os produtos pelo BFF (ver backend/tabelaFixa.js). Aqui a
 * conversa é com a API remota, que devolve a tabela crua — pedir só
 * `/api/produtos` traria peças sem preço nenhum, e o valor do item chegaria
 * vazio em todo orçamento lido.
 *
 * Preço ausente vira `null`, e null não é zero: quer dizer "esta peça não tem
 * preço praticado" — o orçamento recusa o item, como já recusa em qualquer
 * outro caminho.
 */
async function catalogoDeProdutos(api) {
  const [produtos, tabela] = await Promise.all([
    api.get('/api/produtos').then(listaDe).catch(() => []),
    api.get('/api/tabela_fixa').then(listaDe).catch(() => [])
  ]);

  const precos = new Map();
  for (const linha of tabela) {
    const id = Number(linha?.id_prod);
    if (Number.isFinite(id)) precos.set(id, linha?.vlr_prod);
  }

  return produtos.map(p => ({
    ...p,
    preco_tabela: precos.has(Number(p?.id)) ? precos.get(Number(p?.id)) : null
  }));
}

/**
 * Preço PRATICADO da peça — o que vai para o cliente.
 *
 * `preco_tabela` e não `preco_venda`: o segundo é custo apurado e se move
 * sozinho quando um insumo encarece. Ver src/utils/precoTabela.js.
 */
function precoDeVenda(produto) {
  // `paraDecimal` e não `Number`: a API devolve o valor como veio do banco, e
  // "1.234,56" vira NaN no `Number` — a peça mais cara do catálogo é
  // justamente a que tem separador de milhar.
  const n = paraDecimal(produto?.preco_tabela);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Caixa e acento não distinguem unidade nem etapa. */
const normalizarTexto = v => String(v ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();

function anotarCasamento(destino, dados, materias, etapas = []) {
  if (destino === 'orcamentos') return anotarProdutos(dados, materias);
  if (destino !== 'produto_insumos' || !Array.isArray(dados?.insumos)) return dados;

  const porNome = preenchimento.indexarPor(materias, 'nome');
  const etapasPorId = new Map(etapas.map(e => [String(e.id), e.nome]));

  return {
    ...dados,
    insumos: dados.insumos.map(linha => {
      const nome = String(linha?.nome ?? '').trim();
      if (!nome) return linha;

      const processo = String(linha?.processo ?? '').trim();
      const { registro, tipo, foraDoProcesso, ambiguo } =
        preenchimento.casarInsumo(nome, porNome, materias, processo, etapasPorId);

      // Unidade e processo do CADASTRO, e se o que está na linha bate com
      // eles.
      //
      // Não basta o insumo existir: ele existe com uma unidade e numa etapa, e
      // é com essas que a ficha do produto vai ser montada. Uma linha que diz
      // "m²" para um insumo cadastrado em "ML" produz uma receita cujo custo
      // está errado por três ordens de grandeza — e o nome bate, então nada
      // parece fora do lugar.
      const unidadeCadastro = registro ? String(registro.unidade || '').trim() : null;
      const processoCadastro = registro
        ? String(etapasPorId.get(String(registro.processo).trim()) || registro.processo || '').trim()
        : null;

      const combina = (naLinha, noCadastro) => {
        if (!noCadastro) return null;
        if (!String(naLinha || '').trim()) return false;
        return normalizarTexto(naLinha) === normalizarTexto(noCadastro);
      };

      return {
        ...linha,
        // O que o DOCUMENTO escreveu, guardado na primeira anotação e nunca
        // mais tocado. Sem ele, trocar o nome à mão apagava a única prova de
        // que a ficha dizia outra coisa — e o (i) da linha ficava sem conteúdo
        // justo nas linhas que a pessoa mexeu.
        _lido: linha._lido || nome,
        _casamento: tipo,
        _cadastro: registro ? registro.nome : null,
        _unidade_cadastro: unidadeCadastro,
        _processo_cadastro: processoCadastro,
        _unidade_ok: combina(linha.unidade, unidadeCadastro),
        _processo_ok: combina(linha.processo, processoCadastro),
        // Distingue "não existe" de "existe em outra etapa": a tela mostra os
        // dois em vermelho, mas o que fazer com cada um é diferente.
        _fora_do_processo: foraDoProcesso ? foraDoProcesso.processo : null,
        // E de "existe mais de um igualmente parecido", que pede escolher.
        _ambiguo: ambiguo || null
      };
    })
  };
}

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
      texto_ajustado: arquivo.texto_ajustado || '',
      erro: arquivo.erro || null
    });
  } catch (err) {
    responder(res, err, 'GET /api/ia/:id/arquivos/:arquivoId/texto');
  }
});

/**
 * A carga para ABRIR O MODAL DO DESTINO já preenchido com um item lido.
 *
 * Fica atrás de `ia.details.view` e não de `ia.apply.*` de propósito: esta
 * rota não grava nada em lugar nenhum. Ela lê o item, resolve as identidades
 * (o insumo, o produto, o cliente) e devolve o que o formulário precisa.
 * Quem salva é o usuário, no modal do módulo, com a permissão daquele módulo
 * sendo cobrada lá — que é onde ela sempre foi cobrada.
 */
router.get('/:id/itens/:itemId/preenchimento', exigirPermissao('ia.details.view'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const id = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(id) || !Number.isFinite(itemId)) throw erro(400, 'Item inválido');

    const extracao = await buscarExtracao(api, id);

    const item = await api.get(`/api/ia_extracao_itens/${itemId}`);
    if (!item || item.error === 'Not found') throw erro(404, 'Item não encontrado');
    // Mesmo cuidado da leitura de texto: sem conferir o vínculo, um id de item
    // qualquer seria legível por quem só tem acesso a outra leitura.
    if (Number(item.extracao_id) !== id) throw erro(404, 'Item não encontrado');

    const carga = await preenchimento.montarPreenchimento({
      api,
      destino: extracao.destino,
      item: { ...item, dados: lerDados(item.dados).valor }
    });

    res.json({ item_id: itemId, destino: extracao.destino, ...carga });
  } catch (err) {
    responder(res, err, 'GET /api/ia/:id/itens/:itemId/preenchimento');
  }
});

/**
 * Fecha a leitura quando não sobra linha pendente.
 *
 * A situação da leitura é um RESUMO das linhas, e enquanto ela era escrita só
 * na aplicação em lote ficava mentindo: com um item só, resolvido pelo
 * formulário do módulo, a leitura continuava dizendo "Em revisão" para sempre
 * — e a lista, que é onde se procura o que ainda falta fazer, mostrava
 * trabalho que já tinha sido feito.
 *
 * "Não sobra pendente" inclui o descartado: descartar é uma decisão tomada,
 * não uma pendência.
 */
async function fecharSeNadaPendente(api, extracaoId, statusAtual) {
  if (statusAtual !== 'revisao') return statusAtual;

  const itens = listaDe(
    await api.get('/api/ia_extracao_itens', { query: { extracao_id: extracaoId } })
  );
  if (!itens.length) return statusAtual;

  const pendente = itens.some(i => i.status !== 'aplicado' && i.status !== 'ignorado' && i.acao !== 'ignorar');
  if (pendente) return statusAtual;

  // "Concluída" quer dizer que a leitura VIROU alguma coisa. Uma em que todas
  // as linhas foram descartadas também não tem pendência — e dizer que ela
  // concluiu é dizer que um cadastro aconteceu quando nada aconteceu.
  //
  // Quem descarta tudo sabe que descartou; quem lê a lista depois, não. E é
  // essa pessoa que precisa distinguir uma leitura que rendeu de uma que foi
  // jogada fora, sem ter de abrir as duas para descobrir.
  const aplicados = itens.filter(i => i.status === 'aplicado').length;
  const situacao = aplicados > 0 ? 'aplicada' : 'cancelada';

  await api.put(`/api/ia_extracoes/${extracaoId}`, {
    status: situacao,
    aplicados_qtd: aplicados,
    aplicado_em: new Date().toISOString()
  });
  return situacao;
}

/**
 * Guarda o recorte de um arquivo — o que a pessoa quer que vá para a extração.
 *
 * Fica atrás de `ia.extract` e não de `ia.details.view`: recortar não é ler, é
 * decidir o que a próxima extração vai processar.
 */
router.put('/:id/arquivos/:arquivoId/texto', exigirPermissao('ia.extract'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const id = Number(req.params.id);
    const arquivoId = Number(req.params.arquivoId);
    if (!Number.isFinite(id) || !Number.isFinite(arquivoId)) throw erro(400, 'Arquivo inválido');

    const arquivo = await api.get(`/api/ia_extracao_arquivos/${arquivoId}`);
    if (!arquivo || arquivo.error === 'Not found') throw erro(404, 'Arquivo não encontrado');
    if (Number(arquivo.extracao_id) !== id) throw erro(404, 'Arquivo não encontrado');

    // Vazio quer dizer "volte a usar a transcrição inteira".
    const recorte = String(req.body?.texto_ajustado ?? '').trim();

    const limite = provedores.LIMITES.textoMaxChars();
    if (recorte.length > limite) {
      throw erro(400, `O recorte passa de ${limite.toLocaleString('pt-BR')} caracteres.`);
    }

    await api.put(`/api/ia_extracao_arquivos/${arquivoId}`, { texto_ajustado: recorte || null });

    res.json({
      id: arquivoId,
      texto_ajustado: recorte,
      ajustado_tamanho: recorte.length,
      texto_tamanho: arquivo.texto ? String(arquivo.texto).length : 0
    });
  } catch (err) {
    responder(res, err, 'PUT /api/ia/:id/arquivos/:arquivoId/texto');
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
/**
 * O texto que vai para a extração.
 *
 * O recorte que a pessoa fez vence a transcrição inteira. Quem está olhando o
 * documento sabe o que interessa ao destino escolhido, e o que não interessa
 * custa contexto e — pior — dá ao modelo em que se distrair.
 *
 * A transcrição original continua guardada: ela é a resposta para "de onde
 * veio este dado", que é metade do motivo de o módulo existir.
 */
function textoParaExtrair(arquivo) {
  const recorte = String(arquivo?.texto_ajustado || '').trim();
  return recorte || String(arquivo?.texto || '');
}

function juntarTextos(arquivos) {
  return arquivos
    .map(a => ({ nome: a.nome_arquivo, texto: textoParaExtrair(a) }))
    .filter(a => a.texto)
    .map(a => `### ${a.nome}\n${a.texto}`)
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

    // Modelo e limites podem ter mudado na tela desde a última leitura.
    await configArmazenada.carregar(api);

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
    const existentes = await registrosAlvo(api, extracao.destino);
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
      // Guardado por leitura, e não somado num contador global: "esta planilha
      // gastou 40 mil dos 131 mil que o modelo aguenta" diz o que fazer; um
      // total acumulado do mês não diz nada.
      // Cada passo guarda o SEU consumo, porque cada um usa um modelo com um
      // contexto diferente — somar os dois e comparar contra um deles daria
      // uma porcentagem que não significa nada.
      tokens_llm_entrada: extraidos.tokens_entrada || 0,
      tokens_llm_saida: extraidos.tokens_saida || 0,
      // E as colunas antigas passam a valer como o TOTAL da leitura, que é o
      // número útil para saber quanto o documento custou por inteiro.
      tokens_entrada: (Number(extracao.tokens_ocr_entrada) || 0) + (extraidos.tokens_entrada || 0),
      tokens_saida: (Number(extracao.tokens_ocr_saida) || 0) + (extraidos.tokens_saida || 0),
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

    // O formulário do módulo salvou: a linha VIROU cadastro.
    //
    // Antes ela era marcada com `acao: 'ignorar'`, que é o mesmo que a pessoa
    // usa para JOGAR FORA uma linha. Os dois desfechos ficavam com a mesma
    // marca, e nada distinguia uma leitura que rendeu de uma inteiramente
    // descartada — nem na lista, nem na contagem de aplicados.
    if (req.body?.resolvido === true) {
      payload.status = 'aplicado';
      payload.aplicado_em = new Date().toISOString();
      payload.mensagem = null;
    }

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
        novos[campo.chave] = campo.tipo === 'lista'
          ? carregarLido(valor, atual[campo.chave])
          : valor;
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
      // Com mais de uma tabela possível (o orçamento), quem escolhe diz de
      // qual delas é o registro — o id sozinho seria ambíguo, e apontar para a
      // tabela errada criaria o orçamento na série errada.
      const tabelasPossiveis = esquemas.tabelasAlvoDo(extracao.destino).map(t => t.tabela);
      const informada = texto(req.body?.alvo_tabela);
      if (alvo === null) {
        payload.alvo_tabela = null;
      } else if (informada) {
        if (!tabelasPossiveis.includes(informada)) {
          throw erro(400, `Destino inválido: "${informada}" não é um alvo deste tipo de leitura.`);
        }
        payload.alvo_tabela = informada;
      } else {
        payload.alvo_tabela = tabelasPossiveis[0] || esquema.tabelaAlvo;
      }
      // Escolher o destino já define a ação: "atualizar" nos destinos comuns,
      // "criar" onde o alvo é vínculo (o orçamento nasce preso ao cliente).
      if (alvo !== null) payload.acao = payload.acao || esquema.acaoAoCasar || 'atualizar';
    }

    if (!Object.keys(payload).length) throw erro(400, 'Nada para alterar');

    // Correção do revisor apaga a ressalva da IA: ela falava do valor antigo.
    payload.mensagem = null;
    const salvo = await api.put(`/api/ia_extracao_itens/${itemId}`, payload);

    // O casamento é REFEITO e devolvido junto.
    //
    // As anotações (`_casamento`, `_cadastro`) são conta, não dado: elas não
    // são gravadas e se refazem a cada leitura do detalhe. Devolver o item sem
    // elas fazia toda a linha perder os marcadores assim que UM campo era
    // corrigido — e só voltavam fechando e reabrindo o modal.
    // O mesmo catálogo do detalhe: a anotação é refeita aqui para a linha não
    // perder os marcadores ao ser corrigida.
    let materias = [];
    let etapas = [];
    let empresa = null;
    if (extracao.destino === 'produto_insumos') {
      [materias, etapas] = await Promise.all([
        api.get('/api/materia_prima').then(listaDe).catch(() => []),
        api.get('/api/etapas_producao').then(listaDe).catch(() => [])
      ]);
    } else if (extracao.destino === 'orcamentos') {
      const alvos = await alvosDoDestino(api, extracao.destino);
      [materias, empresa] = await Promise.all([
        catalogoDeProdutos(api),
        contextoDeEmpresa(api, extracao.destino, alvos)
      ]);
    }

    // Marcar a última linha como resolvida fecha a leitura.
    const situacao = await fecharSeNadaPendente(api, id, extracao.status);

    res.json({
      id: salvo.id,
      linha: Number(salvo.linha) || 0,
      // A tela precisa saber que a leitura mudou de situação: sem isto, o
      // cabeçalho continuaria dizendo "Em revisão" até alguém reabrir.
      leitura_status: situacao,
      leitura_status_rotulo: SITUACOES.find(s => s.id === situacao)?.rotulo || situacao,
      ...anotarLinha(extracao.destino, lerDados(salvo.dados).valor, salvo, { materias, etapas, empresa }),
      acao: salvo.acao,
      alvo_id: salvo.alvo_id ?? null,
      alvo_tabela: salvo.alvo_tabela || null,
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
          // A TABELA do alvo vai junto: é ela que decide, no orçamento, se o
          // vínculo é com cliente ou com prospecção — e, com isso, se o número
          // sai como ORC ou OCRP.
          alvo_tabela: i.alvo_tabela || null,
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
/**
 * Exclui UMA linha da leitura. Só o Sup Admin.
 *
 * As outras saídas de uma linha a mantêm no registro: descartar diz "esta não
 * vira nada" e aplicar diz "esta virou". As duas ficam visíveis, e é por elas
 * que se reconstrói depois o que foi lido e o que se decidiu.
 *
 * Excluir apaga o rastro, e por isso não é decisão de revisor: é o remédio
 * para o que não deveria estar ali — uma linha que o modelo inventou, uma
 * duplicata, um dado que não pode continuar guardado. Vale para QUALQUER
 * linha, inclusive a já aplicada; a trava de edição não se aplica, porque
 * excluir não é editar.
 *
 * O que a exclusão NÃO faz é desfazer o cadastro que a linha criou no módulo
 * de destino — aquele registro tem vida própria, e desfazê-lo é lá.
 */
router.delete('/:id/itens/:itemId', exigirSupAdmin, async (req, res) => {
  try {
    const api = createApiClient(req);
    const id = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    if (!Number.isFinite(id) || !Number.isFinite(itemId)) throw erro(400, 'Linha inválida');

    const extracao = await buscarExtracao(api, id);

    const item = await api.get(`/api/ia_extracao_itens/${itemId}`);
    if (!item || item.error === 'Not found') throw erro(404, 'Linha não encontrada');
    // Sem conferir o vínculo, um id de linha qualquer seria apagável por quem
    // só tem acesso a outra leitura.
    if (Number(item.extracao_id) !== id) throw erro(404, 'Linha não encontrada');

    await api.delete(`/api/ia_extracao_itens/${itemId}`);

    // A leitura pode ter ficado sem pendência ao perder a linha — ou ter
    // voltado a ter, se a excluída era a única aplicada.
    const situacao = await fecharSeNadaPendente(api, id, extracao.status);

    res.json({
      sucesso: true,
      id: itemId,
      leitura_status: situacao,
      leitura_status_rotulo: SITUACOES.find(s => s.id === situacao)?.rotulo || situacao
    });
  } catch (err) {
    responder(res, err, 'DELETE /api/ia/:id/itens/:itemId');
  }
});

router.delete('/:id', exigirPermissao('ia.delete'), async (req, res) => {
  try {
    const api = createApiClient(req);
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) throw erro(400, 'Leitura inválida');

    const extracao = await buscarExtracao(api, id);

    // Leitura aplicada é registro do que aconteceu, e por isso o revisor comum
    // não a apaga: os cadastros que ela criou continuam nos módulos, e sem a
    // leitura ninguém mais sabe de onde vieram.
    //
    // O Sup Admin apaga. É o remédio para o que não deveria estar guardado —
    // uma leitura de teste, um documento que não podia ficar no sistema — e
    // não há outra forma de tirá-la. Os cadastros continuam onde estão; desfazê-
    // los é no módulo de destino, e o modal de exclusão diz isso antes.
    if (extracao.status === 'aplicada' && !(await ehSupAdmin(req))) {
      throw erro(409, 'Esta leitura já foi aplicada. Só o Sup Admin pode excluí-la.');
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
module.exports.registrosAlvo = registrosAlvo;
module.exports.texto = texto;
