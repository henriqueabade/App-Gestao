-- ============================================================================
--  Prospecções fictícias — massa extra para teste
--
--  Complementa `prospeccoes_seed.sql` com mais 12 empresas, espalhadas por
--  todas as etapas do funil, com contatos, interações, notas e campanhas.
--
--  Escrito para poder rodar MAIS DE UMA VEZ sem duplicar: cada empresa é
--  identificada pelo CNPJ, e o bloco inteiro só insere o que ainda não existe.
--
--  As datas são RELATIVAS (`now() - interval`), então a massa nunca fica
--  velha: o "próximo passo atrasado" continua atrasado daqui a seis meses.
--
--  Aplicar com:
--      psql -h <host> -U <usuario> -d <banco> -f prospeccoes_seed_extra.sql
-- ============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1) As empresas
--
--    `responsavel_id` e `criado_por` apontam para o MENOR id de usuário
--    existente — a massa não pode presumir que o usuário 1 existe no seu banco.
-- ---------------------------------------------------------------------------
INSERT INTO prospeccoes (
  nome_fantasia, razao_social, cnpj, inscricao_estadual, site, segmento, origem,
  etapa, valor_estimado, probabilidade, responsavel_id,
  proximo_passo, proximo_passo_data,
  end_logradouro, end_numero, end_bairro, end_cidade, end_uf, end_pais, end_cep,
  status, motivo_perda, anotacoes, criado_por, criado_em, atualizado_em
)
SELECT v.* FROM (VALUES
  ('Villa Móveis Finos', 'Villa Comercio de Moveis Ltda', '31.402.885/0001-04', '110.482.339', 'villamoveis.com.br', 'Móveis planejados', 'Indicação',
   'Novo', 42000.00, 10, NULL,
   'Ligar para apresentar o catálogo', (CURRENT_DATE + 2)::date,
   'Rua das Acácias', '210', 'Jardim Europa', 'São Paulo', 'SP', 'Brasil', '01449-000',
   'ativa', NULL, 'Indicada pela Marmoraria Vitória. Compram por temporada.', NULL, now() - interval '3 days', now() - interval '3 days'),

  ('Atelier Nord', 'Nord Arquitetura e Interiores ME', '22.917.630/0001-58', 'ISENTO', 'ateliernord.com.br', 'Arquitetura', 'Redes Sociais',
   'Contactado', 68000.00, 25, NULL,
   'Enviar portfólio de bancadas', (CURRENT_DATE + 5)::date,
   'Avenida Beira Mar', '1450', 'Centro', 'Florianópolis', 'SC', 'Brasil', '88015-600',
   'ativa', NULL, 'Responderam pelo Instagram. Trabalham com alto padrão.', NULL, now() - interval '9 days', now() - interval '2 days'),

  ('Construtora Pilar', 'Pilar Engenharia e Construcoes S.A.', '48.115.209/0001-72', '221.905.774', 'construtorapilar.com.br', 'Construção civil', 'Evento',
   'Qualificado', 310000.00, 50, NULL,
   'Agendar visita ao canteiro', (CURRENT_DATE - 1)::date,
   'Rodovia BR-101', 'km 42', 'Distrito Industrial', 'Joinville', 'SC', 'Brasil', '89219-500',
   'ativa', NULL, 'Três torres previstas para o ano que vem. Decisão passa pelo engenheiro.', NULL, now() - interval '22 days', now() - interval '1 day'),

  ('Casa Bonita Decorações', 'Casa Bonita Comercio de Decoracoes Ltda', '17.338.940/0001-16', '086.774.211', NULL, 'Decoração', 'Website',
   'Proposta', 95000.00, 65, NULL,
   'Revisar proposta com o desconto aprovado', (CURRENT_DATE + 1)::date,
   'Rua XV de Novembro', '870', 'Centro', 'Curitiba', 'PR', 'Brasil', '80020-310',
   'ativa', NULL, NULL, NULL, now() - interval '31 days', now() - interval '4 days'),

  ('Grupo Sertão Hotelaria', 'Sertao Participacoes Hoteleiras Ltda', '55.720.183/0001-90', '134.882.006', 'gruposertao.com.br', 'Hotelaria', 'Indicação',
   'Negociação', 480000.00, 80, NULL,
   'Fechar condição de pagamento em 6x', (CURRENT_DATE + 3)::date,
   'Avenida Governador Argemiro', '55', 'Praia do Forte', 'Salvador', 'BA', 'Brasil', '41680-090',
   'ativa', NULL, 'Reforma de 40 apartamentos. Prazo é o fator decisivo, não o preço.', NULL, now() - interval '54 days', now() - interval '1 day'),

  ('Marcenaria Ipê', 'Ipe Marcenaria Artesanal ME', '90.664.271/0001-33', 'ISENTO', NULL, 'Marcenaria', 'Feira',
   'Novo', 18500.00, 10, NULL,
   NULL, NULL,
   'Rua dos Marceneiros', '77', 'Vila Industrial', 'Campinas', 'SP', 'Brasil', '13035-420',
   'ativa', NULL, 'Contato de feira, ainda sem CNPJ confirmado na conversa.', NULL, now() - interval '6 days', now() - interval '6 days'),

  ('Loft Urbano', 'Loft Urbano Empreendimentos Imobiliarios Ltda', '63.851.472/0001-27', '199.043.558', 'lofturbano.com.br', 'Incorporação', 'Website',
   'Contactado', 220000.00, 25, NULL,
   'Retomar contato depois do feriado', (CURRENT_DATE + 9)::date,
   'Alameda Santos', '2100', 'Cerqueira César', 'São Paulo', 'SP', 'Brasil', '01418-200',
   'ativa', NULL, NULL, NULL, now() - interval '14 days', now() - interval '5 days'),

  ('Espaço Zen Wellness', 'Zen Bem Estar e Servicos Ltda', '38.204.916/0001-45', '077.331.902', NULL, 'Bem-estar', 'Redes Sociais',
   'Qualificado', 57000.00, 50, NULL,
   'Enviar amostra de acabamento', (CURRENT_DATE - 4)::date,
   'Rua Amauri', '305', 'Itaim Bibi', 'São Paulo', 'SP', 'Brasil', '01448-000',
   'ativa', NULL, 'Pediram amostra física antes de decidir.', NULL, now() - interval '19 days', now() - interval '4 days'),

  ('Rede Sabor & Arte', 'Sabor e Arte Restaurantes Ltda', '74.019.638/0001-81', '245.117.330', 'saborearte.com.br', 'Alimentação', 'Indicação',
   'Proposta', 132000.00, 65, NULL,
   'Cobrar retorno da proposta enviada', (CURRENT_DATE - 8)::date,
   'Rua da Praia', '1200', 'Centro Histórico', 'Porto Alegre', 'RS', 'Brasil', '90010-190',
   'ativa', NULL, 'Cinco unidades. Querem padronizar o mobiliário de todas.', NULL, now() - interval '40 days', now() - interval '8 days'),

  ('Studio Clara Luz', 'Clara Luz Design de Interiores ME', '11.586.703/0001-69', 'ISENTO', NULL, 'Design de interiores', 'Evento',
   'Ganho', 76000.00, 100, NULL,
   NULL, NULL,
   'Rua Fernandes Tourinho', '470', 'Savassi', 'Belo Horizonte', 'MG', 'Brasil', '30112-000',
   'ativa', NULL, 'Fechado na feira. Falta emitir a proposta formal.', NULL, now() - interval '61 days', now() - interval '7 days'),

  ('Alvorada Corporate', 'Alvorada Servicos Corporativos S.A.', '29.473.150/0001-08', '156.220.774', 'alvoradacorp.com.br', 'Corporativo', 'Website',
   'Perdido', 260000.00, 0, NULL,
   NULL, NULL,
   'Setor Comercial Sul', 'Quadra 2', 'Asa Sul', 'Brasília', 'DF', 'Brasil', '70302-000',
   'arquivada', 'Escolheram concorrente com prazo menor', 'Perdemos por prazo de entrega, não por preço.', NULL, now() - interval '88 days', now() - interval '30 days'),

  ('Bistrô da Esquina', 'Esquina Gastronomia Ltda ME', '84.330.297/0001-51', 'ISENTO', NULL, 'Alimentação', 'Feira',
   'Perdido', 24000.00, 0, NULL,
   NULL, NULL,
   'Rua Bela Cintra', '88', 'Consolação', 'São Paulo', 'SP', 'Brasil', '01415-000',
   'arquivada', 'Sem verba no exercício', NULL, NULL, now() - interval '70 days', now() - interval '45 days')
) AS v(nome_fantasia, razao_social, cnpj, inscricao_estadual, site, segmento, origem,
       etapa, valor_estimado, probabilidade, responsavel_id,
       proximo_passo, proximo_passo_data,
       end_logradouro, end_numero, end_bairro, end_cidade, end_uf, end_pais, end_cep,
       status, motivo_perda, anotacoes, criado_por, criado_em, atualizado_em)
