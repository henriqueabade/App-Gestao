-- ============================================================================
--  prospeccoes_seed.sql
--  Dados de AMOSTRA do módulo Prospecções — App-Gestao
--
--  Rode SOMENTE depois de sql/prospeccoes.sql.
--
--  Insere 10 prospecções distribuídas pelas 7 etapas do funil, com contatos,
--  timeline de interações, histórico de movimentação, notas e campanhas.
--  Serve para exercitar a tela: funil, filtros, badges, detalhes e conversão.
--
--  Os responsáveis são escolhidos entre os usuários que JÁ existem no banco —
--  o script não cria usuário nenhum. Se não houver usuário cadastrado, as
--  prospecções entram sem responsável (o app lida com isso).
--
--  IDEMPOTENTE: rodar de novo não duplica nada.
--
--  >>> PARA REMOVER A AMOSTRA DEPOIS DOS TESTES, veja o bloco no fim do arquivo.
-- ============================================================================

BEGIN;

DO $$
DECLARE
  v_usuarios  INTEGER[];
  v_total     INTEGER;
  u1 INTEGER; u2 INTEGER; u3 INTEGER; u4 INTEGER;
  v_cliente   INTEGER;
  p_id        INTEGER;
BEGIN
  -- ----------------------------------------------------------------------
  -- Guarda de idempotência
  -- ----------------------------------------------------------------------
  IF EXISTS (SELECT 1 FROM prospeccoes WHERE nome_fantasia = 'Marmoraria Vitória') THEN
    RAISE NOTICE 'Amostra de prospecções já presente — nada foi inserido.';
    RETURN;
  END IF;

  -- ----------------------------------------------------------------------
  -- Responsáveis: usa os usuários existentes, sem criar nenhum
  -- ----------------------------------------------------------------------
  SELECT array_agg(id ORDER BY id) INTO v_usuarios FROM usuarios;
  v_total := COALESCE(array_length(v_usuarios, 1), 0);

  u1 := CASE WHEN v_total >= 1 THEN v_usuarios[1] ELSE NULL END;
  u2 := CASE WHEN v_total >= 2 THEN v_usuarios[2] ELSE u1 END;
  u3 := CASE WHEN v_total >= 3 THEN v_usuarios[3] ELSE u1 END;
  u4 := CASE WHEN v_total >= 4 THEN v_usuarios[4] ELSE u2 END;

  IF v_total = 0 THEN
    RAISE NOTICE 'Nenhum usuário encontrado: as prospecções entrarão sem responsável.';
  END IF;

  -- Um cliente qualquer, só para a prospecção "Ganho" ter o vínculo preenchido.
  SELECT id INTO v_cliente FROM clientes ORDER BY id LIMIT 1;


  -- ======================================================================
  -- 1) NOVO — Marmoraria Vitória
  -- ======================================================================
  INSERT INTO prospeccoes (
    nome_fantasia, razao_social, cnpj, site, segmento,
    origem, etapa, valor_estimado, probabilidade, responsavel_id,
    proximo_passo, proximo_passo_data,
    end_logradouro, end_numero, end_bairro, end_cidade, end_uf, end_pais, end_cep,
    anotacoes, criado_por, criado_em
  ) VALUES (
    'Marmoraria Vitória', 'Vitória Mármores e Granitos Ltda', '12.345.678/0001-90',
    'https://www.marmorariavitoria.com.br', 'Marmoraria',
    'Indicação', 'Novo', 48000.00, 10, u1,
    'Primeira ligação de apresentação', CURRENT_DATE + 2,
    'Av. dos Bandeirantes', '2450', 'Vila Olímpia', 'São Paulo', 'São Paulo', 'Brasil', '04553-004',
    'Indicada pelo cliente Alpha Decor. Trabalham com bancadas sob medida.', u1, NOW() - INTERVAL '3 days'
  ) RETURNING id INTO p_id;

  INSERT INTO prospeccao_contatos (prospeccao_id, nome, cargo, email, telefone_fixo, telefone_celular, decisor, principal)
  VALUES
    (p_id, 'Rogério Tavares', 'Sócio-proprietário', 'rogerio@marmorariavitoria.com.br', '(11) 3721-4400', '(11) 98812-4455', TRUE,  TRUE),
    (p_id, 'Simone Prado',    'Compras',            'compras@marmorariavitoria.com.br', '(11) 3721-4401', '(11) 99640-2213', FALSE, FALSE);

  INSERT INTO prospeccao_etapas_historico (prospeccao_id, etapa_anterior, etapa_nova, observacao, usuario_id, criado_em)
  VALUES (p_id, NULL, 'Novo', 'Cadastro inicial a partir de indicação', u1, NOW() - INTERVAL '3 days');

  INSERT INTO prospeccao_interacoes (prospeccao_id, tipo, data, resumo, detalhe, usuario_id)
  VALUES (p_id, 'Nota', NOW() - INTERVAL '3 days', 'Lead recebido por indicação',
          'Alpha Decor indicou o Rogério. Ele pediu para ser contatado depois das 14h.', u1);


  -- ======================================================================
  -- 2) NOVO — Studio Lumina Arquitetura
  -- ======================================================================
  INSERT INTO prospeccoes (
    nome_fantasia, razao_social, site, segmento,
    origem, etapa, valor_estimado, probabilidade, responsavel_id,
    proximo_passo, proximo_passo_data,
    end_logradouro, end_numero, end_bairro, end_cidade, end_uf, end_pais, end_cep,
    anotacoes, criado_por, criado_em
  ) VALUES (
    'Studio Lumina Arquitetura', 'Lumina Projetos e Arquitetura ME', 'https://studiolumina.arq.br', 'Arquitetura',
    'Redes Sociais', 'Novo', 26500.00, 10, u2,
    'Enviar catálogo de acabamentos', CURRENT_DATE + 1,
    'Rua Voluntários da Pátria', '190', 'Botafogo', 'Rio de Janeiro', 'Rio de Janeiro', 'Brasil', '22270-010',
    'Chegou pelo Instagram. Ainda sem CNPJ confirmado.', u2, NOW() - INTERVAL '2 days'
  ) RETURNING id INTO p_id;

  INSERT INTO prospeccao_contatos (prospeccao_id, nome, cargo, email, telefone_celular, decisor, principal)
  VALUES (p_id, 'Beatriz Nogueira', 'Arquiteta titular', 'bia@studiolumina.arq.br', '(21) 99187-3320', TRUE, TRUE);

  INSERT INTO prospeccao_etapas_historico (prospeccao_id, etapa_anterior, etapa_nova, observacao, usuario_id, criado_em)
  VALUES (p_id, NULL, 'Novo', 'Lead capturado nas redes sociais', u2, NOW() - INTERVAL '2 days');

  INSERT INTO prospeccao_campanhas (prospeccao_id, nome, canal, status, data_envio, resposta, usuario_id)
  VALUES (p_id, 'Instagram — Coleção Outono', 'Redes Sociais', 'Concluída', CURRENT_DATE - 5, 'Interessado', u2);


  -- ======================================================================
  -- 3) CONTACTADO — Construtora Alvorada
  -- ======================================================================
  INSERT INTO prospeccoes (
    nome_fantasia, razao_social, cnpj, inscricao_estadual, site, segmento,
    origem, etapa, valor_estimado, probabilidade, responsavel_id,
    proximo_passo, proximo_passo_data,
    end_logradouro, end_numero, end_bairro, end_cidade, end_uf, end_pais, end_cep,
    anotacoes, criado_por, criado_em
  ) VALUES (
    'Construtora Alvorada', 'Alvorada Engenharia e Construções S.A.', '23.456.789/0001-01', '062.114.335.001',
    'https://construtoraalvorada.com.br', 'Construção civil',
    'Evento', 'Contactado', 185000.00, 25, u1,
    'Agendar visita técnica ao canteiro', CURRENT_DATE + 5,
    'Av. Afonso Pena', '1500', 'Centro', 'Belo Horizonte', 'Minas Gerais', 'Brasil', '30130-005',
    'Conhecidos na Expo Revestir. Três torres previstas para 2026.', u1, NOW() - INTERVAL '12 days'
  ) RETURNING id INTO p_id;

  INSERT INTO prospeccao_contatos (prospeccao_id, nome, cargo, email, telefone_fixo, telefone_celular, decisor, principal)
  VALUES
    (p_id, 'Marcelo Assunção', 'Diretor de Suprimentos', 'marcelo.assuncao@alvorada.com.br', '(31) 3222-8800', '(31) 98444-1290', TRUE,  TRUE),
    (p_id, 'Patrícia Rezende', 'Arquiteta coordenadora', 'patricia.rezende@alvorada.com.br', '(31) 3222-8815', '(31) 99123-7788', FALSE, FALSE),
    (p_id, 'Wagner Lopes',     'Comprador',              'wagner.lopes@alvorada.com.br',     '(31) 3222-8830', NULL,              FALSE, FALSE);

  INSERT INTO prospeccao_etapas_historico (prospeccao_id, etapa_anterior, etapa_nova, observacao, usuario_id, criado_em)
  VALUES
    (p_id, NULL,   'Novo',       'Contato feito na Expo Revestir', u1, NOW() - INTERVAL '12 days'),
    (p_id, 'Novo', 'Contactado', 'Retorno positivo do Marcelo',    u1, NOW() - INTERVAL '9 days');

  INSERT INTO prospeccao_interacoes (prospeccao_id, tipo, data, resumo, detalhe, duracao_min, usuario_id)
  VALUES
    (p_id, 'Visita',  NOW() - INTERVAL '12 days', 'Encontro na Expo Revestir',   'Apresentação do portfólio no estande. Deixamos catálogo impresso.', 30, u1),
    (p_id, 'E-mail',  NOW() - INTERVAL '10 days', 'Envio do catálogo digital',   'Enviado PDF com linha de laminados e tabela de preços.',            NULL, u1),
    (p_id, 'Ligação', NOW() - INTERVAL '9 days',  'Retorno do Marcelo',          'Confirmou interesse. Pediu proposta para a Torre A primeiro.',      18, u1);


  -- ======================================================================
  -- 4) CONTACTADO — Hotel Costa Serena
  -- ======================================================================
  INSERT INTO prospeccoes (
    nome_fantasia, razao_social, cnpj, segmento,
    origem, etapa, valor_estimado, probabilidade, responsavel_id,
    proximo_passo, proximo_passo_data,
    end_logradouro, end_numero, end_bairro, end_cidade, end_uf, end_pais, end_cep,
    anotacoes, criado_por, criado_em
  ) VALUES (
    'Hotel Costa Serena', 'Costa Serena Hotelaria Ltda', '34.567.890/0001-12', 'Hotelaria',
    'Website', 'Contactado', 92000.00, 25, u3,
    'Enviar amostras de acabamento', CURRENT_DATE + 3,
    'Av. Beira Mar Norte', '3200', 'Agronômica', 'Florianópolis', 'Santa Catarina', 'Brasil', '88015-700',
    'Reforma de 84 apartamentos prevista para o inverno.', u3, NOW() - INTERVAL '8 days'
  ) RETURNING id INTO p_id;

  INSERT INTO prospeccao_contatos (prospeccao_id, nome, cargo, email, telefone_fixo, telefone_celular, decisor, principal)
  VALUES
    (p_id, 'Cláudia Bertoldi', 'Gerente Geral',      'claudia@hotelcostaserena.com.br', '(48) 3333-5500', '(48) 99811-4477', TRUE,  TRUE),
    (p_id, 'Henrique Dutra',   'Manutenção predial', 'manutencao@hotelcostaserena.com.br', '(48) 3333-5510', NULL,          FALSE, FALSE);

  INSERT INTO prospeccao_etapas_historico (prospeccao_id, etapa_anterior, etapa_nova, observacao, usuario_id, criado_em)
  VALUES
    (p_id, NULL,   'Novo',       'Formulário do site',                u3, NOW() - INTERVAL '8 days'),
    (p_id, 'Novo', 'Contactado', 'Primeira ligação atendida',         u3, NOW() - INTERVAL '6 days');

  INSERT INTO prospeccao_interacoes (prospeccao_id, tipo, data, resumo, detalhe, duracao_min, usuario_id)
  VALUES
    (p_id, 'E-mail',  NOW() - INTERVAL '8 days', 'Contato pelo formulário do site', 'Solicitou orçamento para reforma dos apartamentos.', NULL, u3),
    (p_id, 'Ligação', NOW() - INTERVAL '6 days', 'Qualificação inicial',            'Cláudia confirmou verba aprovada. Decisão em 60 dias.', 22, u3);


  -- ======================================================================
  -- 5) QUALIFICADO — Interiores Bianchi
  -- ======================================================================
  INSERT INTO prospeccoes (
    nome_fantasia, razao_social, cnpj, inscricao_estadual, site, segmento,
    origem, etapa, valor_estimado, probabilidade, responsavel_id,
    proximo_passo, proximo_passo_data,
    end_logradouro, end_numero, end_complemento, end_bairro, end_cidade, end_uf, end_pais, end_cep,
    anotacoes, criado_por, criado_em
  ) VALUES (
    'Interiores Bianchi', 'Bianchi Design de Interiores Ltda', '45.678.901/0001-23', '110.442.887.114',
    'https://interioresbianchi.com.br', 'Design de interiores',
    'Indicação', 'Qualificado', 74500.00, 50, u2,
    'Montar proposta com três opções de acabamento', CURRENT_DATE + 4,
    'Rua Haddock Lobo', '1626', 'Conjunto 92', 'Cerqueira César', 'São Paulo', 'São Paulo', 'Brasil', '01414-002',
    'Atendem alto padrão. Exigentes com prazo de entrega.', u2, NOW() - INTERVAL '25 days'
  ) RETURNING id INTO p_id;

  INSERT INTO prospeccao_contatos (prospeccao_id, nome, cargo, email, telefone_fixo, telefone_celular, decisor, principal)
  VALUES
    (p_id, 'Luciana Bianchi', 'Diretora criativa',  'luciana@interioresbianchi.com.br', '(11) 3061-7700', '(11) 98330-1188', TRUE,  TRUE),
    (p_id, 'Eduardo Bianchi', 'Diretor financeiro', 'eduardo@interioresbianchi.com.br', '(11) 3061-7701', '(11) 98330-1189', TRUE,  FALSE),
    (p_id, 'Tainá Moreira',   'Assistente de projetos', 'projetos@interioresbianchi.com.br', NULL,        '(11) 97722-0044', FALSE, FALSE);

  INSERT INTO prospeccao_etapas_historico (prospeccao_id, etapa_anterior, etapa_nova, observacao, usuario_id, criado_em)
  VALUES
    (p_id, NULL,         'Novo',        'Indicação da Luciana por cliente antigo', u2, NOW() - INTERVAL '25 days'),
    (p_id, 'Novo',       'Contactado',  'Reunião de apresentação realizada',       u2, NOW() - INTERVAL '20 days'),
    (p_id, 'Contactado', 'Qualificado', 'Orçamento e prazo compatíveis',           u2, NOW() - INTERVAL '11 days');

  INSERT INTO prospeccao_interacoes (prospeccao_id, tipo, data, resumo, detalhe, duracao_min, usuario_id)
  VALUES
    (p_id, 'Ligação',  NOW() - INTERVAL '24 days', 'Primeiro contato',            'Luciana pediu para agendar apresentação presencial.',            15, u2),
    (p_id, 'Reunião',  NOW() - INTERVAL '20 days', 'Apresentação da empresa',     'Reunião no escritório dela. Mostramos linha premium.',           75, u2),
    (p_id, 'E-mail',   NOW() - INTERVAL '16 days', 'Envio de referências',        'Enviadas fotos de três projetos executados no mesmo padrão.',    NULL, u2),
    (p_id, 'Reunião',  NOW() - INTERVAL '11 days', 'Alinhamento de escopo',       'Definido escopo: 4 ambientes. Eduardo entrou para validar verba.', 50, u2),
    (p_id, 'WhatsApp', NOW() - INTERVAL '4 days',  'Cobrança de proposta',        'Luciana perguntou quando recebe a proposta formal.',             NULL, u2);

  INSERT INTO prospeccao_notas (prospeccao_id, titulo, conteudo, usuario_id, criado_em)
  VALUES
    (p_id, 'Perfil do cliente',
     'Trabalham exclusivamente com alto padrão. Preço não é o fator principal, mas prazo é inegociável — já perderam obra por atraso de fornecedor.',
     u2, NOW() - INTERVAL '19 days'),
    (p_id, 'Atenção ao decisor',
     'A Luciana decide o acabamento, mas quem libera a verba é o Eduardo. Toda proposta precisa ir com cópia para ele.',
     u2, NOW() - INTERVAL '10 days');


  -- ======================================================================
  -- 6) QUALIFICADO — Rede Mobili Casa
  -- ======================================================================
  INSERT INTO prospeccoes (
    nome_fantasia, razao_social, cnpj, segmento,
    origem, etapa, valor_estimado, probabilidade, responsavel_id,
    proximo_passo, proximo_passo_data,
    end_logradouro, end_numero, end_bairro, end_cidade, end_uf, end_pais, end_cep,
    anotacoes, criado_por, criado_em
  ) VALUES (
    'Rede Mobili Casa', 'Mobili Casa Comércio de Móveis Ltda', '56.789.012/0001-34', 'Varejo de móveis',
    'Evento', 'Qualificado', 138000.00, 50, u4,
    'Apresentar condição para compra recorrente', CURRENT_DATE + 6,
    'Av. Sete de Setembro', '4900', 'Batel', 'Curitiba', 'Paraná', 'Brasil', '80240-000',
    'Seis lojas no Paraná e duas em Santa Catarina. Interesse em fornecimento contínuo.', u4, NOW() - INTERVAL '18 days'
  ) RETURNING id INTO p_id;

  INSERT INTO prospeccao_contatos (prospeccao_id, nome, cargo, email, telefone_fixo, telefone_celular, decisor, principal)
  VALUES
    (p_id, 'Fernando Kliemann', 'Diretor comercial',    'fernando@mobilicasa.com.br', '(41) 3016-2200', '(41) 99655-8877', TRUE,  TRUE),
    (p_id, 'Aline Zanotto',     'Compradora sênior',    'aline.compras@mobilicasa.com.br', '(41) 3016-2210', '(41) 99655-8812', FALSE, FALSE);

  INSERT INTO prospeccao_etapas_historico (prospeccao_id, etapa_anterior, etapa_nova, observacao, usuario_id, criado_em)
  VALUES
    (p_id, NULL,         'Novo',        'Contato feito em feira do setor', u4, NOW() - INTERVAL '18 days'),
    (p_id, 'Novo',       'Contactado',  'Reunião online realizada',        u4, NOW() - INTERVAL '14 days'),
    (p_id, 'Contactado', 'Qualificado', 'Volume e recorrência confirmados', u4, NOW() - INTERVAL '7 days');

  INSERT INTO prospeccao_interacoes (prospeccao_id, tipo, data, resumo, detalhe, duracao_min, usuario_id)
  VALUES
    (p_id, 'Visita',  NOW() - INTERVAL '18 days', 'Feira Movelsul',        'Conversa no estande. Fernando pediu contato posterior.',      25, u4),
    (p_id, 'Reunião', NOW() - INTERVAL '14 days', 'Reunião online',        'Apresentamos capacidade produtiva e prazos médios.',           45, u4),
    (p_id, 'E-mail',  NOW() - INTERVAL '7 days',  'Volumes estimados',     'Aline enviou planilha com previsão trimestral por loja.',      NULL, u4);

  INSERT INTO prospeccao_campanhas (prospeccao_id, nome, canal, status, data_envio, resposta, usuario_id)
  VALUES
    (p_id, 'Movelsul — pós-feira',       'E-mail',   'Concluída',    CURRENT_DATE - 16, 'Respondeu',   u4),
    (p_id, 'Condição parceiro regional', 'E-mail',   'Em andamento', CURRENT_DATE - 3,  'Sem resposta', u4);


  -- ======================================================================
  -- 7) PROPOSTA — Incorporadora Terra Nova
  -- ======================================================================
  INSERT INTO prospeccoes (
    nome_fantasia, razao_social, cnpj, inscricao_estadual, site, segmento,
    origem, etapa, valor_estimado, probabilidade, responsavel_id,
    proximo_passo, proximo_passo_data,
    end_logradouro, end_numero, end_bairro, end_cidade, end_uf, end_pais, end_cep,
    anotacoes, criado_por, criado_em
  ) VALUES (
    'Incorporadora Terra Nova', 'Terra Nova Incorporações S.A.', '67.890.123/0001-45', '073.556.221.009',
    'https://terranovainc.com.br', 'Incorporação imobiliária',
    'Indicação', 'Proposta', 320000.00, 65, u1,
    'Reunião de defesa da proposta com o conselho', CURRENT_DATE + 2,
    'SCS Quadra 2 Bloco C', '80', 'Asa Sul', 'Brasília', 'Distrito Federal', 'Brasil', '70302-000',
    'Maior oportunidade em aberto. Proposta entregue, aguardando conselho.', u1, NOW() - INTERVAL '40 days'
  ) RETURNING id INTO p_id;

  INSERT INTO prospeccao_contatos (prospeccao_id, nome, cargo, email, telefone_fixo, telefone_celular, decisor, principal)
  VALUES
    (p_id, 'Ricardo Mourão',  'Diretor de Incorporação', 'ricardo.mourao@terranovainc.com.br', '(61) 3040-9900', '(61) 98211-3344', TRUE,  TRUE),
    (p_id, 'Juliana Peixoto', 'Gerente de Suprimentos',  'juliana.peixoto@terranovainc.com.br', '(61) 3040-9912', '(61) 98211-3390', FALSE, FALSE),
    (p_id, 'Otávio Serra',    'Controladoria',           'otavio.serra@terranovainc.com.br',    '(61) 3040-9950', NULL,              FALSE, FALSE);

  INSERT INTO prospeccao_etapas_historico (prospeccao_id, etapa_anterior, etapa_nova, observacao, usuario_id, criado_em)
  VALUES
    (p_id, NULL,          'Novo',        'Indicação de escritório parceiro',   u1, NOW() - INTERVAL '40 days'),
    (p_id, 'Novo',        'Contactado',  'Primeira reunião realizada',         u1, NOW() - INTERVAL '34 days'),
    (p_id, 'Contactado',  'Qualificado', 'Escopo e verba confirmados',         u1, NOW() - INTERVAL '22 days'),
    (p_id, 'Qualificado', 'Proposta',    'Proposta formal protocolada',        u1, NOW() - INTERVAL '8 days');

  INSERT INTO prospeccao_interacoes (prospeccao_id, tipo, data, resumo, detalhe, duracao_min, usuario_id)
  VALUES
    (p_id, 'Ligação',  NOW() - INTERVAL '39 days', 'Contato inicial',            'Ricardo confirmou interesse em conhecer a linha completa.',          20, u1),
    (p_id, 'Reunião',  NOW() - INTERVAL '34 days', 'Apresentação institucional', 'Reunião na sede. Presentes Ricardo e Juliana.',                      90, u1),
    (p_id, 'Visita',   NOW() - INTERVAL '27 days', 'Visita à nossa fábrica',     'Ricardo e Otávio conheceram o processo de laminação.',              180, u1),
    (p_id, 'E-mail',   NOW() - INTERVAL '22 days', 'Memorial descritivo',        'Juliana enviou memorial das três torres para dimensionamento.',      NULL, u1),
    (p_id, 'Proposta', NOW() - INTERVAL '8 days',  'Proposta formal entregue',   'Proposta de R$ 320.000 em três lotes de entrega. Validade de 30 dias.', NULL, u1),
    (p_id, 'Ligação',  NOW() - INTERVAL '2 days',  'Acompanhamento da proposta', 'Ricardo informou que o conselho analisa na próxima terça.',          12, u1);

  INSERT INTO prospeccao_notas (prospeccao_id, titulo, conteudo, usuario_id, criado_em)
  VALUES
    (p_id, 'Concorrência',
     'Estamos concorrendo com dois fornecedores de São Paulo. O diferencial que pesou na visita à fábrica foi o prazo de laminação.',
     u1, NOW() - INTERVAL '26 days'),
    (p_id, 'Condição de pagamento',
     'Otávio sinalizou preferência por pagamento em três parcelas atreladas às entregas. Já contemplado na proposta.',
     u1, NOW() - INTERVAL '9 days');

  INSERT INTO prospeccao_campanhas (prospeccao_id, nome, canal, status, data_envio, resposta, usuario_id)
  VALUES (p_id, 'Portfólio corporativo 2026', 'E-mail', 'Concluída', CURRENT_DATE - 30, 'Reunião agendada', u1);


  -- ======================================================================
  -- 8) NEGOCIAÇÃO — Grupo Solar Empreendimentos
  -- ======================================================================
  INSERT INTO prospeccoes (
    nome_fantasia, razao_social, cnpj, segmento,
    origem, etapa, valor_estimado, probabilidade, responsavel_id,
    proximo_passo, proximo_passo_data,
    end_logradouro, end_numero, end_bairro, end_cidade, end_uf, end_pais, end_cep,
    anotacoes, criado_por, criado_em
  ) VALUES (
    'Grupo Solar Empreendimentos', 'Solar Empreendimentos e Participações Ltda', '78.901.234/0001-56', 'Empreendimentos',
    'Website', 'Negociação', 210000.00, 80, u3,
    'Fechar desconto final e emitir contrato', CURRENT_DATE + 1,
    'Av. Tancredo Neves', '1250', 'Caminho das Árvores', 'Salvador', 'Bahia', 'Brasil', '41820-021',
    'Negociação avançada. Divergência apenas no prazo de pagamento.', u3, NOW() - INTERVAL '55 days'
  ) RETURNING id INTO p_id;

  INSERT INTO prospeccao_contatos (prospeccao_id, nome, cargo, email, telefone_fixo, telefone_celular, decisor, principal)
  VALUES
    (p_id, 'Camila Andrade', 'Sócia-diretora',   'camila@gruposolar.com.br',  '(71) 3450-6600', '(71) 99188-2200', TRUE,  TRUE),
    (p_id, 'Diego Farias',   'Gerente de obras', 'diego.farias@gruposolar.com.br', '(71) 3450-6620', '(71) 99188-2255', FALSE, FALSE);

  INSERT INTO prospeccao_etapas_historico (prospeccao_id, etapa_anterior, etapa_nova, observacao, usuario_id, criado_em)
  VALUES
    (p_id, NULL,          'Novo',        'Contato pelo site',                 u3, NOW() - INTERVAL '55 days'),
    (p_id, 'Novo',        'Contactado',  'Ligação de qualificação',           u3, NOW() - INTERVAL '50 days'),
    (p_id, 'Contactado',  'Qualificado', 'Projeto e verba confirmados',       u3, NOW() - INTERVAL '38 days'),
    (p_id, 'Qualificado', 'Proposta',    'Proposta enviada',                  u3, NOW() - INTERVAL '20 days'),
    (p_id, 'Proposta',    'Negociação',  'Camila pediu revisão do parcelamento', u3, NOW() - INTERVAL '6 days');

  INSERT INTO prospeccao_interacoes (prospeccao_id, tipo, data, resumo, detalhe, duracao_min, usuario_id)
  VALUES
    (p_id, 'E-mail',   NOW() - INTERVAL '55 days', 'Contato pelo site',           'Solicitação de orçamento para empreendimento residencial.',    NULL, u3),
    (p_id, 'Reunião',  NOW() - INTERVAL '50 days', 'Reunião de qualificação',     'Camila detalhou o projeto: 2 torres, entrega em 14 meses.',      60, u3),
    (p_id, 'Proposta', NOW() - INTERVAL '20 days', 'Proposta enviada',            'R$ 210.000 com entrega em quatro lotes.',                       NULL, u3),
    (p_id, 'Reunião',  NOW() - INTERVAL '6 days',  'Rodada de negociação',        'Camila pediu 5% de desconto ou prazo maior. Levamos para análise.', 55, u3),
    (p_id, 'WhatsApp', NOW() - INTERVAL '1 day',   'Sinalização de fechamento',   'Camila avisou que fecha se mantivermos o prazo de 90 dias.',     NULL, u3);

  INSERT INTO prospeccao_notas (prospeccao_id, titulo, conteudo, usuario_id, criado_em)
  VALUES (p_id, 'Margem de negociação',
          'Limite aprovado pela diretoria: até 4% de desconto OU prazo de 90 dias, nunca os dois. Camila já sabe do teto.',
          u3, NOW() - INTERVAL '5 days');


  -- ======================================================================
  -- 9) GANHO — Escritório Habitat Design  (convertida e arquivada)
  -- ======================================================================
  INSERT INTO prospeccoes (
    nome_fantasia, razao_social, cnpj, inscricao_estadual, segmento,
    origem, etapa, valor_estimado, probabilidade, responsavel_id,
    end_logradouro, end_numero, end_bairro, end_cidade, end_uf, end_pais, end_cep,
    status, cliente_id, convertida_em,
    anotacoes, criado_por, criado_em
  ) VALUES (
    'Escritório Habitat Design', 'Habitat Design e Projetos Ltda', '89.012.345/0001-67', '114.887.226.330', 'Design de interiores',
    'Indicação', 'Ganho', 96000.00, 100, u2,
    'Rua Fidalga', '470', 'Vila Madalena', 'São Paulo', 'São Paulo', 'Brasil', '05432-070',
    'arquivada', v_cliente, NOW() - INTERVAL '5 days',
    'Negócio fechado. Convertido em cliente — primeira ordem já emitida.', u2, NOW() - INTERVAL '70 days'
  ) RETURNING id INTO p_id;

  INSERT INTO prospeccao_contatos (prospeccao_id, nome, cargo, email, telefone_fixo, telefone_celular, decisor, principal)
  VALUES
    (p_id, 'Renata Villaça', 'Sócia-fundadora',    'renata@habitatdesign.com.br', '(11) 3812-4400', '(11) 98120-7766', TRUE,  TRUE),
    (p_id, 'Paulo Menezes',  'Gerente de projetos', 'paulo@habitatdesign.com.br',  '(11) 3812-4410', '(11) 98120-7712', FALSE, FALSE);

  INSERT INTO prospeccao_etapas_historico (prospeccao_id, etapa_anterior, etapa_nova, observacao, usuario_id, criado_em)
  VALUES
    (p_id, NULL,          'Novo',        'Indicação de arquiteta parceira', u2, NOW() - INTERVAL '70 days'),
    (p_id, 'Novo',        'Contactado',  'Primeira reunião',                u2, NOW() - INTERVAL '64 days'),
    (p_id, 'Contactado',  'Qualificado', 'Escopo fechado',                  u2, NOW() - INTERVAL '48 days'),
    (p_id, 'Qualificado', 'Proposta',    'Proposta enviada',                u2, NOW() - INTERVAL '30 days'),
    (p_id, 'Proposta',    'Negociação',  'Ajuste de prazo',                 u2, NOW() - INTERVAL '15 days'),
    (p_id, 'Negociação',  'Ganho',       'Contrato assinado',               u2, NOW() - INTERVAL '5 days');

  INSERT INTO prospeccao_interacoes (prospeccao_id, tipo, data, resumo, detalhe, duracao_min, usuario_id)
  VALUES
    (p_id, 'Reunião',  NOW() - INTERVAL '64 days', 'Apresentação inicial',   'Renata gostou da linha de laminados foscos.',            70, u2),
    (p_id, 'Proposta', NOW() - INTERVAL '30 days', 'Proposta enviada',       'R$ 96.000 com entrega em dois lotes.',                  NULL, u2),
    (p_id, 'Reunião',  NOW() - INTERVAL '15 days', 'Negociação de prazo',    'Acordado prazo de 75 dias para o primeiro lote.',        40, u2),
    (p_id, 'Nota',     NOW() - INTERVAL '5 days',  'Contrato assinado',      'Renata assinou. Prospecção convertida em cliente.',      NULL, u2);

  INSERT INTO prospeccao_notas (prospeccao_id, titulo, conteudo, usuario_id, criado_em)
  VALUES (p_id, 'O que fechou o negócio',
          'A visita à fábrica foi decisiva. Vale repetir a tática com prospecções de perfil parecido.',
          u2, NOW() - INTERVAL '4 days');


  -- ======================================================================
  -- 10) PERDIDO — Decorações Primavera
  -- ======================================================================
  INSERT INTO prospeccoes (
    nome_fantasia, razao_social, cnpj, segmento,
    origem, etapa, valor_estimado, probabilidade, responsavel_id,
    end_logradouro, end_numero, end_bairro, end_cidade, end_uf, end_pais, end_cep,
    status, motivo_perda,
    anotacoes, criado_por, criado_em
  ) VALUES (
    'Decorações Primavera', 'Primavera Decorações e Presentes Ltda', '90.123.456/0001-78', 'Varejo de decoração',
    'Redes Sociais', 'Perdido', 32000.00, 0, u4,
    'Rua dos Andradas', '1234', 'Centro Histórico', 'Porto Alegre', 'Rio Grande do Sul', 'Brasil', '90020-008',
    'arquivada', 'Preço acima do orçamento do cliente — fechou com concorrente regional.',
    'Perdemos por preço. Vale reabordar no próximo ciclo de compras.', u4, NOW() - INTERVAL '60 days'
  ) RETURNING id INTO p_id;

  INSERT INTO prospeccao_contatos (prospeccao_id, nome, cargo, email, telefone_celular, decisor, principal)
  VALUES (p_id, 'Sandra Kroeff', 'Proprietária', 'sandra@decoracoesprimavera.com.br', '(51) 99744-3300', TRUE, TRUE);

  INSERT INTO prospeccao_etapas_historico (prospeccao_id, etapa_anterior, etapa_nova, observacao, usuario_id, criado_em)
  VALUES
    (p_id, NULL,          'Novo',        'Lead do Instagram',              u4, NOW() - INTERVAL '60 days'),
    (p_id, 'Novo',        'Contactado',  'Ligação atendida',               u4, NOW() - INTERVAL '55 days'),
    (p_id, 'Contactado',  'Qualificado', 'Necessidade confirmada',         u4, NOW() - INTERVAL '45 days'),
    (p_id, 'Qualificado', 'Proposta',    'Proposta enviada',               u4, NOW() - INTERVAL '35 days'),
    (p_id, 'Proposta',    'Perdido',     'Cliente optou pelo concorrente', u4, NOW() - INTERVAL '21 days');

  INSERT INTO prospeccao_interacoes (prospeccao_id, tipo, data, resumo, detalhe, duracao_min, usuario_id)
  VALUES
    (p_id, 'Ligação',  NOW() - INTERVAL '55 days', 'Qualificação',        'Sandra confirmou interesse para a coleção de fim de ano.', 18, u4),
    (p_id, 'Proposta', NOW() - INTERVAL '35 days', 'Proposta enviada',    'R$ 32.000 para o mix completo.',                          NULL, u4),
    (p_id, 'E-mail',   NOW() - INTERVAL '21 days', 'Resposta negativa',   'Sandra informou que fechou com fornecedor de Caxias por preço.', NULL, u4);

  INSERT INTO prospeccao_notas (prospeccao_id, titulo, conteudo, usuario_id, criado_em)
  VALUES (p_id, 'Motivo da perda',
          'Diferença de aproximadamente 18% em relação ao concorrente. Reabordar em janeiro, quando refazem o mix.',
          u4, NOW() - INTERVAL '20 days');


  RAISE NOTICE 'Amostra inserida: 10 prospecções, 21 contatos, 32 interações, 32 movimentações de etapa, 7 notas e 4 campanhas.';
