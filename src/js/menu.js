// Lógica de interação do menu principal

// Elementos da página
const sidebar = document.getElementById('sidebar');
const mainContent = document.getElementById('mainContent');
const menuToggle = document.getElementById('menuToggle');
const crmToggle = document.getElementById('crmToggle');
const crmSubmenu = document.getElementById('crmSubmenu');
const chevron = crmToggle.querySelector('.chevron');
const companyName = document.getElementById('companyName');

// Carrega páginas modulares dentro da div#content
// Remove estilos e scripts antigos e executa o novo script em escopo isolado
async function loadPage(page) {
    const content = document.getElementById('content');
    if (!content) return;

    try {
        const resp = await fetch(`../html/${page}.html`);
        content.innerHTML = await resp.text();
        document.dispatchEvent(new Event('module-change'));

        document.getElementById('page-style')?.remove();
        document.getElementById('page-script')?.remove();

        const style = document.createElement('link');
        style.id = 'page-style';
        style.rel = 'stylesheet';
        style.href = `../css/${page}.css`;
        document.head.appendChild(style);

        const script = document.createElement('script');
        script.id = 'page-script';
        const jsResp = await fetch(`../js/${page}.js`);
        const jsText = await jsResp.text();
        script.textContent = `(function(){\n${jsText}\n})();`;
        document.body.appendChild(script);
        document.dispatchEvent(new Event('module-change'));
    } catch (err) {
        console.error('Erro ao carregar página', page, err);
    }
}
window.loadPage = loadPage;

let sidebarExpanded = false;
let crmExpanded = false;

// Expande a sidebar quando necessário
function expandSidebar() {
    if (!sidebarExpanded) {
        sidebar.classList.remove('sidebar-collapsed');
        sidebar.classList.add('sidebar-expanded', 'sidebar-text-visible');
        const offset = window.innerWidth >= 1024 ? '240px' : '200px';
        mainContent.style.marginLeft = offset;
        if (companyName) companyName.classList.remove('collapsed');
        sidebarExpanded = true;
    }
}

function collapseSidebar() {
    if (sidebarExpanded) {
        sidebar.classList.remove('sidebar-expanded', 'sidebar-text-visible');
        sidebar.classList.add('sidebar-collapsed');
        mainContent.style.marginLeft = '64px';
        if (companyName) companyName.classList.add('collapsed');
        sidebarExpanded = false;
    }
    // Submenu CRM permanece aberto; fechamento apenas via clique
}

// Alterna a sidebar através do botão de menu
menuToggle?.addEventListener('click', () => {
    if (sidebarExpanded) {
        collapseSidebar();
    } else {
        expandSidebar();
    }
});

// Recolhe a sidebar apenas quando o usuário entra no conteúdo principal
mainContent?.addEventListener('mouseenter', collapseSidebar);

// Mostra ou esconde submenu do CRM
function toggleCrmSubmenu() {
    crmExpanded = !crmExpanded;
    if (crmExpanded) {
        crmSubmenu.classList.add('open');
        chevron.classList.add('rotated');
        if (!sidebarExpanded) expandSidebar();
    } else {
        crmSubmenu.classList.remove('open');
        chevron.classList.remove('rotated');
        // Submenu fecha apenas em ações explícitas
    }
}
crmToggle.addEventListener('click', toggleCrmSubmenu);

// Navegação interna
document.querySelectorAll('.sidebar-item[data-page], .submenu-item[data-page]').forEach(item => {
    item.addEventListener('click', function (e) {
        e.stopPropagation();
        // Remove destaque de todos os itens antes de aplicar ao clicado

        document.querySelectorAll('.sidebar-item, .submenu-item').forEach(i => i.classList.remove('active'));
        // Marca item clicado como ativo para aplicar o estilo de destaque

        this.classList.add('active');

        // Fecha submenu do CRM ao navegar para outros módulos
        const insideCrm = this.closest('#crmSubmenu');
        if (!insideCrm && crmExpanded) {
            crmSubmenu.classList.remove('open');
            chevron.classList.remove('rotated');
            crmExpanded = false;
        }
        // Mantém submenu aberto se o clique for em um item do CRM
        if (insideCrm && !crmExpanded) {
            crmSubmenu.classList.add('open');
            chevron.classList.add('rotated');
            crmExpanded = true;
        }

        const page = this.dataset.page;
        if (page === 'dashboard') {
            window.location.reload();
        } else if (page) {
            loadPage(page);
        }
    });
});

// Animação inicial dos cards
window.addEventListener('load', () => {
    document.querySelectorAll('.animate-fade-in-up').forEach((el, index) => {
        setTimeout(() => {
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, index * 100);
    });
});

// Ajustes responsivos ao redimensionar
window.addEventListener('resize', () => {
    if (window.innerWidth < 1024) {
        sidebar.removeEventListener('mouseenter', expandSidebar);
    } else {
        sidebar.addEventListener('mouseenter', expandSidebar);
    }
    if (sidebarExpanded) {
        mainContent.style.marginLeft = window.innerWidth >= 1024 ? '240px' : '200px';
    }
});
