// ---------------------------------------------------------------------------
// Preservação do trabalho em andamento (janela de 30 min).
//
// Ao perder a conexão / ser desconectado, guardamos onde o usuário estava e o
// que já havia preenchido. Ao voltar (login dentro de 30 min), restauramos.
//
// Antes, `window.collectState` era CHAMADO em três lugares mas nunca definido:
// as chamadas ficavam protegidas por `if (window.collectState && ...)` e, na
// prática, nada era salvo — a mensagem prometia algo que não acontecia.
// ---------------------------------------------------------------------------
(function () {
    const CHAVE_ESTADO = 'savedState';
    const CAMPOS = 'input, select, textarea';

    /** Identificador estável de um campo dentro do seu container. */
    function chaveDoCampo(el) {
        if (el.id) return `#${el.id}`;
        if (el.name) return `[name="${el.name}"]`;
        return null;
    }

    function ehCampoIgnorado(el) {
        if (!el || el.disabled) return true;
        const tipo = (el.type || '').toLowerCase();
        // nunca guardamos senha nem arquivo
        if (tipo === 'password' || tipo === 'file') return true;
        if (el.dataset?.noRestore === 'true') return true;
        return false;
    }

    function lerValor(el) {
        const tipo = (el.type || '').toLowerCase();
        if (tipo === 'checkbox' || tipo === 'radio') return el.checked;
        return el.value;
    }

    function aplicarValor(el, valor) {
        const tipo = (el.type || '').toLowerCase();
        if (tipo === 'checkbox' || tipo === 'radio') {
            el.checked = Boolean(valor);
        } else {
            el.value = valor ?? '';
        }
        // avisa listeners (máscaras, cálculos, validações)
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    /** Coleta os campos preenchidos de uma raiz. */
    function coletarCampos(raiz) {
        if (!raiz) return [];
        const out = [];
        raiz.querySelectorAll(CAMPOS).forEach(el => {
            if (ehCampoIgnorado(el)) return;
            const chave = chaveDoCampo(el);
            if (!chave) return;
            const valor = lerValor(el);
            const vazio = valor === '' || valor === null || valor === undefined || valor === false;
            if (vazio) return;                     // só guardamos o que foi preenchido
            out.push({ chave, valor });
        });
        return out;
    }

    /** Modal aberto no momento (se houver). */
    function modalAberto() {
        const overlays = Array.from(document.querySelectorAll('[id$="Overlay"]'));
        const visivel = overlays.find(o => o && !o.classList.contains('hidden'));
        if (!visivel) return null;
        return { overlayId: visivel.id, campos: coletarCampos(visivel) };
    }

    /**
     * Formato esperado pelo loginRenderer: { sectionId, storage, ... }
     */
    window.collectState = function collectState() {
        try {
            const content = document.getElementById('content');
            const sectionId = content?.dataset?.activePage || 'dashboard';
            return {
                sectionId,
                salvoEm: Date.now(),
                storage: { user: localStorage.getItem('user') || null },
                campos: coletarCampos(content),
                modal: modalAberto()
            };
        } catch (err) {
            console.error('[estado] falha ao coletar o estado atual:', err);
            return { sectionId: 'dashboard', storage: {} };
        }
    };

    /** Reaplica os campos guardados em uma raiz. */
    function restaurarCampos(raiz, campos) {
        if (!raiz || !Array.isArray(campos)) return 0;
        let aplicados = 0;
        campos.forEach(({ chave, valor }) => {
            let el = null;
            try { el = raiz.querySelector(chave); } catch (_) { el = null; }
            if (!el || ehCampoIgnorado(el)) return;
            aplicarValor(el, valor);
            aplicados++;
        });
        return aplicados;
    }

    function lerEstadoSalvo() {
        try {
            const bruto = localStorage.getItem(CHAVE_ESTADO);
            if (!bruto) return null;
            const estado = JSON.parse(bruto);
            // a janela de 30 min também é validada no processo principal
            if (estado?.salvoEm && Date.now() - estado.salvoEm > 30 * 60 * 1000) {
                localStorage.removeItem(CHAVE_ESTADO);
                return null;
            }
            return estado;
        } catch (err) {
            localStorage.removeItem(CHAVE_ESTADO);
            return null;
        }
    }

    /**
     * Restaura o trabalho interrompido: volta para o módulo e repõe os campos.
     * Chamado pelo menu depois que a interface está pronta.
     */
    window.restaurarTrabalhoInterrompido = async function restaurarTrabalhoInterrompido(irParaPagina) {
        const estado = lerEstadoSalvo();
        if (!estado) return false;
        localStorage.removeItem(CHAVE_ESTADO);   // uso único

        try {
            if (estado.sectionId && typeof irParaPagina === 'function') {
                await irParaPagina(estado.sectionId);
            }

            const content = document.getElementById('content');
            const aplicados = restaurarCampos(content, estado.campos);

            if (estado.modal?.overlayId) {
                // o modal é reaberto pelo próprio módulo; quando aparecer,
                // repomos os campos dele.
                aguardarModal(estado.modal);
            }

            if (aplicados > 0 || estado.modal) {
                if (typeof window.showToast === 'function') {
                    window.showToast('Restauramos o que você estava preenchendo antes da desconexão.', 'info');
                }
            }
            return true;
        } catch (err) {
            console.error('[estado] falha ao restaurar o trabalho:', err);
            return false;
        }
    };

    /** Espera o modal reaparecer (até 15s) para repor seus campos. */
    function aguardarModal(modal) {
        const limite = Date.now() + 15000;
        const timer = setInterval(() => {
            const overlay = document.getElementById(modal.overlayId);
            if (overlay && !overlay.classList.contains('hidden')) {
                clearInterval(timer);
                restaurarCampos(overlay, modal.campos);
            } else if (Date.now() > limite) {
                clearInterval(timer);
            }
        }, 250);
    }
})();