END$$;

COMMIT;

-- ============================================================================
--  Conferência — rode depois do COMMIT:
--
--    SELECT etapa, COUNT(*) AS qtd, SUM(valor_estimado) AS valor
--      FROM prospeccoes
--     GROUP BY etapa
--     ORDER BY CASE etapa
--                WHEN 'Novo' THEN 1 WHEN 'Contactado' THEN 2
--                WHEN 'Qualificado' THEN 3 WHEN 'Proposta' THEN 4
--                WHEN 'Negociação' THEN 5 WHEN 'Ganho' THEN 6 ELSE 7 END;
--
--  Esperado: Novo 2 · Contactado 2 · Qualificado 2 · Proposta 1 ·
--            Negociação 1 · Ganho 1 · Perdido 1
--
-- ----------------------------------------------------------------------------
--  REMOVER A AMOSTRA (as tabelas filhas caem junto por ON DELETE CASCADE):
--
--    DELETE FROM prospeccoes WHERE nome_fantasia IN (
--      'Marmoraria Vitória', 'Studio Lumina Arquitetura', 'Construtora Alvorada',
--      'Hotel Costa Serena', 'Interiores Bianchi', 'Rede Mobili Casa',
--      'Incorporadora Terra Nova', 'Grupo Solar Empreendimentos',
--      'Escritório Habitat Design', 'Decorações Primavera'
--    );
-- ============================================================================
