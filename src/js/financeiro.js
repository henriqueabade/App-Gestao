/**
 * Módulo Financeiro — Comissões e Produção.
 *
 * ETAPA VISUAL: a tela nasce completa, mas os números vêm de FIN_DADOS_EXEMPLO
 * e nenhuma ação grava nada. Quem ainda não tem função real abre o aviso
 * "em implementação" — melhor que um botão que não responde, que parece
 * defeito. Quando o backend existir, `finCarregarDados` passa a ler a rota e
 * o resto da tela não muda: tudo é preenchido por `data-fin`.
 *
 * O menu reexecuta este arquivo a cada visita (src/js/menu.js injeta o script
 * de novo, embrulhado numa IIFE), então nada aqui registra ouvinte em
 * `document`/`window`: os ouvintes ficam no elemento do módulo, que é trocado
 * a cada navegação, e a inicialização é guardada por `dataset.iniciado`.
 */

const FIN_MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

/* Dados de exemplo da descrição do módulo. Um único objeto, no formato que a
   rota do backend deverá devolver. */
const FIN_DADOS_EXEMPLO = {
    kpis: {
        nf: { quantidade: 8, total: 124680 },
        comissoes: { valor: 18450, parcelas: 12, pagamentoAte: '2026-10-15' },
        atrasadas: { valor: 7320, parcelas: 11 },
        producao: { valor: 9870, pecas: 327 }
    },
    pendencias: [
        { nivel: 'critico', titulo: '3 parcelas estão vencidas há mais de 30 dias',
          descricao: 'Comissão potencial: R$ 4.280,00', data: '2026-09-14', acao: 'Ver', destino: 'comissoes-atrasadas' },
        { nivel: 'normal', titulo: 'Competência setembro/2026 pronta para fechamento',
          descricao: 'Comissão apurada: R$ 18.450,00', data: '2026-09-15', acao: 'Conferir', destino: 'fechar-competencia' },
        { nivel: 'normal', titulo: '8 pedidos entregues ainda sem NF registrada',
          descricao: 'Total: R$ 124.680,00', data: '2026-09-15', acao: 'Ver', destino: 'aguardando-nf' },
        { nivel: 'normal', titulo: 'Produção de setembro pronta para fechamento',
          descricao: '327 peças finalizadas • R$ 9.870,00', data: '2026-09-15', acao: 'Conferir', destino: 'producao-competencia' },
        { nivel: 'normal', titulo: 'Ajuste de R$ 840,00 aguardando estorno',
          descricao: 'Pedido 2501 • devolução registrada em 10/09', data: '2026-09-10', acao: 'Ver', destino: 'comissoes-detalhes' }
    ],
    resumoComissoes: { previstas: 32500, apuradas: 18450, atrasadas: 7320, ajustes: -840, proximoPagamento: '2026-10-15' },
    resumoProducao: { emProducao: 21, parciais: 8, pecasMes: 327, valorCompetencia: 9870, proximoPagamento: '5º dia útil de outubro' },
    atividade: [
        { hora: '14:32', titulo: 'NF 18842 registrada', detalhe: 'Pedido 2548' },
        { hora: '13:18', titulo: 'Parcela liquidada', detalhe: 'Pedido 2521 • R$ 12.450,00' },
        { hora: '11:07', titulo: '6 peças finalizadas', detalhe: 'Pedido 2537' },
        { hora: '09:41', titulo: 'Ajuste registrado', detalhe: 'Pedido 2501 • - R$ 840,00' }
    ]
};

/* Rótulo humano de cada ação, para o aviso "em implementação". Quando a ação
   ganhar modal/função real, basta preencher `abrir`. */
const FIN_ACOES = {
    'atualizar': { rotulo: 'Atualizar' },
    'aguardando-nf': { rotulo: 'Pedidos aguardando NF' },
    'comissoes-competencia': { rotulo: 'Comissões da competência' },
    'comissoes-atrasadas': { rotulo: 'Comissões atrasadas' },
    'producao-competencia': { rotulo: 'Produção da competência' },
    'pendencias-todas': { rotulo: 'Todas as pendências' },
    'registrar-nf': { rotulo: 'Registrar NF' },
    'registrar-recebimento': { rotulo: 'Registrar recebimento' },
    'registrar-ajuste': { rotulo: 'Registrar ajuste' },
    'registrar-producao': { rotulo: 'Registrar produção' },
    'fechar-competencia': { rotulo: 'Fechar competência' },
    'relatorios': { rotulo: 'Relatórios' },
    'comissoes-detalhes': { rotulo: 'Detalhes das comissões' },
    'atividade-todas': { rotulo: 'Atividade recente' }
};

const finFormatoMoeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

function finFormatarMoeda(valor) {
    // Ausente é "—", não "R$ 0,00": zero de verdade e valor que não veio são
    // coisas diferentes para quem confere comissão.
    if (valor === null || valor === undefined || valor === '') return '—';
    const numero = Number(valor);
    if (!Number.isFinite(numero)) return '—';
    // "- R$ 840,00" como na descrição: o sinal antes do símbolo, e não colado ao número.
    return numero < 0 ? `- ${finFormatoMoeda.format(Math.abs(numero))}` : finFormatoMoeda.format(numero);
}

