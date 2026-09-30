/**
 * Segredos e certificado das integrações, no mesmo padrão do fiscal e da
 * cobrança (fiscalController.js / cobrancaController.js):
 *
 *   client_secret do BB .... banco (segredos_app, cifrado com a chave mestra
 *                            do .env) → cofre deste computador → .env (DEV).
 *                            Com "usar a mesma aplicação da cobrança", vale o
 *                            secret da Configuração de cobrança.
 *   certificado A1 ......... o da Configuração fiscal: banco ('certificado')
 *                            → cofre deste computador. Aberto uma vez por
 *                            versão (abrir o .pfx custa).
 *
 * Nada daqui sai para a tela: só resumos (titular, CNPJ, validade, de onde
 * veio). O certificado público (.cer, sem a chave privada) é a exceção — é o
 * que o dono cadastra no portal do BB para o mTLS.
 */
const fs = require('fs');
const c = require('../../financeiro/comum');
const certificado = require('../../fiscal/certificado');
const segredoLocal = require('../../fiscal/segredoLocal');
const segredoBanco = require('../../fiscal/segredoBanco');
const configuracaoCobranca = require('../../cobranca/configuracaoCobranca');
const catalogo = require('./catalogo');

const nomeNoBanco = (integracao, ambiente) => `${integracao}_client_secret_${ambiente === catalogo.PRODUCAO ? 'producao' : 'homologacao'}`;
const nomeNoCofre = (integracao, ambiente) => `${integracao}-${ambiente === catalogo.PRODUCAO ? 'producao' : 'homologacao'}`;
const variavelEnv = (integracao, ambiente) => `${integracao.toUpperCase()}_CLIENT_SECRET_${ambiente === catalogo.PRODUCAO ? 'PRODUCAO' : 'HOMOLOGACAO'}`;
/** A cobrança chama a homologação de 'sandbox'. */
const ambienteDaCobranca = ambiente => (ambiente === catalogo.PRODUCAO ? configuracaoCobranca.PRODUCAO : configuracaoCobranca.SANDBOX);

