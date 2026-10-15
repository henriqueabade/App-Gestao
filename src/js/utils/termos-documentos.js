/**
 * Os Termos de Uso e a Política de Privacidade do aplicativo (15/10/2026).
 *
 * O TEXTO MORA SÓ AQUI. A tela de login (cadastro), a caixa de aceite dentro
 * do programa e o backend (que grava o aceite) leem este arquivo — no
 * navegador como window.TermosDocumentos, no Node com
 * require('../src/js/utils/termos-documentos').
 *
 * MUDOU UMA VÍRGULA DO TEXTO, MUDE A VERSÃO do documento. O aceite guarda a
 * versão e a impressão digital (sha256) do texto aceito: com a versão nova,
 * quem aceitou a versão anterior fica "Desatualizado" e o Sup Admin pede o aceite de
 * novo. Versão igual com texto diferente é recusada pelo backend.
 *
 * Cada seção tem um título e blocos: texto = parágrafo; { lista: [...] } =
 * itens. `textoPlano` é a forma única do documento em texto corrido (é dela
 * que sai a impressão digital).
 *
 * ATENÇÃO: os dados do controlador abaixo e o texto devem ser conferidos pelo
 * dono com a assessoria jurídica dele antes de valer para todos.
 */
(function (raiz, fabrica) {
  const documentos = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = documentos;
  else raiz.TermosDocumentos = documentos;
})(typeof self !== 'undefined' ? self : this, function () {
  const CONTROLADOR = {
    nome: 'Santíssimo Decor LTDA',
    cnpj: '44.039.257/0001-22',
    contato: 'suporte@santissimodecor.com.br'
  };

  const TERMOS_DE_USO = {
    chave: 'termos_de_uso',
    titulo: 'Termos de Uso',
    versao: '1.1',
    vigencia: '15/10/2026',
    secoes: [
      {
        titulo: 'O que é este documento',
        blocos: [
          `Estes Termos de Uso são as regras para usar o Aplicativo de Gestão da ${CONTROLADOR.nome}, CNPJ ${CONTROLADOR.cnpj} ("Santíssimo Decor", "empresa"). O aplicativo é uma ferramenta de trabalho: reúne matéria-prima, produtos, orçamentos, pedidos, clientes, prospecções, contatos, tarefas, calendário, financeiro, contabilidade, relatórios e a gestão dos usuários.`,
          'Ao marcar "Li e aceito" você declara que leu este documento até o fim, entendeu e concorda com ele. Sem o aceite não é possível usar o aplicativo.',
          'Estes Termos valem junto com a Política de Privacidade, que explica quais dados seus o aplicativo trata, para quê e quais são os seus direitos.'
        ]
      },
      {
        titulo: 'Sua conta',
        blocos: [
          { lista: [
            'A conta é pessoal e intransferível. Não empreste seu e-mail e sua senha, nem use a conta de outra pessoa.',
            'Informe dados verdadeiros no cadastro e mantenha-os atualizados (nome, e-mail e telefone).',
            'A senha precisa ter pelo menos 8 caracteres, com letra maiúscula, número e caractere especial. Guarde-a em segredo: as operações registradas pela sua conta são atribuídas a você.',
            'Quem se cadastra pela tela de entrada confirma o e-mail e só começa a usar o aplicativo depois que um administrador libera o acesso e define o perfil de permissões.',
            'Se desconfiar que alguém usou a sua conta, troque a senha e avise o administrador na mesma hora.',
            'Depois de 3 tentativas de entrada com senha errada a conta fica bloqueada por um tempo e um código para criar nova senha é enviado ao e-mail cadastrado.'
          ] }
        ]
      },
      {
        titulo: 'Como o aplicativo deve ser usado',
        blocos: [
          'O aplicativo serve às atividades profissionais da Santíssimo Decor. Você se compromete a:',
          { lista: [
            'usar o aplicativo apenas para o trabalho e dentro das permissões do seu perfil;',
            'registrar informações corretas e completas;',
            'não tentar ver, copiar, alterar ou apagar o que o seu perfil não permite, nem contornar as travas do aplicativo;',
            'não copiar, exportar, fotografar ou repassar dados da empresa, de clientes, de fornecedores ou de colegas para fora do trabalho;',
            'não instalar o aplicativo nem deixar a sessão aberta em computador que outras pessoas usem sem a sua presença;',
            'não usar o aplicativo para fins ilegais, ofensivos ou que prejudiquem a empresa ou terceiros.'
          ] }
        ]
      },
      {
        titulo: 'Sigilo e dados de terceiros',
        blocos: [
          'No aplicativo você tem contato com dados da empresa e com dados pessoais de clientes, fornecedores, prestadores e colegas (nomes, documentos, endereços, telefones, e-mails, valores e negociações). Esses dados são confidenciais.',
          'Você só pode usá-los para a finalidade do seu trabalho, seguindo as orientações da empresa e a Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD). O dever de sigilo continua valendo depois que o seu acesso terminar.'
        ]
      },
      {
        titulo: 'Registro e acompanhamento do que é feito no aplicativo',
        blocos: [
          'Para a segurança das informações, a conferência do trabalho e a prestação de contas, o aplicativo mantém registros do uso profissional. Você está ciente de que:',
          { lista: [
            'cada entrada e saída do aplicativo fica registrada com data e hora (último login, última entrada, última saída e última atividade);',
            'a autoria de inclusões, alterações, conclusões, cancelamentos e exclusões é registrada com o seu nome, a data, a hora e o que mudou nos históricos disponíveis de clientes, prospecções, contatos, pedidos, orçamentos, tarefas, financeiro e contabilidade;',
            'nos pontos que geram auditoria, o registro do uso pode identificar o módulo ou a tela, a ação, a data e a hora, o usuário, a referência do registro de trabalho e o resultado da operação, incluindo consultas, navegação, filtros, emissões e exportações;',
            'ações manuais, iniciadas ou confirmadas por uma pessoa, são diferenciadas dos eventos automáticos do sistema, como sincronizações, consultas periódicas, recálculos e atualização de presença; um evento automático não comprova que a pessoa executou uma ação manual naquele momento;',
            'a gestão autorizada pode consultar relatórios detalhados por usuário e período para conferir operações, investigar erros, organizar o trabalho e prestar contas; esses relatórios consolidados são restritos à gestão, conforme as permissões de acesso;',
            'os históricos de cada ficha ficam disponíveis aos administradores e às pessoas envolvidas (quem criou, quem responde por ela e quem participa), conforme as permissões, inclusive comentários, curtidas, menções e anexos que você publicar; isso não libera o relatório consolidado de auditoria aos participantes;',
            'a tela de Usuários mostra aos administradores a sua situação — Online (sessão aberta), Ausente (o programa rodando em segundo plano) ou Offline (programa fechado) —, o módulo e a descrição da sua última alteração;',
            'o administrador principal (Sup Admin) vê a lista dos computadores em que a sua conta recebe avisos (nome do computador e usuário do Windows) e pode cancelar qualquer um deles;',
            'as tentativas de entrada com senha errada são contadas no computador para o bloqueio de segurança.'
          ] },
          'A auditoria de uso exclui senhas, hashes de senha, tokens de acesso, códigos de autenticação, chaves e outros segredos. Não se deve inserir esses dados em observações, comentários ou anexos.',
          'Os registros mostram os eventos disponíveis e seu contexto; isoladamente, não comprovam o tempo efetivo de trabalho nem a execução de uma operação não registrada.',
          'O aplicativo não grava a sua tela, o seu teclado, a sua câmera nem o seu microfone, e não acompanha o que você faz fora dele.'
        ]
      },
      {
        titulo: 'Avisos e notificações',
        blocos: [
          'Você autoriza o aplicativo a avisar você sobre o seu trabalho:',
          { lista: [
            'pelo sino dentro do aplicativo — quando alguém cita você, passa algo para você, altera, conclui, cancela ou exclui algo que é seu, e sobre tarefas, lembretes, pagamentos e mensagens;',
            'por uma janela no canto da tela do Windows, com som, mesmo com o aplicativo em segundo plano (perto do relógio) e mesmo depois de a sessão vencer, enquanto o computador estiver ligado à sua conta;',
            'por e-mail, para o endereço cadastrado — confirmação do cadastro, liberação do acesso, código para criar nova senha e avisos de segurança da conta.'
          ] },
          'Do mesmo modo, as outras pessoas envolvidas são avisadas do que você faz nas fichas delas, com o seu nome e a observação que você escrever.',
          'Em Configurações › Notificações você escolhe as categorias que quer ver no sino e pode desligar a janela do Windows e o som. Os e-mails de segurança da conta não podem ser desligados.'
        ]
      },
      {
        titulo: 'O programa no Windows',
        blocos: [
          'Ao fechar a janela, o aplicativo continua rodando em segundo plano, perto do relógio do Windows, para entregar os avisos. Para encerrá-lo de verdade, clique com o botão direito no ícone perto do relógio e escolha "Sair do programa". Enquanto ele roda, envia de minuto em minuto um sinal ao servidor informando que está ligado — é desse sinal que sai a situação Ausente.',
          'O aplicativo procura e instala as próprias atualizações. Algumas são obrigatórias para continuar usando.'
        ]
      },
      {
        titulo: 'Assistente de leitura (módulo IA)',
        blocos: [
          'O módulo IA lê documentos (PDF, foto ou planilha) para preencher cadastros. Quando ele é usado, o conteúdo do arquivo é enviado a provedores externos de inteligência artificial (hoje, Google Gemini e Groq), que podem processá-lo fora do Brasil. Envie apenas documentos de trabalho e confira sempre o resultado antes de gravar: a responsabilidade pelo que é gravado é de quem confirma.'
        ]
      },
      {
        titulo: 'Permissões, suspensão e encerramento do acesso',
        blocos: [
          'O que você vê e faz depende do perfil de permissões definido pelo administrador, que pode mudar a qualquer momento conforme a sua função.',
          'A empresa pode desativar o seu acesso, a qualquer tempo, quando terminar o vínculo ou a necessidade, por segurança ou por descumprimento destes Termos. Com o acesso desativado, a entrada é recusada e aparece o aviso "Login bloqueado. Contate o administrador.".',
          'O que você registrou continua no aplicativo, com a sua autoria, porque faz parte dos registros da empresa.'
        ]
      },
      {
        titulo: 'Propriedade',
        blocos: [
          'O aplicativo, a marca, as telas, os relatórios e todas as informações nele guardadas pertencem à Santíssimo Decor. O acesso não transfere a você nenhum direito sobre eles. É proibido copiar, modificar, descompilar ou distribuir o aplicativo.'
        ]
      },
      {
        titulo: 'Disponibilidade e responsabilidade',
        blocos: [
          'A empresa se esforça para manter o aplicativo funcionando, mas ele depende de internet, do servidor e de serviços de terceiros (banco, Secretaria da Fazenda, e-mail), e pode ficar indisponível ou passar por manutenção.',
          'Você responde pelo uso que fizer da sua conta em desacordo com estes Termos, com as orientações da empresa ou com a lei.'
        ]
      },
      {
        titulo: 'Mudanças nestes Termos',
        blocos: [
          'Estes Termos podem ser atualizados. O aceite anterior é sinalizado como desatualizado e o Sup Admin pode solicitar um novo aceite pelo fluxo existente. Quando solicitado, o aplicativo mostra os documentos vigentes e pede a sua decisão antes de continuar. A versão e a data de vigência ficam no topo do documento.'
        ]
      },
      {
        titulo: 'Se você não aceitar',
        blocos: [
          'O aceite é condição para usar o aplicativo. Quem recusa tem o acesso desativado e volta para a tela de entrada; a conta não é excluída e o administrador pode reativá-la para que o aceite seja feito depois.'
        ]
      },
      {
        titulo: 'Registro do aceite',
        blocos: [
          'O seu aceite (ou a sua recusa) fica guardado com o seu nome, o seu e-mail, a data e a hora, a versão do documento, a impressão digital do texto aceito, o computador usado e, quando disponível, o endereço de internet (IP). Esse registro não pode ser alterado e serve de prova para você e para a empresa.'
        ]
      },
      {
        titulo: 'Lei aplicável e contato',
        blocos: [
          'Estes Termos seguem as leis brasileiras. As dúvidas e os conflitos serão resolvidos no foro da sede da Santíssimo Decor, ressalvada a competência definida em lei.',
          `Dúvidas sobre estes Termos: ${CONTROLADOR.contato}.`
        ]
      }
    ]
  };

  const POLITICA_DE_PRIVACIDADE = {
    chave: 'politica_de_privacidade',
    titulo: 'Política de Privacidade',
    versao: '1.1',
    vigencia: '15/10/2026',
    secoes: [
      {
        titulo: 'Quem cuida dos seus dados',
        blocos: [
          `A ${CONTROLADOR.nome}, CNPJ ${CONTROLADOR.cnpj}, é a controladora dos dados pessoais tratados no Aplicativo de Gestão, nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018 — LGPD).`,
          `Canal para falar sobre os seus dados e exercer os seus direitos: ${CONTROLADOR.contato}.`,
          'Esta Política trata dos dados de quem USA o aplicativo (os usuários). Os dados de clientes, fornecedores e demais pessoas cadastradas no aplicativo são tratados pela empresa conforme as regras dela e a lei, e você, como usuário, deve protegê-los (veja os Termos de Uso).'
        ]
      },
      {
        titulo: 'Quais dados seus são tratados',
        blocos: [
          'Dados do cadastro:',
          { lista: [
            'nome completo, e-mail e telefone;',
            'foto de perfil, se você enviar;',
            'perfil de permissões (a sua função no aplicativo) e observações internas do administrador sobre o cadastro;',
            'senha — guardada apenas de forma embaralhada e irreversível (hash): ninguém, nem a empresa, consegue lê-la.'
          ] },
          'Dados de uso do aplicativo:',
          { lista: [
            'datas e horas de login, entrada, saída e última atividade;',
            'o módulo, a data, a hora e a descrição da sua última alteração;',
            'o histórico do que você incluiu, alterou, concluiu, cancelou ou excluiu, com a sua autoria;',
            'os eventos de uso profissional nos pontos que geram auditoria: módulo ou tela, ação, data e hora, identificação do usuário, referência do registro de trabalho, contexto e resultado disponíveis, inclusive em consultas, navegação, filtros, emissões e exportações;',
            'a classificação dos eventos como ações manuais ou automáticas do sistema, quando identificada, para separar os comandos da pessoa de sincronizações, consultas periódicas, recálculos e atualizações de presença;',
            'o que você publica: comentários, observações, curtidas, menções, anexos, tarefas e mensagens;',
            'a sua situação (Online, Ausente ou Offline) e o sinal que o programa envia de minuto em minuto enquanto está ligado;',
            'os avisos enviados a você e se já foram lidos;',
            'as suas preferências (página inicial, menu, categorias de avisos, som).'
          ] },
          'Dados do computador:',
          { lista: [
            'nome do computador e nome do usuário do Windows, para a lista de computadores que recebem os seus avisos;',
            'versão do aplicativo;',
            'endereço de internet (IP), que chega ao servidor em toda comunicação e é guardado no registro do aceite destes documentos e nos registros técnicos do servidor.'
          ] },
          'Dados ligados à sua função, quando for o caso: comissões, produção e pagamentos lançados em seu nome no Financeiro.',
          'A auditoria de uso não inclui senhas, hashes de senha, tokens de acesso, códigos de autenticação, chaves ou outros segredos. O registro de uso se limita às atividades profissionais dentro do aplicativo; não inclui captura de tela, teclado, câmera, microfone ou atividades externas ao programa.',
          'O aplicativo não pede nem trata dados pessoais sensíveis seus (como saúde, religião, biometria ou opinião política), e não é destinado a menores de 18 anos.'
        ]
      },
      {
        titulo: 'Para que os dados são usados e com que base legal',
        blocos: [
          { lista: [
            'Criar e manter a sua conta, confirmar o seu e-mail, liberar e controlar o seu acesso — execução do contrato ou da relação de trabalho com a empresa e procedimentos preliminares a pedido seu (LGPD, art. 7º, V).',
            'Permitir o seu trabalho no aplicativo e identificar a autoria de cada registro — execução do contrato (art. 7º, V) e legítimo interesse da empresa na organização e na conferência das atividades (art. 7º, IX).',
            'Registrar entradas, saídas e ações, mostrar a sua situação, manter o histórico e permitir à gestão autorizada conferir o uso profissional por usuário e período — legítimo interesse na segurança das informações, na prevenção de fraudes e erros, na organização do trabalho e na prestação de contas (art. 7º, IX), e exercício regular de direitos em processos (art. 7º, VI).',
            'Enviar avisos pelo sino, pela janela do Windows e por e-mail — execução do contrato e legítimo interesse em que o trabalho chegue a quem deve fazê-lo (art. 7º, V e IX).',
            'Cumprir obrigações fiscais, contábeis, trabalhistas e de guarda de registros — cumprimento de obrigação legal ou regulatória (art. 7º, II).',
            'Mostrar a sua foto de perfil e outros dados opcionais que você decidir informar — o seu consentimento (art. 7º, I), que pode ser retirado a qualquer momento apagando o dado.'
          ] },
          'Os seus dados não são vendidos e não são usados para publicidade. O aplicativo não toma decisões só por meios automáticos que afetem os seus interesses: o módulo IA apenas ajuda a ler documentos, e toda gravação é confirmada por uma pessoa.'
        ]
      },
      {
        titulo: 'Quem vê os seus dados',
        blocos: [
          'Dentro da empresa:',
          { lista: [
            'os administradores veem o seu cadastro, a sua situação, as suas datas de acesso, a sua última alteração e os computadores ligados à sua conta;',
            'a gestão com autorização específica pode consultar os relatórios detalhados de auditoria do uso profissional por usuário e período; a consulta desses relatórios é restrita à gestão e não fica disponível aos demais usuários apenas por eles participarem de uma ficha;',
            'os colegas veem o seu nome e a sua foto nas listas de responsável, nos históricos, nos comentários e nos avisos das fichas em que você atua.'
          ] },
          'Fora da empresa, os dados passam por prestadores de serviço que trabalham para ela (operadores), apenas no necessário:',
          { lista: [
            'a empresa de hospedagem do servidor e do banco de dados do aplicativo;',
            'o serviço de e-mail usado para enviar as mensagens do aplicativo;',
            'os provedores de inteligência artificial do módulo IA (hoje, Google Gemini e Groq), que recebem o conteúdo dos documentos enviados para leitura;',
            'o serviço de onde o aplicativo baixa as atualizações (GitHub) e os serviços de onde ele carrega fontes e ícones (Google Fonts e cdnjs), que recebem o endereço de internet (IP) do computador;',
            'autoridades públicas, quando a lei ou uma ordem judicial exigir.'
          ] },
          'Alguns desses prestadores ficam fora do Brasil. Nesses casos há transferência internacional de dados, feita com as garantias previstas na LGPD (arts. 33 a 36).'
        ]
      },
      {
        titulo: 'O que fica guardado no seu computador',
        blocos: [
          { lista: [
            'a chave da sessão (para não pedir a senha a cada abertura enquanto ela vale, por até 12 horas) e a chave dos avisos do Windows;',
            'o seu nome, a sua foto, o seu e-mail e a data da última entrada, para a tela de entrada mostrar quem usou o aplicativo por último naquele computador;',
            'as suas preferências e a contagem de tentativas de entrada;',
            'o trabalho que estava em andamento quando a conexão caiu, por até 30 minutos, para ser restaurado.'
          ] },
          'Em computador compartilhado, saia da sua conta ao terminar.'
        ]
      },
      {
        titulo: 'Por quanto tempo os dados ficam guardados',
        blocos: [
          'Os dados da conta ficam guardados enquanto você tiver acesso ao aplicativo. Depois que o acesso termina, o cadastro pode ser excluído, mas o histórico do que você fez continua guardado com a sua autoria pelo tempo exigido pelas leis fiscais, contábeis e trabalhistas e pelo prazo em que a empresa possa precisar dele para se defender ou prestar contas (LGPD, art. 16).',
          'Os registros detalhados de uso profissional e do aceite destes documentos seguem esses mesmos critérios de necessidade, obrigação de guarda e defesa de direitos. Não se estabelece aqui um prazo numérico único para todos os registros, nem uma rotina de eliminação automática. A empresa deve avaliar a conservação de acordo com a finalidade e as obrigações aplicáveis e eliminar ou anonimizar os dados quando não houver motivo legítimo para mantê-los.'
        ]
      },
      {
        titulo: 'Como os dados são protegidos',
        blocos: [
          { lista: [
            'senha guardada apenas como hash e exigência de senha forte;',
            'comunicação cifrada (HTTPS) entre o aplicativo e o servidor;',
            'perfis de permissão: cada pessoa vê e faz apenas o que o perfil dela permite;',
            'sessão que vence sozinha, bloqueio após tentativas de entrada erradas e possibilidade de o administrador cancelar o acesso e os computadores ligados à conta;',
            'registro de autoria nas operações e nos eventos auditados.'
          ] },
          'Nenhum sistema é totalmente seguro. Se houver um incidente que possa trazer risco ou dano relevante a você, a empresa avisará você e a Autoridade Nacional de Proteção de Dados (ANPD), como manda a lei.'
        ]
      },
      {
        titulo: 'Os seus direitos',
        blocos: [
          'A LGPD (art. 18) garante a você, a qualquer momento e sem custo:',
          { lista: [
            'saber se a empresa trata dados seus e ter acesso a eles;',
            'corrigir dados incompletos, errados ou desatualizados (parte deles você mesmo corrige em Configurações › Dados pessoais);',
            'pedir a anonimização, o bloqueio ou a eliminação de dados desnecessários, excessivos ou tratados em desacordo com a lei;',
            'pedir a portabilidade dos dados;',
            'saber com quem os dados foram compartilhados;',
            'retirar o consentimento, quando o tratamento depender dele, e ser informado sobre as consequências de não consentir;',
            'opor-se a um tratamento que considere irregular;',
            'pedir a revisão de decisões tomadas só por meios automáticos.'
          ] },
          `Para exercer esses direitos, escreva para ${CONTROLADOR.contato}. A empresa responde nos prazos da lei. Alguns pedidos podem não ser atendidos por inteiro quando a lei obrigar a empresa a guardar o dado — nesse caso, você será informado do motivo.`,
          'Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD), em www.gov.br/anpd.'
        ]
      },
      {
        titulo: 'Se você não concordar',
        blocos: [
          'O tratamento descrito aqui é necessário para o aplicativo funcionar. Sem o aceite desta Política e dos Termos de Uso não é possível usá-lo: o acesso é desativado, sem excluir a conta, e o administrador pode reativá-lo para que o aceite seja feito depois.'
        ]
      },
      {
        titulo: 'Mudanças nesta Política',
        blocos: [
          'Esta Política pode ser atualizada. O aceite anterior é sinalizado como desatualizado e o Sup Admin pode solicitar um novo aceite pelo fluxo existente. Quando solicitado, o aplicativo mostra os documentos vigentes e pede a sua decisão antes de continuar. A versão e a data de vigência ficam no topo do documento.'
        ]
      }
    ]
  };

  const DOCUMENTOS = {
    termos_de_uso: TERMOS_DE_USO,
    politica_de_privacidade: POLITICA_DE_PRIVACIDADE
  };
  const ORDEM = ['termos_de_uso', 'politica_de_privacidade'];

  function documento(chave) {
    return DOCUMENTOS[chave] || null;
  }

  /** A linha de versão que aparece no topo do documento. */
  function linhaDaVersao(doc) {
    return `Versão ${doc.versao} — vigente desde ${doc.vigencia}`;
  }

  /**
   * O documento inteiro em texto corrido, sempre igual para o mesmo conteúdo:
   * título, versão e as seções numeradas. É o que o backend guarda e do que
   * tira a impressão digital (sha256).
   */
  function textoPlano(chave) {
    const doc = documento(chave);
    if (!doc) return '';
    const linhas = [doc.titulo, linhaDaVersao(doc), ''];
    doc.secoes.forEach((secao, i) => {
      linhas.push(`${i + 1}. ${secao.titulo}`);
      secao.blocos.forEach(bloco => {
        if (typeof bloco === 'string') linhas.push(bloco);
        else (bloco.lista || []).forEach(item => linhas.push(`- ${item}`));
      });
      linhas.push('');
    });
    return linhas.join('\n').trim();
  }

  /** { termos_de_uso: '1.0', politica_de_privacidade: '1.0' } */
  function versoes() {
    return Object.fromEntries(ORDEM.map(chave => [chave, DOCUMENTOS[chave].versao]));
  }

  return { CONTROLADOR, DOCUMENTOS, ORDEM, documento, linhaDaVersao, textoPlano, versoes };
});