WHERE NOT EXISTS (SELECT 1 FROM prospeccoes p WHERE p.cnpj = v.cnpj);

-- Responsável e autor: o menor id de usuário que existir neste banco.
UPDATE prospeccoes
   SET responsavel_id = (SELECT MIN(id) FROM usuarios),
       criado_por     = (SELECT MIN(id) FROM usuarios)
 WHERE responsavel_id IS NULL
   AND cnpj IN ('31.402.885/0001-04','22.917.630/0001-58','48.115.209/0001-72',
                '17.338.940/0001-16','55.720.183/0001-90','90.664.271/0001-33',
                '63.851.472/0001-27','38.204.916/0001-45','74.019.638/0001-81',
                '11.586.703/0001-69','29.473.150/0001-08','84.330.297/0001-51');

-- ---------------------------------------------------------------------------
-- 2) Contatos
--
--    Um principal por empresa (o índice único parcial exige), e alguns
--    secundários para exercitar a troca de principal e o popover (i).
-- ---------------------------------------------------------------------------
INSERT INTO prospeccao_contatos
  (prospeccao_id, nome, cargo, email, telefone_fixo, telefone_celular, decisor, principal, observacao)
SELECT p.id, v.nome, v.cargo, v.email, v.fixo, v.celular, v.decisor, v.principal, v.obs
  FROM (VALUES
  ('31.402.885/0001-04', 'Renata Villa',      'Sócia-proprietária', 'renata@villamoveis.com.br',   '(11) 3255-4100', '(11) 98811-2233', TRUE,  TRUE,  'Prefere contato pela manhã.'),
  ('22.917.630/0001-58', 'Otávio Nord',       'Arquiteto titular',  'otavio@ateliernord.com.br',   '(48) 3025-7788', '(48) 99120-4455', TRUE,  TRUE,  NULL),
  ('22.917.630/0001-58', 'Bianca Rocha',      'Assistente',         'bianca@ateliernord.com.br',   '(48) 3025-7789', NULL,              FALSE, FALSE, 'Quem organiza a agenda do Otávio.'),
  ('48.115.209/0001-72', 'Eng. Marcos Pilar', 'Diretor de obras',   'marcos@construtorapilar.com.br','(47) 3441-9000','(47) 99833-1100', TRUE,  TRUE,  'Decide tecnicamente — compras homologa.'),
  ('48.115.209/0001-72', 'Priscila Amaral',   'Compras',            'compras@construtorapilar.com.br','(47) 3441-9012',NULL,            FALSE, FALSE, NULL),
  ('17.338.940/0001-16', 'Sandra Bonita',     'Proprietária',       'sandra@casabonita.com.br',    '(41) 3232-1177', '(41) 99745-8080', TRUE,  TRUE,  NULL),
  ('55.720.183/0001-90', 'Iara Menezes',      'Gerente de projetos','iara@gruposertao.com.br',     '(71) 3021-6600', '(71) 98122-3344', FALSE, TRUE,  'Interlocutora do dia a dia.'),
  ('55.720.183/0001-90', 'Dr. Aurélio Sertão','Diretor-geral',      'diretoria@gruposertao.com.br', NULL,            '(71) 99600-1212', TRUE,  FALSE, 'Só entra na assinatura.'),
  ('90.664.271/0001-33', 'Jorge Ipê',         'Marceneiro-chefe',   NULL,                          NULL,             '(19) 99444-7766', TRUE,  TRUE,  'Só WhatsApp.'),
  ('63.851.472/0001-27', 'Camila Duarte',     'Coordenadora',       'camila@lofturbano.com.br',    '(11) 3061-2200', '(11) 98070-5511', FALSE, TRUE,  NULL),
  ('38.204.916/0001-45', 'Thaís Nakamura',    'Sócia',              'thais@espacozen.com.br',      NULL,             '(11) 99233-6677', TRUE,  TRUE,  NULL),
  ('74.019.638/0001-81', 'Fernando Sabor',    'Sócio-diretor',      'fernando@saborearte.com.br',  '(51) 3019-4400', '(51) 99188-2200', TRUE,  TRUE,  'Responde melhor à noite.'),
  ('11.586.703/0001-69', 'Clara Luz',         'Titular',            'clara@claraluz.com.br',       NULL,             '(31) 99777-1010', TRUE,  TRUE,  NULL),
  ('29.473.150/0001-08', 'Paulo Andrade',     'Facilities',         'paulo@alvoradacorp.com.br',   '(61) 3322-8800', NULL,              FALSE, TRUE,  NULL),
  ('84.330.297/0001-51', 'Marina Esquina',    'Proprietária',       NULL,                          NULL,             '(11) 99512-3131', TRUE,  TRUE,  NULL)
) AS v(cnpj, nome, cargo, email, fixo, celular, decisor, principal, obs)
  JOIN prospeccoes p ON p.cnpj = v.cnpj
 WHERE NOT EXISTS (
   SELECT 1 FROM prospeccao_contatos c
    WHERE c.prospeccao_id = p.id AND c.nome = v.nome
 );