function criar({ env = process.env, cofre = null, banco = null } = {}) {
  const local = cofre || segredoLocal.criar();
  const doBanco = banco || segredoBanco.criar({ env });
  let certificadoAberto = { chave: null, dados: null };

  /** Um segredo pela ordem banco → computador → .env: `{ valor, origem, guardadoEm, erro }`. */
  async function ler(api, { nomeBanco, campoBanco = 'secret', nomeCofre, variavel }) {
    let aviso = null;
    if (api) {
      const s = await doBanco.ler(api, nomeBanco).catch(() => null);
      if (s?.valor?.[campoBanco]) return { valor: s.valor[campoBanco], origem: 'banco', guardadoEm: s.atualizadoEm || null };
      if (s?.erro) aviso = s.erro;
    }
    const guardado = typeof local.lerSegredo === 'function' ? local.lerSegredo(nomeCofre) : null;
    if (guardado?.valor) return { valor: guardado.valor, origem: 'computador', guardadoEm: guardado.guardadoEm || null };
    if (variavel && env[variavel]) return { valor: env[variavel], origem: 'env', guardadoEm: null };
    return { valor: null, origem: null, guardadoEm: null, erro: aviso || guardado?.erro || null };
  }

  /** O client_secret próprio da integração no ambiente. */
  function lerSecret(api, integracao, ambiente) {
    return ler(api, { nomeBanco: nomeNoBanco(integracao, ambiente), nomeCofre: nomeNoCofre(integracao, ambiente), variavel: variavelEnv(integracao, ambiente) });
  }

  /** O client_secret da cobrança (mesma aplicação do BB). */
  function lerSecretDaCobranca(api, ambiente) {
    const amb = ambienteDaCobranca(ambiente);
    return ler(api, { nomeBanco: `bb_client_secret_${amb}`, nomeCofre: `bb-${amb}`, variavel: `BB_CLIENT_SECRET_${amb.toUpperCase()}` });
  }

  async function guardarSecret(api, integracao, ambiente, secret, { destino = null, usuarioId = null } = {}) {
    const valor = String(secret ?? '').trim();
    if (!valor) throw c.erro('Informe o client_secret.');
    const onde = String(destino || (doBanco.disponivel ? 'banco' : 'computador')).toLowerCase();
    if (onde === 'banco') {
      await doBanco.guardar(api, nomeNoBanco(integracao, ambiente), { secret: valor }, { descricao: `Client secret ${integracao} (${ambiente})`, usuarioId });
    } else if (onde === 'computador') {
      if (typeof local.guardarSegredo !== 'function') throw c.erro('Cofre deste computador indisponível.', 500);
      local.guardarSegredo(nomeNoCofre(integracao, ambiente), valor);
    } else {
      throw c.erro('Destino inválido: banco ou computador.');
    }
    return true;
  }

  async function removerSecret(api, integracao, ambiente, destino = 'ambos') {
    if (destino === 'banco' || destino === 'ambos') await doBanco.remover(api, nomeNoBanco(integracao, ambiente)).catch(() => {});
    if (destino === 'computador' || destino === 'ambos') local.removerSegredo?.(nomeNoCofre(integracao, ambiente));
    return true;
  }

  /**
   * As credenciais do BB da integração no ambiente: da cobrança (mesma
   * aplicação) ou as próprias. `{ clientId, appKey, secret, origem, secretOrigem }`.
   */
  async function credenciaisBB(api, def, params, ambiente) {
    if (params.usar_credenciais_da_cobranca !== false) {
      const cfg = await configuracaoCobranca.carregar(api).catch(() => null);
      const cr = configuracaoCobranca.credenciais(cfg, ambienteDaCobranca(ambiente));
      const s = await lerSecretDaCobranca(api, ambiente);
      return { clientId: cr.clientId, appKey: cr.appKey, secret: s.valor, origem: 'cobranca', secretOrigem: s.origem, secretErro: s.erro || null, cobranca: cfg };
    }
    const sufixo = ambiente === catalogo.PRODUCAO ? 'producao' : 'homologacao';
    const s = await lerSecret(api, def.segredo || def.chave, ambiente);
    return {
      clientId: String(params[`client_id_${sufixo}`] || '').trim() || null, appKey: String(params[`app_key_${sufixo}`] || '').trim() || null,
      secret: s.valor, origem: 'propria', secretOrigem: s.origem, secretErro: s.erro || null, cobranca: null
    };
  }

  /** O certificado A1 aberto (PEM), na ordem do fiscal: banco → este computador. */
  async function carregarCertificado(api) {
    let aviso = null;
    if (api) {
      const s = await doBanco.ler(api, 'certificado').catch(() => null);
      if (s?.valor?.pfxBase64) {
        const chave = `banco|${s.atualizadoEm}|${s.valor.pfxBase64.length}`;
        if (certificadoAberto.chave !== chave) {
          const dados = certificado.abrirPfx(Buffer.from(s.valor.pfxBase64, 'base64'), s.valor.senha ?? '');
          certificadoAberto = { chave, dados: { ...dados, origem: 'banco', guardadoEm: s.atualizadoEm || null } };
        }
        return certificadoAberto.dados;
      }
      if (s?.erro) aviso = s.erro;
    }
    const fonte = typeof local.fonte === 'function' ? local.fonte() : null;
    if (!fonte) throw c.erro(aviso || 'Nenhum certificado digital configurado (nem no banco, nem neste computador).', 409);
    if (fonte.erro) throw c.erro(fonte.erro, 409);
    let stat;
    try {
      stat = fs.statSync(fonte.caminho);
    } catch (_) {
      throw c.erro('O arquivo do certificado não foi encontrado neste computador.', 409);
    }
    const chave = `${fonte.caminho}|${stat.mtimeMs}|${stat.size}`;
    if (certificadoAberto.chave !== chave) {
      const dados = certificado.abrirPfx(fs.readFileSync(fonte.caminho), fonte.senha);
      certificadoAberto = { chave, dados: { ...dados, origem: fonte.origem || 'computador', guardadoEm: fonte.guardadoEm || null } };
    }
    return certificadoAberto.dados;
  }

  /** Para a tela: nunca lança; o erro vira texto. */
  async function resumoDoCertificado(api) {
    try {
      const dados = await carregarCertificado(api);
      return { ...certificado.resumo(dados), origem: dados.origem, guardadoEm: dados.guardadoEm };
    } catch (e) {
      return { configurado: false, erro: e.message };
    }
  }

  /** O certificado público (PEM, sem a chave privada) para cadastrar no portal do BB. */
  async function certificadoPublico(api) {
    const dados = await carregarCertificado(api);
    return { pem: dados.certificadoPem, titular: dados.titular, cnpj: dados.cnpj, validoAte: new Date(dados.validoAte).toISOString() };
  }

  return {
    get bancoDisponivel() { return Boolean(doBanco.disponivel); },
    get cofreDisponivel() { return Boolean(local.temCofre); },
    lerSecret, lerSecretDaCobranca, guardarSecret, removerSecret, credenciaisBB,
    carregarCertificado, resumoDoCertificado, certificadoPublico
  };
}

module.exports = { criar, nomeNoBanco, nomeNoCofre, variavelEnv, ambienteDaCobranca };
