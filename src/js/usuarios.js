// Script principal do módulo de Usuários
// Controla carregamento da lista, edições e filtros

function coletarFiltros() {
    const status = [];
    document.querySelectorAll('.checkbox-custom:checked').forEach(cb => status.push(cb.value));
    return {
        busca: document.getElementById('filtroBusca')?.value || '',
        perfil: document.getElementById('filtroPerfil')?.value || '',
        status
    };
}

function initUsuarios() {
    // animação de entrada
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });

    document.getElementById('btnNovoUsuario')?.addEventListener('click', () => {
        console.log('Criar novo usuário');
    });

    document.getElementById('aplicarFiltro')?.addEventListener('click', () => {
        console.log('Aplicar filtros', coletarFiltros());
    });

    document.getElementById('limparFiltro')?.addEventListener('click', () => {
        document.getElementById('filtroBusca').value = '';
        document.getElementById('filtroPerfil').value = '';
        document.querySelectorAll('.checkbox-custom').forEach(cb => cb.checked = false);
        console.log('Filtros limpos');
    });

    document.querySelectorAll('[data-acao="editar"]').forEach(btn => {
        btn.addEventListener('click', () => {
            console.log('Editar usuário');
        });
    });

    document.querySelectorAll('[data-acao="remover"]').forEach(btn => {
        btn.addEventListener('click', () => {
            console.log('Remover usuário');
        });
    });

    // Controle do popover de resumo
    const infoIcon = document.querySelector('.info-icon');
    const resumoPopover = document.getElementById('resumoPopover');

    if (infoIcon && resumoPopover) {
        const mostrarPopover = () => {
            const rect = infoIcon.getBoundingClientRect();
            resumoPopover.style.left = `${rect.left + window.scrollX}px`;
            resumoPopover.style.top = `${rect.bottom + window.scrollY}px`;
            resumoPopover.classList.add('show');
        };

        const ocultarPopover = () => {
            resumoPopover.classList.remove('show');
        };

        infoIcon.addEventListener('mouseenter', mostrarPopover);
        infoIcon.addEventListener('mouseleave', () => {
            setTimeout(() => {
                if (!resumoPopover.matches(':hover')) ocultarPopover();
            }, 100);
        });
        resumoPopover.addEventListener('mouseleave', ocultarPopover);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initUsuarios);
} else {
    initUsuarios();
}