-- ---------------------------------------------------------------------------
-- 3) Interações — a timeline de cada uma
-- ---------------------------------------------------------------------------
INSERT INTO prospeccao_interacoes
  (prospeccao_id, contato_id, tipo, data, resumo, detalhe, duracao_min, usuario_id)
SELECT p.id,
       (SELECT c.id FROM prospeccao_contatos c
         WHERE c.prospeccao_id = p.id AND c.principal ORDER BY c.id LIMIT 1),
       v.tipo, now() - (v.dias * INTERVAL '1 day'), v.resumo, v.detalhe, v.duracao,
       (SELECT MIN(id) FROM usuarios)
  FROM (VALUES
  ('31.402.885/0001-04', 'Ligação',  3,  'Primeiro contato',            'Renata pediu para mandar o catálogo por e-mail.', 12),
  ('22.917.630/0001-58', 'E-mail',   9,  'Apresentação da empresa',     'Enviado material institucional.',                 NULL),
  ('22.917.630/0001-58', 'WhatsApp', 2,  'Retorno do Otávio',           'Gostou da linha premium, pediu portfólio.',       NULL),
  ('48.115.209/0001-72', 'Reunião',  20, 'Reunião técnica',             'Levantamento de 3 torres. Marcos definiu o padrão.', 90),
  ('48.115.209/0001-72', 'E-mail',   6,  'Envio de especificações',     'Planilha de acabamentos por pavimento.',          NULL),
  ('17.338.940/0001-16', 'Visita',   28, 'Visita à loja',               'Sandra mostrou o espaço e o público dela.',       60),
  ('17.338.940/0001-16', 'Proposta', 12, 'Proposta enviada',            'Primeira versão, sem desconto especial.',         NULL),
  ('55.720.183/0001-90', 'Reunião',  50, 'Kick-off do projeto',         'Escopo dos 40 apartamentos.',                     120),
  ('55.720.183/0001-90', 'Ligação',  4,  'Negociação de prazo',         'Iara reforçou que o prazo é inegociável.',        25),
  ('63.851.472/0001-27', 'E-mail',   14, 'Contato inicial pelo site',   'Camila preencheu o formulário do site.',          NULL),
  ('38.204.916/0001-45', 'Reunião',  18, 'Apresentação presencial',     'Thaís pediu amostra física do acabamento.',       45),
  ('74.019.638/0001-81', 'Proposta', 30, 'Proposta das 5 unidades',     'Enviada com condição de 4x.',                     NULL),
  ('74.019.638/0001-81', 'WhatsApp', 8,  'Cobrança de retorno',         'Fernando pediu mais uma semana.',                 NULL),
  ('11.586.703/0001-69', 'Reunião',  60, 'Fechamento na feira',         'Clara fechou no estande.',                        40),
  ('29.473.150/0001-08', 'Ligação',  35, 'Retorno negativo',            'Escolheram o concorrente pelo prazo.',            15)
) AS v(cnpj, tipo, dias, resumo, detalhe, duracao)
  JOIN prospeccoes p ON p.cnpj = v.cnpj
 WHERE NOT EXISTS (
   SELECT 1 FROM prospeccao_interacoes i
    WHERE i.prospeccao_id = p.id AND i.resumo = v.resumo
 );

