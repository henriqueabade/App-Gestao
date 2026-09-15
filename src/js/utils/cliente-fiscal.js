/**
 * Dados fiscais do cliente nos modais (novo, editar, detalhes): tipo de
 * pessoa (CNPJ ou CPF), indicador de IE, e-mail da NF-e, consumidor final e o
 * código IBGE dos endereços de registro e de entrega.
 *
 * Um utilitário só, carregado pelo menu, porque os três modais têm os mesmos
 * campos com os mesmos ids — e a busca do IBGE (GET /api/fiscal/municipios)
 * não pode existir em três cópias. O cadastro guarda o estado pelo NOME
 * ("Minas Gerais"); o backend converte para a sigla.
 */
(function () {
  const CAMPOS = {
    empresaTipoPessoa: 'tipo_pessoa',
    empresaCpf: 'cpf',
    empresaIndicadorIe: 'indicador_ie',
    empresaEmailNfe: 'email_nfe',
    empresaConsumidorFinal: 'consumidor_final'
  };

  const el = (raiz, id) => (raiz || document).querySelector(`#${id}`);

  /** PJ mostra o CNPJ; PF mostra o CPF. */
  function alternarTipo(raiz) {
    const pf = String(el(raiz, 'empresaTipoPessoa')?.value || 'PJ').toUpperCase() === 'PF';
    el(raiz, 'empresaCnpjBloco')?.classList.toggle('hidden', pf);
    el(raiz, 'empresaCpfBloco')?.classList.toggle('hidden', !pf);
  }

  function preencher(raiz, cli) {
    if (!cli) return;
    for (const [id, chave] of Object.entries(CAMPOS)) {
      const campo = el(raiz, id);
      if (!campo) continue;
      const valor = cli[chave];
      if (campo.type === 'checkbox') campo.checked = Boolean(valor);
      else campo.value = valor === null || valor === undefined ? (chave === 'tipo_pessoa' ? 'PJ' : (chave === 'indicador_ie' ? '9' : '')) : String(valor);
    }
    const reg = el(raiz, 'regCodigoMunicipio');
    if (reg) reg.value = cli.endereco_registro?.codigo_municipio || '';
    const ent = el(raiz, 'entCodigoMunicipio');
    if (ent) ent.value = cli.endereco_entrega?.codigo_municipio || '';
    alternarTipo(raiz);
  }

  /** O que vai no payload do cliente (os códigos IBGE vão dentro dos endereços). */
  function coletar(raiz) {
    const valor = id => (el(raiz, id)?.value || '').trim();
    return {
      tipo_pessoa: valor('empresaTipoPessoa') || 'PJ',
      cpf: valor('empresaCpf').replace(/\D/g, ''),
      indicador_ie: valor('empresaIndicadorIe') || '9',
      email_nfe: valor('empresaEmailNfe'),
      consumidor_final: Boolean(el(raiz, 'empresaConsumidorFinal')?.checked)
    };
  }

  function codigoMunicipio(raiz, prefixo) {
    return (el(raiz, `${prefixo}CodigoMunicipio`)?.value || '').replace(/\D/g, '');
  }

  /** Procura o código IBGE pela cidade e pelo estado já digitados. */
  async function buscarIbge(raiz, prefixo) {
    const cidade = (el(raiz, `${prefixo}Cidade`)?.value || '').trim();
    const estado = (el(raiz, `${prefixo}Estado`)?.value || '').trim();
    const destino = el(raiz, `${prefixo}CodigoMunicipio`);
    const avisar = (texto, tipo) => window.showToast?.(texto, tipo || 'info');
    if (!cidade || !estado) { avisar('Preencha a cidade e o estado antes de buscar o código IBGE.', 'error'); return null; }
    try {
      const base = await window.apiConfig.getApiBaseUrl();
      const resposta = await fetch(`${base}/api/fiscal/municipios?uf=${encodeURIComponent(estado)}&nome=${encodeURIComponent(cidade)}`);
      const corpo = await resposta.json().catch(() => null);
      if (!resposta.ok) throw new Error(corpo?.error || `Erro ${resposta.status}`);
      const achado = corpo.exato || (corpo.candidatos?.length === 1 ? corpo.candidatos[0] : null);
      if (achado) {
        if (destino) destino.value = achado.codigo;
        avisar(`Código IBGE de ${achado.nome}/${corpo.uf}: ${achado.codigo}.`, 'success');
        return achado;
      }
      if (corpo.candidatos?.length) {
        avisar(`Cidade não encontrada com esse nome. Parecidas: ${corpo.candidatos.map(c => c.nome).join(', ')}.`, 'error');
      } else {
        avisar(`Nenhum município "${cidade}" em ${corpo.uf}.`, 'error');
      }
      return null;
    } catch (e) {
      avisar(e.message || 'Não foi possível consultar o IBGE.', 'error');
      return null;
    }
  }

  /** Liga o tipo de pessoa e os botões de busca do IBGE de um modal. */
  function ligar(raiz) {
    const tipo = el(raiz, 'empresaTipoPessoa');
    if (tipo && tipo.dataset.fiscalLigado !== '1') {
      tipo.dataset.fiscalLigado = '1';
      tipo.addEventListener('change', () => alternarTipo(raiz));
    }
    for (const prefixo of ['reg', 'ent']) {
      const botao = el(raiz, `${prefixo}BuscarIbge`);
      if (!botao || botao.dataset.fiscalLigado === '1') continue;
      botao.dataset.fiscalLigado = '1';
      botao.dataset.acaoGerida = 'true';
      botao.addEventListener('click', () => {
        const executar = () => buscarIbge(raiz, prefixo);
        return window.BotaoAcao?.run ? window.BotaoAcao.run(botao, executar) : executar();
      });
    }
    alternarTipo(raiz);
  }

  window.ClienteFiscal = { CAMPOS, ligar, preencher, coletar, alternarTipo, buscarIbge, codigoMunicipio };
})();