function finFormatarInteiro(valor) {
    if (valor === null || valor === undefined || valor === '') return '—';
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero.toLocaleString('pt-BR') : '—';
}

/** 'YYYY-MM-DD' -> 'dd/mm/aaaa', cortando o texto: passar por new Date volta um dia em São Paulo. */
function finFormatarData(texto) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(texto || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : (texto || '—');
}

function finRotuloCompetencia(ano, mes) {
    return `${FIN_MESES[mes - 1]} / ${ano}`;
}

/** Competências de 12 meses atrás até 3 à frente, com a atual selecionada. */
function finMontarCompetencias(select, hoje) {
    if (!select) return;
    select.replaceChildren();
    const ano = hoje.getFullYear();
    const mes = hoje.getMonth() + 1;
    for (let desloca = -12; desloca <= 3; desloca++) {
        const total = ano * 12 + (mes - 1) + desloca;
        const a = Math.floor(total / 12);
        const m = (total % 12) + 1;
        const opcao = document.createElement('option');
        opcao.value = `${a}-${String(m).padStart(2, '0')}`;
        opcao.textContent = finRotuloCompetencia(a, m);
        if (desloca === 0) opcao.selected = true;
        select.appendChild(opcao);
    }
}

function finCompetenciaAtual(hoje) {
    return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

function finAvisarEmImplementacao(chave) {
    const rotulo = FIN_ACOES[chave]?.rotulo || 'Esta função';
    const mensagem = `"${rotulo}" ainda está em implementação.\nEm breve estará disponível nesta tela.`;
    if (window.DialogPadrao?.info) {
        window.DialogPadrao.info({ title: 'Função em implementação', message: mensagem });
    } else {
        window.alert(mensagem);
    }
}

function finExecutarAcao(chave, moduleEl) {
    const acao = FIN_ACOES[chave];
    if (acao && typeof acao.abrir === 'function') {
        acao.abrir(moduleEl);
        return;
    }
    finAvisarEmImplementacao(chave);
}

/* ------------------------------------------------------------- render */

function finCriar(tag, classe, texto) {
    const el = document.createElement(tag);
    if (classe) el.className = classe;
    if (texto != null) el.textContent = texto;
    return el;
}

function finPreencher(moduleEl, caminho, texto) {
    const alvo = moduleEl.querySelector(`[data-fin="${caminho}"]`);
    if (alvo) alvo.textContent = texto;
}

function finRenderizarKpis(moduleEl, kpis) {
    const { nf, comissoes, atrasadas, producao } = kpis;
    finPreencher(moduleEl, 'nf.valor', finFormatarInteiro(nf.quantidade));
    finPreencher(moduleEl, 'nf.auxiliar', nf.quantidade === 1 ? 'pedido' : 'pedidos');
    finPreencher(moduleEl, 'nf.rodape', `Total: ${finFormatarMoeda(nf.total)}`);

    finPreencher(moduleEl, 'comissoes.valor', finFormatarMoeda(comissoes.valor));
    finPreencher(moduleEl, 'comissoes.auxiliar', `${finFormatarInteiro(comissoes.parcelas)} parcelas`);
    finPreencher(moduleEl, 'comissoes.rodape', `Pagamento até ${finFormatarData(comissoes.pagamentoAte)}`);

    finPreencher(moduleEl, 'atrasadas.valor', finFormatarMoeda(atrasadas.valor));
    finPreencher(moduleEl, 'atrasadas.auxiliar', `${finFormatarInteiro(atrasadas.parcelas)} parcelas`);
    finPreencher(moduleEl, 'atrasadas.rodape', 'Aguardando recebimento');

    finPreencher(moduleEl, 'producao.valor', finFormatarMoeda(producao.valor));
    finPreencher(moduleEl, 'producao.auxiliar', `${finFormatarInteiro(producao.pecas)} peças finalizadas`);
    finPreencher(moduleEl, 'producao.rodape', 'Pagamento até o 5º dia útil');
}

function finRenderizarPendencias(moduleEl, pendencias) {
    const lista = moduleEl.querySelector('[data-fin-lista="pendencias"]');
    if (!lista) return;
    lista.replaceChildren();
    finPreencher(moduleEl, 'pendencias.total', String(pendencias.length));

    if (!pendencias.length) {
        lista.appendChild(finCriar('li', 'fin-vazio', 'Nenhuma pendência no momento. Tudo em dia por aqui.'));
        return;
    }

    for (const p of pendencias) {
        const item = finCriar('li', 'fin-pendencia');
        item.dataset.finAcao = p.destino;
        item.setAttribute('role', 'button');
        item.tabIndex = 0;

        const status = finCriar('span', 'fin-pendencia__status');
        status.dataset.nivel = p.nivel === 'critico' ? 'critico' : 'normal';

        const texto = finCriar('div', 'fin-pendencia__texto');
        texto.appendChild(finCriar('span', 'fin-pendencia__titulo', p.titulo));
        texto.appendChild(finCriar('span', 'fin-pendencia__descricao', p.descricao));

        const botao = finCriar('button', 'btn-neutral text-white rounded-md px-3 py-2 text-sm font-medium fin-pendencia__acao', p.acao);
        botao.type = 'button';
        botao.dataset.finAcao = p.destino;

        item.append(status, texto, finCriar('span', 'fin-pendencia__data', finFormatarData(p.data)), botao);
        lista.appendChild(item);
    }
}

function finRenderizarResumos(moduleEl, dados) {
    const c = dados.resumoComissoes;
    finPreencher(moduleEl, 'resumoComissoes.previstas', finFormatarMoeda(c.previstas));
    finPreencher(moduleEl, 'resumoComissoes.apuradas', finFormatarMoeda(c.apuradas));
    finPreencher(moduleEl, 'resumoComissoes.atrasadas', finFormatarMoeda(c.atrasadas));
    finPreencher(moduleEl, 'resumoComissoes.ajustes', finFormatarMoeda(c.ajustes));
    finPreencher(moduleEl, 'resumoComissoes.proximoPagamento', finFormatarData(c.proximoPagamento));

    const p = dados.resumoProducao;
    finPreencher(moduleEl, 'resumoProducao.emProducao', finFormatarInteiro(p.emProducao));
    finPreencher(moduleEl, 'resumoProducao.parciais', finFormatarInteiro(p.parciais));
    finPreencher(moduleEl, 'resumoProducao.pecasMes', finFormatarInteiro(p.pecasMes));
    finPreencher(moduleEl, 'resumoProducao.valorCompetencia', finFormatarMoeda(p.valorCompetencia));
    finPreencher(moduleEl, 'resumoProducao.proximoPagamento', p.proximoPagamento);
}

function finRenderizarAtividade(moduleEl, eventos) {
    const lista = moduleEl.querySelector('[data-fin-lista="atividade"]');
    if (!lista) return;
    lista.replaceChildren();
    if (!eventos.length) {
        lista.appendChild(finCriar('li', 'fin-vazio', 'Nenhuma atividade registrada hoje.'));
        return;
    }
    for (const e of eventos) {
        const item = finCriar('li', 'fin-evento');
        const texto = finCriar('div', 'fin-evento__texto');
        texto.appendChild(finCriar('span', 'fin-evento__titulo', e.titulo));
        texto.appendChild(finCriar('span', 'fin-evento__detalhe', e.detalhe));
        item.append(finCriar('span', 'fin-evento__hora', e.hora), texto);
        lista.appendChild(item);
    }
}

function finRenderizar(moduleEl, dados) {
    finRenderizarKpis(moduleEl, dados.kpis);
    finRenderizarPendencias(moduleEl, dados.pendencias);
    finRenderizarResumos(moduleEl, dados);
    finRenderizarAtividade(moduleEl, dados.atividade);
}

/** Nesta etapa devolve o exemplo; o backend entra aqui depois. */
async function finCarregarDados() {
    return FIN_DADOS_EXEMPLO;
}

/* --------------------------------------------------------------- init */

function finLigarAcoes(moduleEl) {
    // Um ouvinte só, por delegação: cartões, linhas de pendência, botões e
    // links trazem `data-fin-acao`. O botão dentro da linha vence a linha.
    const disparar = (evento) => {
        const alvo = evento.target.closest('[data-fin-acao]');
        if (!alvo || !moduleEl.contains(alvo)) return;
        evento.stopPropagation();
        finExecutarAcao(alvo.dataset.finAcao, moduleEl);
    };
    moduleEl.addEventListener('click', disparar);
    moduleEl.addEventListener('keydown', (evento) => {
        if (evento.key !== 'Enter' && evento.key !== ' ') return;
        const alvo = evento.target.closest('[data-fin-acao][role="button"]');
        if (!alvo) return;
        evento.preventDefault();
        finExecutarAcao(alvo.dataset.finAcao, moduleEl);
    });
}

function finIniciar(moduleEl) {
    if (moduleEl.dataset.iniciado === '1') return;
    moduleEl.dataset.iniciado = '1';

    const hoje = new Date();
    const select = moduleEl.querySelector('#finCompetencia');
    finMontarCompetencias(select, hoje);
    moduleEl.querySelector('#finHoje')?.addEventListener('click', () => {
        if (select) select.value = finCompetenciaAtual(hoje);
    });

    finLigarAcoes(moduleEl);

    // O menu espera esta promessa antes de tirar a máscara de carregamento.
    moduleEl.moduleReadyPromise = finCarregarDados()
        .then(dados => finRenderizar(moduleEl, dados))
        .catch(erro => {
            console.error('[financeiro] não foi possível montar a tela:', erro);
            window.showToast?.('Não foi possível carregar o Financeiro agora.', 'error');
        });
}

(function finBoot() {
    const moduleEl = document.querySelector('.modulo-container.financeiro-module');
    if (moduleEl) finIniciar(moduleEl);
})();