-- ---------------------------------------------------------------------------
-- 4) Notas
-- ---------------------------------------------------------------------------
INSERT INTO prospeccao_notas (prospeccao_id, titulo, conteudo, usuario_id, criado_em)
SELECT p.id, v.titulo, v.conteudo, (SELECT MIN(id) FROM usuarios), now() - (v.dias * INTERVAL '1 day')
  FROM (VALUES
  ('48.115.209/0001-72', 'Quem decide',      'Marcos aprova tecnicamente, mas a ordem de compra sai da Priscila.', 20),
  ('55.720.183/0001-90', 'Prazo acima de tudo', 'Já perderam temporada por atraso de fornecedor. Prazo pesa mais que preço.', 50),
  ('74.019.638/0001-81', 'Padronização',     'Querem o mesmo mobiliário nas 5 unidades, para repor peça a peça depois.', 30),
  ('29.473.150/0001-08', 'Aprendizado',      'Perdemos por prazo. Vale revisar a capacidade antes de orçar obra grande.', 30)
) AS v(cnpj, titulo, conteudo, dias)
  JOIN prospeccoes p ON p.cnpj = v.cnpj
 WHERE NOT EXISTS (
   SELECT 1 FROM prospeccao_notas n
    WHERE n.prospeccao_id = p.id AND n.titulo = v.titulo
 );

