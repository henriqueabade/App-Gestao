/**
 * Modal de detalhes da prospecção.
 *
 * Tudo aqui vem de GET /api/prospeccoes/:id. A versão anterior era um mockup:
 * remontava o registro raspando o `textContent` das células da grade e, para o
 * que não conseguia raspar, exibia um exemplo embutido ("Jennifer Wilson" /
 * "Acme Corporation") por cima de um registro real.
 *
 * Somente LEITURA nesta etapa, fora Editar e Excluir, que reaproveitam os
 * modais existentes. Registrar interação, adicionar nota e converter em cliente
 * são ações com permissão própria e entram junto com as demais ações de CRM.
 */
(async function () {
  const overlay = document.getElementById('detalhesProspeccaoOverlay');
  if (!overlay) return;

  async function fetchApi(path, options) {
    const baseUrl = await window.apiConfig.getApiBaseUrl();
    return fetch(`${baseUrl}${path}`, options);
  }

  // Popover (i) dos contatos — arquivo compartilhado com o formulário.
  if (!window.ProspeccaoContatoPopup) {
    const s = document.createElement('script');
    s.src = '../js/modals/prospeccao-contato-popup.js';
    document.head.appendChild(s);
  }

  const close = () => Modal.close('detalhesProspeccao');
  const get = id => document.getElementById(id);

  // Lista desenhada na aba Contatos; os handlers de editar/remover
  // trabalham por índice sobre ela.
  let contatosNaTela = [];

  // Listas desenhadas nas abas. Os botões de editar recuperam o registro
  // INTEIRO daqui pelo id — remontar a partir do texto da tela devolveria o
  // valor já formatado, não o original.
  const naTela = { interacoes: [], notas: [], campanhas: [] };

  document.getElementById('voltarDetalhesProspeccao')?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e) {
    if (e.key !== 'Escape') return;
    close();
    document.removeEventListener('keydown', esc);
  });

  // -------------------------------------------------------------------------
  // Utilidades de desenho
  // -------------------------------------------------------------------------

  /** Escapa antes de ir para innerHTML — tudo aqui é texto digitado por gente. */
  function esc(v) {
    if (v === null || v === undefined) return '';
    return String(v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  const VAZIO = '<span class="text-white/40">—</span>';

  const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  const formatarMoeda = v => moeda.format(Number.isFinite(Number(v)) ? Number(v) : 0);

  /** Instante (TIMESTAMPTZ): `new Date` é o certo aqui. */
  function formatarData(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('pt-BR');
  }

  /**
   * Coluna DATE — dia sem hora, como `proximo_passo_data` e `data_envio`.
   *
   * `new Date('2026-09-20')` é meia-noite UTC por norma; a oeste de Greenwich
   * isso vira o dia ANTERIOR na exibição. O passo marcado para 20/09 aparecia
   * como 19/09. Montamos o dia campo a campo, no fuso local.
   */
  function formatarDia(valor) {
    if (!valor) return '';
    const [ano, mes, dia] = String(valor).slice(0, 10).split('-').map(Number);
    if (!ano || !mes || !dia) return '';
    return new Date(ano, mes - 1, dia).toLocaleDateString('pt-BR');
  }

  function formatarDataHora(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
  }

  /** "há 3 dias" — mais legível numa timeline que a data absoluta. */
  function tempoRelativo(iso) {
    if (!iso) return '';
    const alvo = new Date(iso).getTime();
    if (Number.isNaN(alvo)) return '';
    const minutos = Math.round((Date.now() - alvo) / 60000);
    if (minutos < 1) return 'agora';
    if (minutos < 60) return `há ${minutos} min`;
    const horas = Math.round(minutos / 60);
    if (horas < 24) return `há ${horas} h`;
    const dias = Math.round(horas / 24);
    if (dias < 30) return `há ${dias} ${dias === 1 ? 'dia' : 'dias'}`;
    const meses = Math.round(dias / 30);
    if (meses < 12) return `há ${meses} ${meses === 1 ? 'mês' : 'meses'}`;
    return formatarData(iso);
  }

  function slugEtapa(etapa) {
    return String(etapa || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z]/g, '');
  }

  const campo = (rotulo, valorHtml) => `
    <div>
      <label class="block text-sm text-gray-400 mb-1">${esc(rotulo)}</label>
      <div class="text-white break-words">${valorHtml || VAZIO}</div>
    </div>`;

  const texto = v => (v === null || v === undefined || String(v).trim() === '' ? null : esc(v));

  function estadoVazio(mensagem) {
    return `<p class="py-8 text-center text-white/50 text-sm">${esc(mensagem)}</p>`;
  }

  /** Ícone por tipo de interação — a timeline fica legível de relance. */
  const ICONE_INTERACAO = {
    'Ligação': '📞', 'E-mail': '📧', 'Reunião': '🤝',
    'WhatsApp': '💬', 'Visita': '🏢', 'Nota': '📝', 'Proposta': '📄',
    'Atividade realizada': '✅'
  };

  // -------------------------------------------------------------------------
  // Abas
  // -------------------------------------------------------------------------
  /**
   * A aba ativa é indicada só por `aria-selected`; o estilo vem do CSS
   * (`.modal-prospeccao__abas [role="tab"][aria-selected="true"]`). Antes o
   * visual dependia de alternar classes utilitárias na mão, e o estado
   * acessível e o visual podiam divergir.
   */
  function setTab(id) {
    overlay.querySelectorAll('[data-panel]').forEach(p => p.classList.toggle('hidden', p.dataset.panel !== id));
    overlay.querySelectorAll('[role="tab"]').forEach(t => {
      t.setAttribute('aria-selected', String(t.dataset.tab === id));
    });
    // O corpo rola por inteiro; ao trocar de aba, volta ao topo. Sem isso a
    // aba nova abria no meio, na altura em que a anterior estava rolada.
    overlay.querySelector('.modal-prospeccao__corpo')?.scrollTo({ top: 0 });
  }

  overlay.querySelectorAll('[role="tab"]').forEach(t => {
    t.addEventListener('click', () => setTab(t.dataset.tab));
  });

  overlay.addEventListener('keydown', e => {
    if (e.target.getAttribute?.('role') !== 'tab') return;
    const abas = Array.from(overlay.querySelectorAll('[role="tab"]'));
    const atual = abas.indexOf(e.target);
    let alvo;
    if (e.key === 'ArrowRight') alvo = atual < abas.length - 1 ? atual + 1 : 0;
    else if (e.key === 'ArrowLeft') alvo = atual > 0 ? atual - 1 : abas.length - 1;
    else return;
    e.preventDefault();
    abas[alvo].focus();
    setTab(abas[alvo].dataset.tab);
  });

  setTab('visao');

  // -------------------------------------------------------------------------
  // Renderização de cada bloco
  // -------------------------------------------------------------------------

  function renderCabecalho(p) {
    const empresa = p.nome_fantasia || p.razao_social || '(sem nome)';
    get('detProspNome').textContent = empresa;
    get('detProspEmpresa').textContent = empresa;
    get('detProspSegmento').textContent = p.segmento || 'Segmento não informado';
    get('detProspIniciais').textContent = empresa.split(' ').filter(Boolean)
      .map(n => n[0]).join('').slice(0, 2).toUpperCase();

    const partes = [p.razao_social, p.cnpj].filter(Boolean);
    if (p.status === 'arquivada') partes.push('Arquivada');
    get('detProspSubtitulo').textContent = partes.join(' · ');
  }

  function renderMetricas(p) {
    // Sem `backdrop-blur` e sem `h-[76px]`: o desfoque em cima de conteúdo já
    // desfocado pelo diálogo era parte do aspecto "baixa resolução", e a altura
    // arbitrária do Tailwind não existe no build offline do projeto.
    const bloco = (rotulo, conteudo) => `
      <div class="metrica-prospeccao">
        <span class="metrica-prospeccao__rotulo">${esc(rotulo)}</span>
        <span class="metrica-prospeccao__valor">${conteudo}</span>
      </div>`;

    const etapaBadge = `<span class="badge-etapa badge-etapa--${slugEtapa(p.etapa)} px-2.5 py-1 rounded-full text-xs font-medium">${esc(p.etapa)}</span>`;

    // Valor ponderado pela probabilidade: é a previsão realista deste negócio.
    const ponderado = Number(p.valor_estimado || 0) * (Number(p.probabilidade || 0) / 100);

    get('detProspMetricas').innerHTML = [
      bloco('Etapa', `<span class="mt-1 inline-flex">${etapaBadge}</span>`),
      bloco('Valor estimado', esc(formatarMoeda(p.valor_estimado))),
      bloco('Probabilidade', `${Number(p.probabilidade || 0)}% <span class="text-white/50 text-xs">(${esc(formatarMoeda(ponderado))})</span>`),
      bloco('Responsável', texto(p.responsavel) || VAZIO),
      bloco('Origem', texto(p.origem) || VAZIO),
      bloco('Atualizada', esc(formatarDataHora(p.atualizado_em)) || VAZIO)
    ].join('');
  }

  function renderOportunidade(p) {
    let proximoPasso = VAZIO;
    if (p.proximo_passo || p.proximo_passo_data) {
      const data = p.proximo_passo_data ? formatarDia(p.proximo_passo_data) : '';
      // Atrasado precisa saltar aos olhos: é a informação acionável da tela.
      const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
      const bruto = String(p.proximo_passo_data || '').slice(0, 10);
      const [a, m, d] = bruto.split('-').map(Number);
      const alvo = a && m && d ? new Date(a, m - 1, d) : null;
      const atrasado = alvo && alvo < hoje;
      proximoPasso = `${texto(p.proximo_passo) || ''}${data
        ? ` <span class="${atrasado ? 'prox-passo-atrasado' : 'text-white/60'}">(${esc(data)}${atrasado ? ' · atrasado' : ''})</span>`
        : ''}`;
    }

    const linhas = [
      campo('Etapa atual', `<span class="badge-etapa badge-etapa--${slugEtapa(p.etapa)} px-3 py-1 rounded-full text-sm font-medium">${esc(p.etapa)}</span>`),
      campo('Origem', texto(p.origem)),
      campo('Valor estimado', esc(formatarMoeda(p.valor_estimado))),
      campo('Probabilidade', `${Number(p.probabilidade || 0)}%`),
      campo('Responsável', texto(p.responsavel)),
      campo('Próximo passo', proximoPasso)
    ];

    if (p.motivo_perda) linhas.push(campo('Motivo da perda', texto(p.motivo_perda)));
    if (p.cliente_id) {
      linhas.push(campo('Convertida em cliente',
        `#${esc(p.cliente_id)}${p.convertida_em ? ` <span class="text-white/60">em ${esc(formatarData(p.convertida_em))}</span>` : ''}`));
    }

    get('detProspOportunidade').innerHTML = linhas.join('');
  }

  function renderEmpresa(p) {
    const site = texto(p.site)
      ? `<a href="${esc(p.site)}" data-external target="_blank" rel="noopener noreferrer" class="text-primary hover:text-primary-light">${esc(p.site)}</a>`
      : null;

    get('detProspEmpresaDados').innerHTML = [
      campo('Razão Social', texto(p.razao_social)),
      campo('Nome Fantasia', texto(p.nome_fantasia)),
      campo('CNPJ', texto(p.cnpj)),
      campo('Inscrição Estadual', texto(p.inscricao_estadual)),
      campo('Segmento', texto(p.segmento)),
      campo('Site', site),
      campo('Cadastrada por', texto(p.criado_por_nome)),
      campo('Cadastrada em', esc(formatarDataHora(p.criado_em)))
    ].join('');
  }

  function renderEndereco(p) {
    const e = p.endereco || {};
    const linha1 = [e.rua, e.numero].filter(Boolean).join(', ');
    const linha2 = [e.complemento, e.bairro].filter(Boolean).join(' - ');
    const linha3 = [[e.cidade, e.estado].filter(Boolean).join('/'), e.cep, e.pais]
      .filter(Boolean).join(' - ');
    const partes = [linha1, linha2, linha3].filter(Boolean);

    get('detProspEndereco').innerHTML = partes.length
      ? partes.map(l => `<p>${esc(l)}</p>`).join('')
      : estadoVazio('Endereço não informado');
  }

  function renderAnotacoes(p) {
    const card = get('detProspAnotacoesCard');
    if (!texto(p.anotacoes)) {
      card.classList.add('hidden');
      return;
    }
    card.classList.remove('hidden');
    // textContent: a anotação é texto livre e não deve virar marcação.
    get('detProspAnotacoes').textContent = p.anotacoes;
  }

  /**
   * Cargo e papel vivem no popover (i), não em colunas — assim os telefones
   * cabem inteiros e a tabela não precisa rolar na horizontal.
   */
  function renderContatos(contatos) {
    const alvo = get('detProspContatos');
    if (!contatos.length) {
      alvo.innerHTML = estadoVazio('Nenhum contato cadastrado nesta empresa');
      return;
    }

    const linhas = contatos.map((c, i) => {
      const email = texto(c.email)
        ? `<a href="mailto:${esc(c.email)}" class="text-primary hover:text-primary-light">${esc(c.email)}</a>`
        : VAZIO;
      return `
        <tr class="border-b border-white/5">
          <td class="px-4 py-3 text-sm text-white">
            <div class="flex items-center gap-2">
              <span>${esc(c.nome)}</span>
              <i class="info-icon" data-info-contato="${i}"></i>
            </div>
          </td>
          <td class="px-4 py-3 text-sm">${email}</td>
          <td class="px-4 py-3 text-sm text-white/80 celula-sem-quebra">${texto(c.telefone_celular) || VAZIO}</td>
          <td class="px-4 py-3 text-sm text-white/80 celula-sem-quebra">${texto(c.telefone_fixo) || VAZIO}</td>
          <td class="px-4 py-3 text-sm">
            <div class="flex items-center gap-2">
              <i data-perm="pros.contact.edit" class="fas fa-edit acao-tabela acao-tabela--editar" data-editar-contato="${i}" title="Editar contato"></i>
              <i data-perm="pros.contact.remove" class="fas fa-trash acao-tabela acao-tabela--excluir" data-remover-contato="${i}" title="Remover contato"></i>
            </div>
          </td>`;
    }).join('');

    alvo.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-white/10">
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Nome</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">E-mail</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Celular</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Tel. fixo</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Ações</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;

    // Guarda a lista para os handlers, que trabalham por índice.
    contatosNaTela = contatos;
    alvo.querySelectorAll('[data-info-contato]').forEach(icone => {
      window.ProspeccaoContatoPopup?.ligar(icone, contatos[Number(icone.dataset.infoContato)]);
    });
  }

  function renderInteracoes(interacoes) {
    const alvo = get('detProspInteracoes');
    if (!interacoes.length) {
      alvo.innerHTML = estadoVazio('Nenhuma interação registrada até agora');
      return;
    }

    naTela.interacoes = interacoes;
    alvo.innerHTML = interacoes.map(i => {
      const duracao = i.duracao_min ? ` • ${esc(i.duracao_min)} min` : '';
      const autor = texto(i.responsavel) ? ` • ${esc(i.responsavel)}` : '';
      return `
        <div class="timeline-item relative pl-12">
          <div class="timeline-marker absolute left-0 top-1 w-8 h-8 rounded-full flex items-center justify-center">
            ${ICONE_INTERACAO[i.tipo] || '📌'}
          </div>
          <div>
            <div class="flex justify-between items-start gap-3">
              <h4 class="font-semibold text-white">${esc(i.tipo)}${i.resumo ? ` — ${esc(i.resumo)}` : ''}</h4>
              <div class="flex items-center gap-2 flex-shrink-0">
                <i data-perm="pros.interaction.add" class="fas fa-edit acao-tabela acao-tabela--editar"
                   data-editar="interacao" data-id="${esc(i.id)}" title="Editar atividade"></i>
                <i data-perm="pros.interaction.add" class="fas fa-trash acao-tabela acao-tabela--excluir"
                   data-remover="interacao" data-id="${esc(i.id)}"
                   data-rotulo="${esc(i.resumo || i.tipo)}" title="Excluir atividade"></i>
              </div>
            </div>
            <p class="text-sm text-gray-400 mb-2">${esc(formatarDataHora(i.data))} <span class="text-white/40">(${esc(tempoRelativo(i.data))})</span>${duracao}${autor}</p>
            ${texto(i.detalhe) ? `<p class="text-gray-300 whitespace-pre-wrap">${esc(i.detalhe)}</p>` : ''}
          </div>
        </div>`;
    }).join('');
  }

  function renderNotas(notas) {
    const alvo = get('detProspNotas');
    if (!notas.length) {
      alvo.innerHTML = estadoVazio('Nenhuma nota registrada');
      return;
    }
    naTela.notas = notas;
    alvo.innerHTML = notas.map(n => `
      <div class="bg-surface/40 rounded-lg p-4 border border-white/5">
        <div class="flex justify-between items-start gap-3 mb-2">
          ${texto(n.titulo) ? `<h4 class="font-medium text-white">${esc(n.titulo)}</h4>` : '<span></span>'}
          <div class="flex items-center gap-2 flex-shrink-0">
          <i data-perm="pros.note.add" class="fas fa-edit acao-tabela acao-tabela--editar"
             data-editar="nota" data-id="${esc(n.id)}" title="Editar nota"></i>
          <button type="button" data-remover="nota" data-id="${esc(n.id)}" data-perm="pros.note.remove"
                  data-rotulo="${esc(texto(n.titulo) ? n.titulo : 'sem título')}"
                  class="acao-tabela acao-tabela--excluir" title="Remover nota">
            <i class="fas fa-trash pointer-events-none"></i>
          </button>
          </div>
        </div>
        <p class="text-gray-300 text-sm mb-2 whitespace-pre-wrap">${esc(n.conteudo)}</p>
        <p class="text-xs text-gray-500">${texto(n.autor) ? esc(n.autor) + ' • ' : ''}${esc(tempoRelativo(n.criado_em))}</p>
      </div>`).join('');
  }

  function renderAnexos(anexos) {
    const alvo = get('detProspAnexos');
    if (!anexos.length) {
      alvo.innerHTML = estadoVazio('Nenhum anexo');
      return;
    }
    const tamanho = bytes => {
      const n = Number(bytes);
      if (!Number.isFinite(n) || n <= 0) return '';
      if (n < 1024) return `${n} B`;
      if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
      return `${(n / 1024 / 1024).toFixed(1)} MB`;
    };
    alvo.innerHTML = anexos.map(a => `
      <div class="flex items-center justify-between gap-4 py-3 border-b border-white/5">
        <div class="flex items-center gap-3 min-w-0">
          <i class="fas fa-paperclip text-white/40"></i>
          <span class="text-white truncate">${esc(a.nome_arquivo)}</span>
        </div>
        <span class="text-xs text-white/50 flex-shrink-0">${esc(tamanho(a.tamanho_bytes))} ${esc(formatarData(a.criado_em))}</span>
      </div>`).join('');
  }

  function renderCampanhas(campanhas) {
    naTela.campanhas = campanhas;
    const alvo = get('detProspCampanhas');
    if (!campanhas.length) {
      alvo.innerHTML = estadoVazio('Nenhuma campanha registrada');
      return;
    }
    const classeStatus = {
      'Concluída': 'badge-success', 'Em andamento': 'badge-warning',
      'Planejada': 'badge-info', 'Cancelada': 'badge-danger'
    };
    const linhas = campanhas.map(c => `
      <tr class="border-b border-white/5">
        <td class="px-4 py-3 text-sm text-white">${esc(c.nome)}</td>
        <td class="px-4 py-3 text-sm text-white/80">${texto(c.canal) || VAZIO}</td>
        <td class="px-4 py-3 text-sm"><span class="${classeStatus[c.status] || 'badge-neutral'} px-2 py-1 rounded text-xs">${esc(c.status)}</span></td>
        <td class="px-4 py-3 text-sm text-white/80">${esc(formatarDia(c.data_envio)) || VAZIO}</td>
        <td class="px-4 py-3 text-sm text-white/80">${texto(c.resposta) || VAZIO}</td>
        <td class="px-4 py-3 text-sm">
          <div class="flex items-center gap-2">
            <i data-perm="pros.campaign.manage" class="fas fa-edit acao-tabela acao-tabela--editar"
               data-editar="campanha" data-id="${esc(c.id)}" title="Editar campanha"></i>
            <button type="button" data-remover="campanha" data-id="${esc(c.id)}" data-perm="pros.campaign.manage"
                    data-rotulo="${esc(c.nome)}"
                    class="acao-tabela acao-tabela--excluir" title="Remover campanha">
              <i class="fas fa-trash pointer-events-none"></i>
            </button>
          </div>
        </td>
      </tr>`).join('');

    alvo.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-white/10">
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Campanha</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Canal</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Status</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Envio</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Resposta</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Ações</th>
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;
  }

  /** Mesmas cores de situação do módulo de Orçamentos — a leitura é a mesma. */
  const SITUACAO_ORCAMENTO = {
    'Rascunho': 'badge-info',
    'Pendente': 'badge-warning',
    'Enviado': 'badge-warning',
    'Aprovado': 'badge-success',
    'Rejeitado': 'badge-danger',
    'Expirado': 'badge-neutral'
  };

  function renderOrcamentos(orcamentos) {
    const alvo = get('detProspOrcamentos');
    if (!orcamentos.length) {
      alvo.innerHTML = estadoVazio('Nenhum orçamento emitido para esta prospecção');
      return;
    }

    const total = orcamentos
      .filter(o => o.situacao !== 'Rejeitado' && o.situacao !== 'Expirado')
      .reduce((soma, o) => soma + (Number(o.valor_final) || 0), 0);

    alvo.innerHTML = `
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-white/10">
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Número</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Emissão</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Situação</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Valor</th>
              <th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Ações</th>
            </tr>
          </thead>
          <tbody>
            ${orcamentos.map(o => `
              <tr class="border-b border-white/5">
                <td class="px-4 py-3 text-sm text-white font-medium popup-info-value--inteiro">${esc(o.numero)}</td>
                <td class="px-4 py-3 text-sm text-white/80 popup-info-value--inteiro">${esc(formatarData(o.data_emissao))}</td>
                <td class="px-4 py-3">
                  <span class="${SITUACAO_ORCAMENTO[o.situacao] || 'badge-neutral'} px-3 py-1 rounded-full text-xs font-medium">${esc(texto(o.situacao) || '—')}</span>
                </td>
                <td class="px-4 py-3 text-sm text-white popup-info-value--inteiro">${esc(formatarMoeda(o.valor_final))}</td>
                <td class="px-4 py-3">
                  <i class="fas fa-eye acao-tabela acao-tabela--ver acao-ver-orcamento" data-orcamento="${esc(o.id)}" title="Ver orçamento"></i>
                </td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <p class="text-sm text-white/70 mt-4">
        Em aberto: <strong class="text-white popup-info-value--inteiro">${esc(formatarMoeda(total))}</strong>
        <span class="text-xs text-gray-400 ml-1">(exclui rejeitados e expirados)</span>
      </p>`;

    alvo.querySelectorAll('.acao-ver-orcamento').forEach(icone => {
      icone.addEventListener('click', () => {
        window.selectedQuoteId = Number(icone.dataset.orcamento);
        abrirModalOrcamento('visualizar.html', 'orcamento-visualizar.js', 'visualizarOrcamento');
      });
    });
  }

  /** Rótulo e cor por tipo de evento do histórico. */
  const EVENTO = {
    criacao: { rotulo: 'Cadastro', classe: 'badge-info' },
    etapa: { rotulo: 'Funil', classe: 'badge-warning' },
    campo: { rotulo: 'Edição', classe: 'badge-neutral' },
    contato: { rotulo: 'Contato', classe: 'badge-info' },
    nota: { rotulo: 'Nota', classe: 'badge-neutral' },
    campanha: { rotulo: 'Campanha', classe: 'badge-neutral' },
    interacao: { rotulo: 'Interação', classe: 'badge-info' },
    anexo: { rotulo: 'Anexo', classe: 'badge-neutral' },
    orcamento: { rotulo: 'Orçamento', classe: 'badge-warning' },
    conversao: { rotulo: 'Conversão', classe: 'badge-success' },
    arquivamento: { rotulo: 'Situação', classe: 'badge-warning' },
    responsavel: { rotulo: 'Responsável', classe: 'badge-info' }
  };

  const ACAO = {
    criou: 'Criou', alterou: 'Alterou', excluiu: 'Excluiu',
    moveu: 'Moveu', converteu: 'Converteu'
  };

  /**
   * Histórico completo, não só movimentação de funil.
   *
   * Cada linha mostra o par anterior → novo. Em exclusões só existe o anterior,
   * e é justamente isso que responde "o que era antes de apagarem".
   */
  function renderHistorico(historico) {
    const alvo = get('detProspHistorico');
    if (!historico.length) {
      alvo.innerHTML = estadoVazio('Nenhum evento registrado');
      return;
    }

    // Só o Sup Admin apaga histórico — e o backend confere de novo.
    const podeExcluir = Boolean(window.Permissoes?.supAdmin);

    const valor = (v, classe) => texto(v)
      ? `<span class="${classe}">${esc(v)}</span>`
      : '<span class="text-white/30">—</span>';

    const linhas = historico.map(h => {
      const meta = EVENTO[h.tipo] || { rotulo: h.tipo, classe: 'badge-neutral' };
      const excluido = h.acao === 'excluiu';
      return `
      <tr class="border-b border-white/5">
        <td data-perm-col="col_hist_data" class="px-4 py-3 text-sm text-white/80 whitespace-nowrap align-top">
          ${esc(formatarDataHora(h.criado_em))}
        </td>
        <td data-perm-col="col_hist_tipo" class="px-4 py-3 text-sm align-top whitespace-nowrap">
          <span class="${meta.classe} px-2 py-1 rounded text-xs">${esc(meta.rotulo)}</span>
          <span class="block text-xs text-white/50 mt-1">${esc(ACAO[h.acao] || h.acao)}</span>
        </td>
        <td data-perm-col="col_hist_resumo" class="px-4 py-3 text-sm align-top">
          <div class="text-white">${esc(h.entidade || '')}</div>
          ${(h.valor_anterior || h.valor_novo) ? `
            <div class="mt-1 text-xs flex flex-wrap items-center gap-2">
              ${valor(h.valor_anterior, excluido ? 'prox-passo-atrasado line-through' : 'text-white/50 line-through')}
              ${!excluido ? '<span class="text-white/30">→</span>' + valor(h.valor_novo, 'text-white') : ''}
            </div>` : ''}
          ${texto(h.observacao) ? `<div class="mt-1 text-xs text-white/50">${esc(h.observacao)}</div>` : ''}
        </td>
        <td data-perm-col="col_hist_resp" class="px-4 py-3 text-sm text-white/80 align-top whitespace-nowrap">
          ${texto(h.responsavel) || VAZIO}
        </td>
        ${podeExcluir ? `
        <td class="px-4 py-3 text-sm align-top">
          <i class="fas fa-trash acao-tabela acao-tabela--excluir" data-remover="historico"
             data-id="${esc(h.id)}" data-rotulo="${esc(h.entidade || meta.rotulo)}"
             title="Excluir evento (Sup Admin)"></i>
        </td>` : ''}
      </tr>`;
    }).join('');

    alvo.innerHTML = `
      <p class="text-xs text-white/50 mb-3">
        Todo evento da prospecção fica registrado aqui, com o valor anterior.
        ${podeExcluir ? 'Como Sup Admin, você pode remover eventos.' : 'Os eventos não podem ser removidos.'}
      </p>
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b border-white/10">
              <th data-perm-col="col_hist_data" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Data</th>
              <th data-perm-col="col_hist_tipo" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Evento</th>
              <th data-perm-col="col_hist_resumo" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">O que mudou</th>
              <th data-perm-col="col_hist_resp" class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Quem</th>
              ${podeExcluir ? '<th class="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Ações</th>' : ''}
            </tr>
          </thead>
          <tbody>${linhas}</tbody>
        </table>
      </div>`;
  }

  function atualizarContadores(dados) {
    const contagens = {
      contatos: dados.contatos.length,
      interacoes: dados.interacoes.length,
      notas: dados.notas.length,
      campanhas: dados.campanhas.length,
      orcamentos: dados.orcamentos.length,
      historico: dados.historico.length
    };
    overlay.querySelectorAll('[data-contador]').forEach(el => {
      const n = contagens[el.dataset.contador];
      el.textContent = n ? `(${n})` : '';
    });
  }

  // -------------------------------------------------------------------------
  // Carregamento
  // -------------------------------------------------------------------------
  const resumo = window.prospeccaoDetalhes;

  // Sem devolver o contexto, o modal reabre vazio após uma queda.
  window.EstadoTrabalho?.registrarContexto?.('detalhesProspeccao',
    () => ({ prospeccaoDetalhes: resumo }));

  if (!resumo?.id) {
    showToast('Prospecção não encontrada', 'error');
    window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'detalhesProspeccao' }));
    return;
  }

  // Pinta o que já se sabe pela grade, para o modal nunca aparecer em branco
  // caso a requisição demore.
  renderCabecalho(resumo);

  /**
   * Busca e desenha a ficha inteira. Vive numa função porque as ações (mover no
   * funil, registrar interação, adicionar nota…) precisam repintar o modal sem
   * fechá-lo — ver `window.recarregarDetalhesProspeccao` abaixo.
   */
  async function carregar() {
    try {
      const resp = await fetchApi(`/api/prospeccoes/${resumo.id}`);
      if (resp.status === 403) throw new Error('Você não tem permissão para ver os detalhes desta prospecção.');
      if (!resp.ok) {
        const corpo = await resp.json().catch(() => ({}));
        throw new Error(corpo.error || `Erro ${resp.status}`);
      }

      const dados = await resp.json();
      const p = dados.prospeccao || {};
      const listas = {
        contatos: dados.contatos || [],
        interacoes: dados.interacoes || [],
        notas: dados.notas || [],
        campanhas: dados.campanhas || [],
        historico: dados.historico || [],
        anexos: dados.anexos || [],
        orcamentos: dados.orcamentos || []
      };

      renderCabecalho(p);
      renderMetricas(p);
      renderOportunidade(p);
      renderEmpresa(p);
      renderEndereco(p);
      renderAnotacoes(p);
      renderContatos(listas.contatos);
      renderInteracoes(listas.interacoes);
      renderNotas(listas.notas);
      renderAnexos(listas.anexos);
      renderCampanhas(listas.campanhas);
      renderOrcamentos(listas.orcamentos);
      renderHistorico(listas.historico);
      atualizarContadores(listas);
      refletirEstado(p);
      refletirPassoPlanejado(p);

      // A ficha completa e os contatos alimentam os modais de ação: a grade só
      // tem o resumo, e o de interação precisa da lista para oferecer "com quem"
      // (o backend recusa contato de outra prospecção).
      window.prospeccaoDetalhesCarregada = p;
      window.prospeccaoAcaoContatos = listas.contatos;

      // Links externos abrem no navegador do sistema, não dentro do Electron.
      overlay.querySelectorAll('a[data-external]').forEach(a => {
        a.addEventListener('click', e => {
          e.preventDefault();
          window.electronAPI?.openExternal?.(a.href);
        });
      });

      // Colunas do histórico respeitam col_hist_*; foram desenhadas agora.
      window.Permissoes?.aplicarAcoesEColunas?.(overlay);
    } catch (err) {
      console.error('Erro ao carregar detalhes da prospecção', err);
      showToast(err.message || 'Erro ao carregar detalhes', 'error');
    }
  }

  /**
   * Prospecção arquivada (ganha ou perdida) saiu do pipeline: mover no funil e
   * converter deixam de fazer sentido. Desabilitar é mais honesto que deixar o
   * botão clicável para o backend recusar depois.
   */
  function refletirEstado(p) {
    const desligar = (id, motivo) => {
      const b = get(id);
      if (!b) return;
      b.disabled = true;
      b.title = motivo;
      b.classList.add('opacity-40', 'cursor-not-allowed');
    };
    if (p.cliente_id) {
      desligar('detProspConverter', `Já convertida no cliente #${p.cliente_id}`);
      desligar('detProspExcluir', 'Prospecção convertida não pode ser excluída');
      // Quem já é cliente recebe orçamento ORC pelo módulo de Orçamentos. Abrir
      // outro OCRP aqui criaria uma proposta para uma oportunidade que já fechou.
      desligar('detProspNovoOrcamento',
        `Já é o cliente #${p.cliente_id} — emita o orçamento pelo módulo Orçamentos`);
    }
    if (p.status === 'arquivada' && p.etapa === 'Ganho' && !p.cliente_id) {
      // Ganho mas ainda sem cliente: converter continua sendo o caminho.
      return;
    }
  }

  /** Sem combinado em aberto não há o que concluir — o botão nem aparece. */
  function refletirPassoPlanejado(p) {
    get('detProspConcluirPasso')?.classList.toggle('hidden', !String(p.proximo_passo || '').trim());
  }

  await carregar();
  window.dispatchEvent(new CustomEvent('modalSpinnerLoaded', { detail: 'detalhesProspeccao' }));

  // Ponte usada pelos modais de ação, que abrem POR CIMA deste.
  window.recarregarDetalhesProspeccao = carregar;
  window.addEventListener('modal-ready', function limpar(e) {
    if (e.detail !== 'detalhesProspeccao') return;
    delete window.recarregarDetalhesProspeccao;
    delete window.prospeccaoAcaoContatos;
    delete window.prospeccaoAcaoAlvo;
    window.removeEventListener('modal-ready', limpar);
  });

  // -------------------------------------------------------------------------
  // Ações
  // -------------------------------------------------------------------------

  /** A ficha carregada é o alvo; o resumo da grade é o plano B. */
  const alvo = () => window.prospeccaoDetalhesCarregada || resumo;

  /** Abre um modal de ação por cima deste, sem fechá-lo. */
  function abrirAcao(html, script, overlayId) {
    window.prospeccaoAcaoAlvo = alvo();
    // Devolve a promessa: é ela que o BotaoAcao espera para liberar o botão.
    return Modal.open(`modals/prospeccoes/${html}`, `../js/modals/${script}`, overlayId, true);
  }

  /**
   * Liga um botão de ação com a proteção padrão do sistema: o segundo clique é
   * engolido enquanto o primeiro não termina, e o botão mostra carregando.
   *
   * A rede automática do BotaoAcao libera o botão rastreando promessas de
   * `window.electronAPI` — e este módulo fala por `fetch` com o backend local.
   * Sem o `bind` explícito, o bloqueio durava só a janela mínima e dois cliques
   * rápidos empilhavam dois modais.
   */
  function aoClicar(id, handler) {
    const el = get(id);
    if (!el) return;
    // O elemento vai por parâmetro: `evento.currentTarget` só vale durante o
    // despacho, e o BotaoAcao chama o handler de dentro da própria máquina.
    const acao = evento => handler(el, evento);
    if (window.BotaoAcao?.bind) window.BotaoAcao.bind(el, acao);
    else el.addEventListener('click', acao);
  }

  /**
   * Abre um modal do módulo de ORÇAMENTOS por cima desta ficha.
   *
   * Não basta chamar `Modal.open`: os overlays de orçamento nascem com a classe
   * `hidden` e quem a remove é o `openQuoteModal` do próprio módulo, ao ouvir
   * `orcamentoModalLoaded`. Chamado direto daqui, o modal carregava e ficava
   * invisível — era o "botão de visualizar não faz nada".
   *
   * O `openQuoteModal` original não serve porque começa com `Modal.closeAll()`,
   * que fecharia esta ficha. Aqui a ficha continua atrás (`keepExisting`).
   */
  function abrirModalOrcamento(html, script, overlayId) {
    // Devolve uma promessa que só resolve quando o modal aparece: é ela que
    // mantém o botão em "carregando" durante os segundos de carga.
    let concluir;
    const pronto = new Promise(r => { concluir = r; });
    const espera = document.createElement('div');
    espera.className = 'fixed inset-0 bg-black/50 flex items-center justify-center';
    espera.style.zIndex = 'var(--z-dialog)';
    espera.innerHTML = '<div class="app-loading-indicator app-loading-indicator--compact" aria-hidden="true"><span class="module-loading-orbit"></span><span class="module-loading-core"><img src="../assets/Logo.ico" alt=""></span></div>';
    document.body.appendChild(espera);

    let encerrado = false;
    const revelar = () => {
      if (encerrado) return;
      encerrado = true;
      clearTimeout(desistir);
      window.removeEventListener('orcamentoModalLoaded', aoCarregar);
      espera.remove();
      document.getElementById(`${overlayId}Overlay`)?.classList.remove('hidden');
      concluir();
    };

    function aoCarregar(e) {
      if (e.detail !== overlayId) return;
      revelar();
    }

    // Rede de segurança: o script do orçamento só anuncia o carregamento na
    // ÚLTIMA linha. Se ele quebrar antes, sem isto o usuário ficaria preso numa
    // máscara de espera eterna, sem modal e sem erro.
    const desistir = setTimeout(() => {
      if (encerrado) return;
      revelar();
      if (!document.getElementById(`${overlayId}Overlay`)) {
        showToast('Não foi possível abrir o orçamento', 'error');
      }
    }, 8000);

    window.addEventListener('orcamentoModalLoaded', aoCarregar);
    Modal.open(`modals/orcamentos/${html}`, `../js/modals/${script}`, overlayId, true);
    return pronto;
  }

  aoClicar('detProspMoverFunil', botao => {
    if (botao.disabled) return;
    return abrirAcao('etapa.html', 'prospeccao-etapa.js', 'etapaProspeccao');
  });

  aoClicar('detProspConverter', botao => {
    if (botao.disabled) return;
    return abrirAcao('converter.html', 'prospeccao-converter.js', 'converterProspeccao');
  });

  aoClicar('detProspProximoPasso', () => {
    return abrirAcao('proximo-passo.html', 'prospeccao-proximo-passo.js', 'proximoPassoProspeccao');
  });

  aoClicar('detProspConcluirPasso', () => {
    return abrirAcao('concluir-passo.html', 'prospeccao-concluir-passo.js', 'concluirPasso');
  });

  aoClicar('detProspNovaInteracao', () => {
    return abrirAcao('interacao.html', 'prospeccao-interacao.js', 'interacaoProspeccao');
  });

  aoClicar('detProspNovaNota', () => {
    return abrirAcao('nota.html', 'prospeccao-nota.js', 'notaProspeccao');
  });

  aoClicar('detProspNovaCampanha', () => {
    return abrirAcao('campanha.html', 'prospeccao-campanha.js', 'campanhaProspeccao');
  });

  // Abre a tela padrão de Novo Orçamento em "modo prospecção": mesmos itens,
  // descontos e parcelamento, só que a proposta é desta prospecção e ganha
  // numeração OCRP. Ver o bloco correspondente em orcamento-novo.js.
  aoClicar('detProspNovoOrcamento', () => {
    window.orcamentoProspeccao = alvo();
    return abrirModalOrcamento('novo.html', 'orcamento-novo.js', 'novoOrcamento');
  });

  // -------------------------------------------------------------------------
  // Novo contato pela aba Contatos
  //
  // Reaproveita o sub-modal do cadastro/edição, que só devolve o contato por
  // evento. Aqui ele precisa ser PERSISTIDO na hora — o backend recebe como
  // delta `contatosNovos`, exatamente como o modal de edição faz.
  // -------------------------------------------------------------------------
  aoClicar('detProspNovoContato', () => {
    delete window.prospeccaoContatoEditar;
    Modal.open('modals/prospeccoes/contato.html', '../js/modals/prospeccao-contato.js', 'contatoProspeccao', true);
  });

  /**
   * Grava o delta de contatos.
   *
   * O PUT precisa levar a ficha inteira: o backend regrava a prospecção com o
   * que recebe, e mandar só o delta apagaria os demais campos.
   */
  async function salvarDeltaContatos(delta, mensagem) {
    try {
      const resp = await fetchApi(`/api/prospeccoes/${resumo.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...(window.prospeccaoDetalhesCarregada || {}), ...delta })
      });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        showToast(corpo.error || 'Erro ao salvar contato', 'error');
        return;
      }
      await carregar();
      window.ProspeccoesModulo?.carregar?.(true);
      showToast(mensagem, 'success');
    } catch (err) {
      console.error('Erro ao salvar contato', err);
      showToast('Falha de comunicação com o servidor', 'error');
    }
  }

  /**
   * O sub-modal serve inclusão E edição. Aqui a distinção é o `id`: quem já
   * existe no banco vira `contatosAtualizados`, quem não existe vira
   * `contatosNovos`. (`indice` só aparece quando quem abriu é a lista em
   * memória do cadastro, nunca este modal.)
   */
  async function aoSalvarContato(evento) {
    const contato = evento.detail;
    if (!contato?.nome) return;
    // Véu de espera: o salvamento faz o PUT, repinta a ficha inteira e ainda
    // atualiza a grade atrás. Quem disparou foi o sub-modal do contato, que já
    // se fechou — não há botão nenhum para segurar o carregando.
    const gravar = contato.id
      ? () => salvarDeltaContatos({ contatosAtualizados: [contato] }, 'Contato atualizado')
      : () => salvarDeltaContatos({ contatosNovos: [contato] }, 'Contato adicionado');

    if (window.BotaoAcao?.comCarregamento) {
      await window.BotaoAcao.comCarregamento(gravar, 'Salvando o contato...');
    } else {
      await gravar();
    }
  }

  // Editar e remover contato, por delegação na aba.
  get('detProspContatos')?.addEventListener('click', async e => {
    const editar = e.target.closest('[data-editar-contato]');
    if (editar) {
      const c = contatosNaTela[Number(editar.dataset.editarContato)];
      if (!c) return;
      window.prospeccaoContatoEditar = { ...c };
      Modal.open('modals/prospeccoes/contato.html', '../js/modals/prospeccao-contato.js', 'contatoProspeccao', true);
      return;
    }
    const remover = e.target.closest('[data-remover-contato]');
    if (remover) {
      const c = contatosNaTela[Number(remover.dataset.removerContato)];
      if (!c?.id) return;
      const aviso = c.principal
        ? ' Ele é o contato principal — a prospecção ficará sem interlocutor padrão.'
        : '';
      await confirmarEExecutar({
        titulo: 'Excluir este contato?',
        mensagem: `${c.nome} será removido da prospecção.${aviso} O histórico guarda os dados dele.`,
        espera: 'Removendo o contato...',
        acao: () => salvarDeltaContatos({ contatosExcluidos: [c.id] }, 'Contato removido')
      });
    }
  });

  window.addEventListener('prospeccaoContatoSalvo', aoSalvarContato);
  // Sem remover, o ouvinte sobrevive ao modal e uma segunda ficha receberia o
  // contato cadastrado na primeira.
  window.addEventListener('modal-ready', function soltar(e) {
    if (e.detail !== 'detalhesProspeccao') return;
    window.removeEventListener('prospeccaoContatoSalvo', aoSalvarContato);
    window.removeEventListener('modal-ready', soltar);
  });

  // `window.ProspeccoesModulo` é o contrato publicado por prospeccoes.js.
  // Chamar `abrirEditarProspeccao` pelo nome NÃO funciona: menu.js injeta o
  // script do módulo dentro de uma IIFE, e estes <script> de modal ficam fora
  // desse escopo.
  aoClicar('detProspEditar', () => {
    const abrir = window.ProspeccoesModulo?.abrirEditar;
    if (!abrir) {
      showToast('Não foi possível abrir a edição', 'error');
      return;
    }
    const registro = alvo();
    close();
    abrir(registro);
  });

  aoClicar('detProspExcluir', e => {
    if (e.currentTarget.disabled) return;
    const abrir = window.ProspeccoesModulo?.abrirExcluir;
    if (!abrir) {
      showToast('Não foi possível abrir a exclusão', 'error');
      return;
    }
    const registro = alvo();
    close();
    abrir(registro);
  });

  // -------------------------------------------------------------------------
  // Exclusão de nota, campanha e evento do histórico
  //
  // Toda exclusão passa pela caixa de diálogo padrão do sistema. Antes a
  // lixeira apagava no primeiro clique, sem pergunta — e nenhuma delas tem
  // desfazer.
  //
  // O carregamento vem do `comCarregamento`, e não do botão: quando o usuário
  // confirma, o diálogo já fechou e a lixeira original não existe mais na tela
  // (a lista é repintada). Sem o véu, a espera ficaria muda.
  // -------------------------------------------------------------------------
  async function removerFilho(rota, id, mensagem) {
    try {
      const resp = await fetchApi(`/api/prospeccoes/${resumo.id}/${rota}/${id}`, { method: 'DELETE' });
      const corpo = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        showToast(corpo.error || `Erro ${resp.status}`, 'error');
        return;
      }
      await carregar();
      showToast(mensagem, 'success');
    } catch (err) {
      console.error('Erro ao remover', err);
      showToast('Falha de comunicação com o servidor', 'error');
    }
  }

  /** Pergunta antes e, se confirmado, executa sob o véu de carregamento. */
  async function confirmarEExecutar({ titulo, mensagem, confirmar = 'Excluir', espera, acao }) {
    const ok = await window.DialogPadrao?.confirm({
      title: titulo,
      message: mensagem,
      confirmText: confirmar
    });
    if (!ok) return;
    if (window.BotaoAcao?.comCarregamento) {
      await window.BotaoAcao.comCarregamento(acao, espera);
    } else {
      await acao();
    }
  }

  const COMO_EXCLUIR = {
    nota: {
      rota: 'notas', titulo: 'Excluir esta nota?',
      texto: rotulo => `A nota "${rotulo}" será removida da ficha. O histórico guarda o que ela dizia.`,
      espera: 'Removendo a nota...', sucesso: 'Nota removida'
    },
    campanha: {
      rota: 'campanhas', titulo: 'Excluir esta campanha?',
      texto: rotulo => `A campanha "${rotulo}" sai da lista, mas continua detalhada no histórico.`,
      espera: 'Removendo a campanha...', sucesso: 'Campanha removida'
    },
    interacao: {
      rota: 'interacoes', titulo: 'Excluir esta atividade?',
      texto: rotulo => `"${rotulo}" sai da timeline. O histórico guarda o registro inteiro.`,
      espera: 'Removendo a atividade...', sucesso: 'Atividade removida'
    },
    historico: {
      rota: 'historico', titulo: 'Apagar este evento do histórico?',
      // O histórico é o registro de tudo o mais; apagar aqui não deixa rastro
      // em lugar nenhum. Por isso o aviso é mais duro que o dos outros.
      texto: rotulo => `"${rotulo}" será apagado definitivamente. O histórico é o único registro deste fato — não há como recuperá-lo.`,
      confirmar: 'Apagar definitivamente',
      espera: 'Apagando o evento...', sucesso: 'Evento removido do histórico'
    }
  };

  /**
   * Editar nota, atividade ou campanha.
   *
   * Reabre o MESMO modal do cadastro, em modo edição — o registro completo vem
   * da lista carregada, não do texto da tela, que já está formatado.
   */
  const COMO_EDITAR = {
    nota: { lista: 'notas', global: 'prospeccaoNotaEditar', html: 'nota.html', script: 'prospeccao-nota.js', overlay: 'notaProspeccao' },
    interacao: { lista: 'interacoes', global: 'prospeccaoInteracaoEditar', html: 'interacao.html', script: 'prospeccao-interacao.js', overlay: 'interacaoProspeccao' },
    campanha: { lista: 'campanhas', global: 'prospeccaoCampanhaEditar', html: 'campanha.html', script: 'prospeccao-campanha.js', overlay: 'campanhaProspeccao' }
  };

  overlay.addEventListener('click', e => {
    const editar = e.target.closest?.('[data-editar]');
    if (!editar) return;
    e.preventDefault();
    const como = COMO_EDITAR[editar.dataset.editar];
    if (!como) return;

    const registro = (naTela[como.lista] || []).find(x => String(x.id) === String(editar.dataset.id));
    if (!registro) {
      showToast('Registro não encontrado — reabra a ficha', 'error');
      return;
    }
    window[como.global] = { ...registro };
    return abrirAcao(como.html, como.script, como.overlay);
  });

  overlay.addEventListener('click', e => {
    const remover = e.target.closest?.('[data-remover]');
    if (!remover) return;
    e.preventDefault();
    const { remover: tipo, id, rotulo } = remover.dataset;
    const como = COMO_EXCLUIR[tipo];
    if (!como) return;

    confirmarEExecutar({
      titulo: como.titulo,
      mensagem: como.texto(rotulo || 'sem título'),
      confirmar: como.confirmar,
      espera: como.espera,
      acao: () => removerFilho(como.rota, id, como.sucesso)
    });
  });
})();