-- ---------------------------------------------------------------------------
-- 5) Campanhas
-- ---------------------------------------------------------------------------
INSERT INTO prospeccao_campanhas
  (prospeccao_id, nome, canal, status, data_envio, resposta, observacao, usuario_id)
SELECT p.id, v.nome, v.canal, v.status, (CURRENT_DATE - v.dias)::date, v.resposta, v.obs,
       (SELECT MIN(id) FROM usuarios)
  FROM (VALUES
  ('31.402.885/0001-04', 'Catálogo Primavera',   'E-mail',        'Concluída',    5,  'Abriu, não respondeu', NULL),
  ('22.917.630/0001-58', 'Lançamento Linha Nord','Redes Sociais', 'Em andamento', 2,  NULL,                   'Campanha segmentada para arquitetos.'),
  ('63.851.472/0001-27', 'Newsletter Julho',     'E-mail',        'Concluída',    12, 'Sem retorno',          NULL),
  ('74.019.638/0001-81', 'Follow-up Proposta',   'WhatsApp',      'Planejada',    0,  NULL,                   'Disparar se não houver retorno até sexta.')
) AS v(cnpj, nome, canal, status, dias, resposta, obs)
  JOIN prospeccoes p ON p.cnpj = v.cnpj
 WHERE NOT EXISTS (
   SELECT 1 FROM prospeccao_campanhas c
    WHERE c.prospeccao_id = p.id AND c.nome = v.nome
 );

COMMIT;

-- ============================================================================
--  Conferência rápida — rode depois do COMMIT:
--
--    SELECT etapa, status, COUNT(*)
--      FROM prospeccoes
--     GROUP BY etapa, status
--     ORDER BY etapa;
--
--    Esperado: as 12 novas espalhadas por Novo, Contactado, Qualificado,
--    Proposta, Negociação, Ganho e Perdido — mais o que já existia.
--
--    SELECT p.nome_fantasia,
--           COUNT(DISTINCT c.id)  AS contatos,
--           COUNT(DISTINCT i.id)  AS interacoes
--      FROM prospeccoes p
--      LEFT JOIN prospeccao_contatos   c ON c.prospeccao_id = p.id
--      LEFT JOIN prospeccao_interacoes i ON i.prospeccao_id = p.id
--     WHERE p.cnpj IN ('31.402.885/0001-04','48.115.209/0001-72','55.720.183/0001-90')
--     GROUP BY p.nome_fantasia;
--
--    Rodar este arquivo DE NOVO não duplica nada — pode conferir repetindo.
-- ============================================================================
