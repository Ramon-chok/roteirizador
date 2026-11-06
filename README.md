# Roteirizador RRM

Sistema de planejamento territorial, setorização e roteirização (Route VORTEX), inspirado no Omnitracs Roadnet / Territory Planner.
Roda no navegador e guarda os dados no Supabase, sem servidor próprio para instalar.

O projeto tem estas entregas, todas a partir dos mesmos arquivos:

| Entrega | Arquivo | Para quê |
|---|---|---|
| **Web (oficial)** | `index.html` + `css/` + `js/` | Versão principal, aberta no navegador (Live Server, `npm start` ou hospedada) |
| **Arquivo único** | `dist/roteirizador.html` | A mesma versão web num arquivo só, gerado por `npm run build` |
| **Desktop (Windows)** | `desktop/` → `Roteirizador-RRM-Setup.exe` | Espelho da versão web numa janela própria, com instalador e atualização automática |
| **Landing de download** | `landing/index.html` | Página simples com o botão para baixar o instalador |

Regra de ouro: **toda mudança é feita na versão web oficial** (`index.html`, `css/`, `js/`). O arquivo único e o desktop são gerados a partir dela, sem código próprio de interface.

## Como rodar no VS Code (recomendado)

1. Descompacte a pasta `roteirizador` e abra no VS Code (**Arquivo → Abrir Pasta**).
2. Instale a extensão **Live Server** (o VS Code vai sugerir, ela está em `.vscode/extensions.json`).
3. Clique com o botão direito em `index.html` → **Open with Live Server**.
4. O navegador abre em `http://127.0.0.1:5500/index.html` com o mapa do OpenStreetMap e as rotas pelas ruas.

Alternativa sem extensão (precisa do Node.js instalado): no terminal do VS Code, rode `npm start` e acesse `http://localhost:5500`.

> Abrir o `index.html` com dois cliques (endereço `file://`) pode funcionar, mas alguns navegadores e a chave do Google bloqueiam. Prefira o Live Server.

## Como o sistema está organizado

- **Acesso**: a pessoa escolhe o ambiente (G4 Distribuidora, J.Arantes, Chok Distribuidora ou Grupo Arantes) e faz login. Cada ambiente tem usuários, clientes, colaboradores e estudos separados. Veja [Ambientes e login](#ambientes-e-login).
- **Início** (tela de abertura): os módulos com acesso rápido. **Planejamento**, **Rotas**, **Pedágios**, **Verba Indenizatória**, **Calendário** e **Configurações**. Cada cartão mostra os números principais do módulo (no Calendário, a semana atual do ciclo e o próximo evento).
- **Planejamento**: painel dos estudos. No topo, escolha o **Estudo** e o **Setor** (ou clique em um setor no gráfico de KM): os indicadores (clientes, cidades ou setores, rotas, KM e tempo no ciclo, ocupação), os gráficos (KM por rota em cada dia, visitas por dia, clientes por cidade, ocupação da jornada) e o mapa de cobertura passam a mostrar só aquele setor. **Abrir o setor no mapa** leva ao Planner com ele aberto. Abaixo ficam a lista de estudos e, recolhido em **Cobertura e bases**, o mapa, as bases de dados, as bases de saída e o backup.
- **Rotas**: bases de roteiros importadas mês a mês e os estudos do Planejamento, com visão geral, tabela, mapa, histórico e comparação. Veja [Rotas](#rotas).
- **Pedágios**: praças de pedágio com local e tarifas, mapa com as rotas de um estudo ou de uma base e relatório de quais rotas pagam, quanto e onde. Na roteirização, cada rota mostra os pedágios do percurso. Veja [Pedágios](#pedágios).
- **Verba Indenizatória**: cálculo da verba pelo KM das rotas, com racionais, reembolsos, descontos, extrato e histórico. Veja [Verba Indenizatória](#verba-indenizatória).
- **Calendário**: o ano com dias úteis, feriados, eventos da empresa e as semanas do ciclo. Veja [Calendário](#calendário).
- **Planner**: o sistema de mapa, roteiros, estudos, clientes e colaboradores. Entre pelo botão **Abrir Planner**, que oferece: abrir um **estudo existente**, criar um **planner vazio e novo** ou **importar** um roteiro (Excel/CSV). Para voltar, clique em **Roteirizador RRM** no topo.
- **Importação** (aba do Planner, também acessível pela página inicial): baixe os modelos .xlsx de colaboradores, clientes e roteiro (cada um com exemplos e uma aba “Instruções”) e importe-os. Ordem recomendada: colaboradores → clientes → roteiro.
- **Configurações** (aba do Planner, também acessível pela página inicial): Minha conta, mapa de fundo, busca de endereços, servidores de rota, backup e dados de exemplo.

## Ambientes e login

- Os ambientes ficam em `js/config.js` (`empresas`). Cada um aceita valores próprios: `padroes` (jornada, velocidade, ciclo e dias dos novos estudos) e `pontoMar`. Não troque o `id` de um ambiente em uso: os dados ficam guardados por ele.
- **Primeiro acesso:** o primeiro login de um ambiente em cada navegador cria o administrador. Ele cadastra os demais em **Minha conta** (canto superior direito), com senha provisória que a pessoa troca no primeiro login.
- **Esqueci minha senha:** usa o código de recuperação mostrado quando a senha é criada. Sem o código, um administrador redefine a senha em **Minha conta**. O envio por e-mail depende de servidor.
- **Manter conectado:** mantém o login neste navegador por 30 dias. Sem marcar, o login vale até fechar a aba.
- **Dados antigos:** se o navegador tiver dados de antes da separação por ambiente, o login pergunta se eles pertencem àquele ambiente e os move. Com "Agora não", nada é apagado e a pergunta volta no próximo login.

> **Sem o Supabase configurado:** contas e dados ficam no navegador, com senhas guardadas só como hash. Isso separa as empresas e evita o acesso casual, mas não protege contra quem tem acesso ao computador, e os quatro ambientes dividem o limite de cerca de 5 MB do navegador.

## Visões do mapa

No mapa, o painel da esquerda (**Visualizar**) serve para escolher o que ver e o da direita (**Editar e roteirizar**) para alterar: setor, dias, semanas, modo de roteirização, cliente novo, inclusão e exclusão.

O painel da esquerda tem três visões:

- **Setores** (abre assim ao entrar em um estudo): todos os setores carregados e coloridos, sem linhas de rota. Abrir um setor ou filtrar semana e dia mostra as linhas.
- **Rotas**: começa sem ninguém marcado. Marque colaboradores ou clique em um dia para ver só aqueles roteiros; o painel direito lista as rotas marcadas com KM, tempo e ocupação, e cada uma abre com a sequência de visitas.
- **Base**: todos os clientes cadastrados, mesmo sem estudo. Filtre por uma ou mais cidades e por clientes específicos, buscando por nome ou SOLD ou colando uma lista de códigos. Também abre pelo botão **Mapa da base** na tela inicial, em Listagens e em **Clientes → Ver no mapa**, que leva o filtro daquela página.

As ferramentas de seleção (clique, retângulo e laço) ficam na barra de ferramentas do mapa e funcionam nas três visões. Durante o arrasto, o contorno aparece com halo e preenchimento, acima dos clientes, e um contador junto ao cursor mostra quantos clientes entram (ou saem, com Alt) da seleção.

Os clientes aparecem como **pinos de GPS**, cada um na cor do setor, do dia, da semana ou do colaborador (conforme **Colorir por**). Com as linhas das rotas visíveis, o número da visita fica dentro do pino; cliente selecionado ganha um visto. Para voltar aos pontos simples, desmarque **Pinos de GPS** em **Exibição do mapa** (ou no painel da visão Base).

## Da base de clientes às rotas diárias

1. Importe só a base de clientes. No mapa, eles aparecem na visão Base, sem precisar criar um estudo antes. Se a listagem tiver a coluna **Setor** (e, se quiser, **SOLD vendedor**), os setores já são carregados no estudo ao importar.
2. Selecione clientes com clique, retângulo ou laço e clique com o **botão direito → Criar setor com a seleção**. Se não houver estudo aberto, ele é criado com toda a base. Clientes de um setor existente podem ser levados para outro pelo mesmo menu.
3. Abra o setor no seletor **Setor** do painel Visualizar, clicando no nome dele na lista, ou pelo botão direito em um cliente dele. O mapa mostra só ele, colorido por dia, e o painel da direita mostra as ações do setor.
4. Selecione os clientes de cada rota. No painel à direita escolha o setor, os dias, as semanas e o modo, e clique em **Roteirizar**. Ou use **Dividir nos dias** para o sistema distribuir o setor inteiro.

O seletor **Setor** também oferece **Todos**, **Nenhum** e **Só clientes sem setor**. Para comparar mais ou menos setores, duplique o estudo em **Estudos → Duplicar como cenário** e use **Comparar cenários**.

## Roteirizar no mapa

Para rotas que já existem: escolha no painel **Visualizar** o que ver (setor, semanas e dias, podendo marcar mais de um) e, em **Editar e roteirizar**, escolha o modo e clique em **Roteirizar**.

| Formato | Servidor | O que faz |
|---|---|---|
| Mais rápida | OSRM | Menos tempo de viagem. É o padrão |
| Mais curta | Valhalla | Menos KM, mesmo que leve mais tempo |
| Evitar pedágios | Valhalla (ou Google, se for o motor escolhido na mais rápida) | Não usa vias com pedágio. Se não houver outro caminho, a rota passa por ele e avisa |
| Evitar estrada de terra e via precária | Valhalla | Não usa vias registradas como sem pavimento. O percurso calculado é medido, e a rota avisa quantos km de terra não puderam ser evitados |

O formato é salvo no estudo e também aparece em **Estudos e setores → Parâmetros de cálculo**. Trocá-lo não apaga o que já foi calculado: cada rota mostra em qual formato foi calculada.

A informação de pavimento vem do OpenStreetMap e pode faltar em vias rurais. O mapa não tem dados de acidentes nem de segurança, então "via precária" significa via sem pavimento registrado, e não risco medido.

## Banco de dados (Supabase)

O sistema grava no Supabase: clientes, colaboradores, estudos, setores, roteiros e percursos ficam no banco, por empresa, e cada usuário só acessa as empresas em que é membro (Row Level Security). O projeto é definido em `js/config.js` (`supabaseUrl` e `supabaseKey`, a chave pública). Sem esses dois valores, o sistema volta a guardar tudo no navegador, com login local.

- **Acesso:** o login usa as contas do Supabase Auth. O administrador inclui pessoas em **Minha conta**. Quem ainda não tem conta recebe uma senha provisória e a troca no primeiro login.
- **Confirmação de e-mail:** com "Confirm email" ligado no Supabase, a pessoa precisa abrir o link antes de entrar, e o envio padrão do Supabase só atende endereços da equipe do projeto. Para os demais, crie a conta em **Authentication → Users** e inclua o e-mail em **Minha conta**, ou configure um servidor de e-mail em **Authentication → Emails**.
- **Esqueci minha senha:** envia um link por e-mail. Para ele voltar ao sistema, cadastre o endereço em **Authentication → URL Configuration** (por exemplo `http://127.0.0.1:5500/**`).
- **Dados do navegador:** no login, se o banco do ambiente estiver vazio e o navegador tiver dados, o sistema oferece enviá-los. Eles continuam no navegador.
- **Várias pessoas ao mesmo tempo:** cada alteração é gravada linha a linha, e a última gravação vale. O que outra pessoa alterou aparece ao recarregar a página.

Em um projeto novo, rode `supabase/schema.sql` no **SQL Editor**, depois `supabase/migracao_04_seguranca.sql`, `supabase/migracao_05_rotas.sql`, `supabase/migracao_06_calendario_verba.sql` e `supabase/migracao_07_pedagios.sql`, crie o usuário em **Authentication → Users** e dê acesso com o comando que está no fim do `schema.sql`. Quem já tinha o schema roda também, nesta ordem, `migracao_02_usuarios.sql`, `migracao_03_importacoes.sql` (histórico de importações), `migracao_04_seguranca.sql` (duas etapas, privacidade e registro de atividades) , `migracao_05_rotas.sql` (módulo Rotas), `migracao_06_calendario_verba.sql` (Calendário e Verba Indenizatória) e `migracao_07_pedagios.sql` (Pedágios). Todas podem rodar mais de uma vez. Para carregar um backup direto por SQL, use `python ferramentas/backup_para_sql.py backup.json`.

Para ativar o bloqueio por IP, rode também `supabase/migracao_08_seguranca_avancada.sql` e depois `supabase/migracao_09_bloqueio_ip.sql`. O login do aplicativo bloqueia o IP após mais de 20 falhas em 15 minutos, com bloqueio progressivo limitado a 24 horas; as tentativas ficam por ambiente e são removidas após 90 dias. Administradores com MFA podem consultar e desbloquear IPs em **Segurança e privacidade → Política e acessos**. O recurso usa o IP recebido pelo Supabase e protege os logins feitos pelo aplicativo; mantenha também os limites e a proteção contra abuso configurados no Supabase Auth.

## Rotas

O módulo **Rotas** guarda os roteiros em uso, por período (mês/ano), para acompanhar KM, tempo e custo e comparar com os estudos do Planejamento.

- **Importar:** baixe o modelo em **Rotas → Modelo (.xlsx)**. Colunas obrigatórias: SOLD cliente, SOLD vendedor e Dia (com Semana) ou a Data de cada visita. Opcionais: Período, Equipe, Região, Segmento, Cidade, Nome, Tempo de atendimento, Sequência, Latitude e Longitude. Uma planilha com vários meses (coluna Período ou datas de meses diferentes) vira uma base por mês. Importar de novo o mesmo mês substitui a base daquele mês, se a opção estiver marcada.
- **Posição dos clientes:** vem da base de clientes; a Latitude/Longitude da planilha completa quem não estiver nela. Clientes sem coordenada ficam fora do mapa e do KM, e a importação lista quais são.
- **Visões:** Visão geral (indicadores e gráficos), Tabela (por vendedor, com os dias ao clicar, ou por cliente; exporta para Excel), Mapa (pinos coloridos por vendedor, dia, semana, cidade ou segmento, linhas das rotas, regiões e bases de saída), Histórico (KM, visitas, clientes, horas e custo por mês, com a matriz vendedor × mês) e Comparar com estudo.
- **Filtros:** vendedor, equipe, cidade, região, segmento, dia, semana, tempo de atendimento e busca por cliente. No histórico, os filtros valem pela rota (uma rota entra se atende algum cliente do filtro); atendimento e busca valem só na base aberta.
- **KM e custo:** o KM é estimado como no Planejamento (linha reta × fator de rota, com ida e volta da base do colaborador) e pode ser recalculado pelas ruas em **Mapa → Calcular KM pelas ruas** (até 300 rotas por vez, cerca de 1 por segundo no servidor público). O valor do KM (R$) e os demais parâmetros ficam em **Rotas → Parâmetros** e valem para o ambiente todo. O mês considera 4 semanas: KM do mês = KM do ciclo × 4 ÷ semanas do ciclo; para bases por data, é o total do mês.
- **Estudos em Rotas:** no seletor **Ver** aparecem as bases de rotas e, logo abaixo, os estudos do Planejamento. Um estudo abre com as mesmas visões (geral, tabela e mapa) e os mesmos filtros; o KM pelas ruas do estudo continua sendo calculado no Planner.
- **Comparar:** cada lado escolhe uma base ou um estudo e um vendedor (ou todos). Vale base × estudo, estudo × estudo e base × base. Os dois mapas ficam lado a lado e se movem juntos; a tabela mostra a diferença de clientes, visitas, dias de rota, KM por mês, semana e dia, horas e custo, e a lista de clientes que só existem de um lado. O botão ⇄ troca os lados.

## Pedágios

O módulo **Pedágios** guarda as praças de pedágio do ambiente e mostra por quais delas as rotas passam.

- **Cadastro:** cada praça tem nome, local (latitude e longitude), rodovia, KM, concessionária, cidade, a cobrança (nos dois sentidos ou em um só, com o rumo de quem paga) e a tarifa por passagem de carro, moto e utilitário de 2 eixos. Há três formas de cadastrar:
  - **Importar praças:** pelo modelo em **Pedágios → Modelo (.xlsx)**. Importar de novo atualiza as praças de mesmo nome perto do mesmo local.
  - **Buscar praças nesta área (OpenStreetMap):** traz as praças visíveis no mapa. Muitas já vêm com as tarifas e o sentido cobrado. Confira os valores na tabela da concessionária ou da agência reguladora (ANTT, ARTESP…).
  - **Nova praça** ou **Marcar praça no mapa:** uma a uma.
- **Mapa:** escolha em **Rotas de** um estudo ou uma base de Rotas. As rotas com pedágio ficam em laranja, as sem pedágio em azul e as ainda não traçadas pelas ruas tracejadas. As praças das rotas ficam em destaque. Clique numa rota para ver as praças dela. Filtros: vendedor, dia, com pedágio, sem pedágio e sem traçado.
- **Relatório:** por vendedor, por praça e por rota, com passagens e valores por dia e por mês. Exporta para Excel.
- **Como a passagem é contada:** a rota passa pela praça quando o percurso pelas ruas chega a menos do raio de detecção (padrão 150 m). Cada entrada nesse raio é uma passagem. Rota de ida e volta pela mesma praça paga duas vezes. Em praça que cobra num sentido só, a passagem só conta quando o rumo do percurso naquele ponto bate com o sentido cobrado. A passagem no outro sentido aparece como "sem cobrança". Se o sentido cobrado não estiver informado, conta metade das passagens, arredondando para cima.
- **Mês:** valor por dia de rota × 4 ÷ semanas do ciclo, como no KM do mês. Em bases por data, é o total do mês.
- **Parâmetros:** a categoria do veículo usada nas contas (carro, moto ou utilitário) e o raio de detecção valem para o ambiente todo.
- **Só rotas traçadas pelas ruas:** rotas em linha reta não entram na conta. No Planner, use **Roteirizar** ou **Só traçar**. Em Pedágios, **Traçar pelas ruas** traça para a análise sem gravar o KM.

**Na roteirização (Planner):** a rota aberta mostra o bloco **Pedágios**, com cada praça do percurso, o número de passagens, o valor e o total por dia e no mês. Se o percurso não passa por nenhuma praça, aparece **Sem pedágio**. Na lista de rotas marcadas, cada rota tem um selo laranja com o número de pedágios e o valor do dia; um "+ ?" no selo indica praça sem valor cadastrado. No mapa, as praças do percurso ficam em laranja e as demais, apagadas; para esconder todas, desmarque **Exibição do mapa → Praças de pedágio**. Se o servidor de rotas indicar pedágio num trecho em que não há praça cadastrada, a rota avisa.

## Calendário

- **Ano e mês:** o ano inteiro em 12 meses, ou um mês grande com os nomes dos eventos. Cada mês mostra os dias úteis (segunda a sexta sem feriado), os sábados e os feriados. Hoje e a semana atual ficam destacados. Clique em um dia para ver o que há nele.
- **Semanas do ciclo:** à esquerda de cada semana, a semana do ciclo de 4 semanas (S1 a S4); à direita, a quinzena (1,3 ou 2,4). As semanas vão de domingo a sábado e a referência padrão é a semana de 16/11/2026 (de 15 a 21/11) = S1 (depois S2, S3, S4 e o ciclo recomeça, para frente e para trás). A referência não aparece no calendário; o administrador só a muda, se a contagem da empresa mudar, em **Feriados → Contagem das semanas (avançado)**.
- **Feriados nacionais:** calculados para qualquer ano, inclusive os móveis (Carnaval, Sexta-feira Santa e Corpus Christi, a partir da Páscoa) e o Dia da Consciência Negra (desde 2024). Carnaval e Corpus Christi são pontos facultativos; em **Feriados** o administrador define se eles têm rota ou não.
- **Eventos:** o administrador inclui eventos de um ou mais dias em categorias com cor (Reembolso, Reunião, Pagamento de verba, Feriado local, Outro, ou as que criar em **Categorias**). Categorias marcadas como “sem rota” tiram o dia do cálculo, como os feriados municipais. Os chips da legenda mostram ou escondem cada categoria.

## Verba Indenizatória

- **Racional:** preço médio do combustível pesquisado (R$ por litro) ÷ KM por litro + cesta de serviço (pedágio e manutenção, em R$ por km). Ex.: R$ 6,20 ÷ 10 km/L + R$ 0,28 = R$ 0,90 por km. Cadastre quantos quiser em **Racionais** (por veículo, região ou período).
- **Cálculo:** escolha o mês, as rotas (uma base de Rotas ou um estudo) e o racional. Para cada rota (vendedor × semana do ciclo × dia), a verba é o KM daquele dia de rota × racional × o número de dias do mês em que a rota acontece, pela contagem do Calendário. Ex.: 50 km às segundas das semanas 2 e 4 = 2 dias no mês × 50 km × R$ 0,90 = R$ 90,00. Feriados e dias sem rota ficam de fora e aparecem no aviso. Em bases importadas por data, vale a data de cada visita.
- **Extrato:** por vendedor, com KM do mês, dias úteis, dias calculados, verba, reembolso, desconto e total, o calendário do mês com o KM de cada dia e os feriados, a lista dia a dia e os lançamentos. Exporta para Excel e imprime.
- **Reembolsos e descontos:** inclua um a um (com motivo, data, referência da rota ou do documento e até 4 imagens, reduzidas antes de salvar) ou importe por planilha (modelo em **Modelo (.xlsx)**). Reembolsos somam e descontos subtraem do total do vendedor no mês. A página de descontos guarda o motivo e as evidências de cada um.
- **Histórico:** **Salvar no histórico** grava a apuração do mês (racional, KM, dias e valores daquele momento). O histórico mostra o total por mês, a tabela das apurações e o total por vendedor e mês.
- **Comparativo:** dois lados, cada um com rotas e racional, no mesmo mês. Os atalhos montam “mesmos KM, outro racional” e “mesmo racional, outros KM”. Mostra KM, racional, verba e total, a verba por vendedor lado a lado e a diferença.
- **Quem altera:** só o administrador do ambiente cria racionais, lançamentos e apurações (o banco também exige isso, com a migração 06). Os demais veem em modo de leitura.

## Segurança e privacidade (LGPD)

Fica em **Configurações → Segurança e privacidade** (também em **Minha conta** e no cartão Configurações do início).

- **Verificação em duas etapas:** além da senha, um código de 6 dígitos de um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, Authy…). Com o Supabase, usa o MFA do Supabase Auth: deixe o TOTP ligado em **Authentication → Multi-Factor**. A migração 04 faz o banco exigir a segunda etapa de quem a tem cadastrada, então a proteção não depende só da tela. Sem o Supabase, o sistema também gera 8 códigos de reserva. Quem perder o celular: com Supabase, o administrador apaga o fator em **Authentication → Users**; sem Supabase, o administrador redefine a senha em Minha conta e a pessoa cadastra de novo.
- **Política do ambiente (administrador):** exigir as duas etapas de todos (quem não tiver cadastra no próximo login) e o tempo sem uso para encerrar a sessão (padrão 30 minutos, com aviso 1 minuto antes; a atividade em qualquer aba conta).
- **Aviso de privacidade:** no primeiro acesso (e quando a versão do texto mudar) cada pessoa lê e aceita o aviso: finalidade, dados tratados, base legal, compartilhamento com os serviços de mapa, segurança e direitos do titular. O aceite fica registrado com a versão. Preencha controlador, encarregado (DPO) e contato em `js/config.js` → `seguranca.privacidade`.
- **Direitos do titular:** cada pessoa baixa os próprios dados (conta, aceites e atividades) e envia pedidos de correção ou exclusão, que ficam no registro de atividades.
- **Registro de atividades:** entradas e saídas, fim de sessão por inatividade, duas etapas, política, aceite, exportações e backups, importações, exclusões e inclusão ou remoção de usuários. Com o Supabase, ninguém altera nem apaga um registro pelo sistema e a data é a do servidor. O administrador vê o do ambiente e exporta para Excel; cada pessoa vê o próprio.
- **Senha e tentativas:** senha com ao menos 10 caracteres, com letras e números. Depois de 5 senhas ou códigos errados seguidos, o login fica bloqueado neste navegador por 5 minutos (o tempo dobra a cada novo bloqueio). O Supabase tem o próprio limite no servidor. Os valores ficam em `js/config.js` → `seguranca`.
- **Política de conteúdo (CSP):** o `index.html` só deixa rodar scripts do próprio sistema e dos CDNs usados, o que bloqueia script injetado. Com isso, o recarregamento automático do Live Server deixa de funcionar (o script dele é embutido): recarregue com F5. O `dist/roteirizador.html` libera scripts embutidos, porque é um arquivo único. Ao hospedar, envie também os cabeçalhos `Content-Security-Policy` (com `frame-ancestors 'none'`), `Strict-Transport-Security` e `X-Content-Type-Options: nosniff` pelo servidor.

## Importação pelo endereço

- **Clientes**: basta o SOLD e o endereço (bairro, cidade e UF deixam a busca mais precisa). Na importação, as coordenadas são buscadas automaticamente em segundo plano; o progresso aparece no canto inferior direito e o sistema continua utilizável.
- **Colaboradores**: a base de saída também é localizada pelo endereço.
- **Roteiro**: colunas SOLD cliente, SOLD vendedor, Dia, Semana e o endereço do cliente.
  - **Dia** em número: 2 = segunda, 3 = terça, 4 = quarta, 5 = quinta, 6 = sexta, 7 = sábado (1 = domingo). Mais de um dia: `2,5` ou `25`. Texto (Seg, Terça…) também é aceito.
  - **Semana** (ciclo de 4 semanas, cada algarismo é uma semana): mensal = `1`, `2`, `3` ou `4`; quinzenal = `1,3` ou `2,4`; semanal = `1234`.
  - A frequência do cliente na base é atualizada pelo roteiro (semanas × dias).
  Quem não estiver na base de clientes é cadastrado com esse endereço e localizado; cada SOLD vendedor vira um setor (acrescente uma coluna “Setor” para outros nomes).
- Só é aceito resultado no nível do endereço ou da rua, na cidade informada. **Endereços não encontrados** (ou encontrados só pela cidade/bairro) ficam **empilhados num único ponto no mar** e fora dos cálculos de KM. Para ajustar: em **Importação → Ajustar endereços** (ou no aviso do mapa) use *Marcar no mapa* (clique no local), *Usar sugestão*, *Buscar* de novo após corrigir o endereço, ou arraste o pino do mar até o local certo. No cadastro do cliente, colar no campo Latitude uma coordenada copiada do Google Maps (“-23.56, -46.65”) preenche os dois campos.
- O ponto no mar é configurável em `js/config.js` (`pontoMar`). O padrão fica cerca de 50 km do litoral norte de SP.
- Serviço de busca: OpenStreetMap/Nominatim (gratuito, ~1 endereço por segundo) ou Google (mais preciso; exige a Geocoding API ativa na chave). Se o Google recusar, a busca continua pelo OpenStreetMap.

## Estrutura

| Caminho | O que é |
|---|---|
| `index.html` | Página principal (estrutura das telas) |
| `css/style.css` | Visual: os 4 temas (Escuro, Claro, Monocromático, Vertical) e o Automático, layout do mapa e painéis. No fim do arquivo fica a **camada de design enterprise** (tipografia, controles, cartões, tabelas, painéis em vidro, diálogos e Início) |
| `js/tema.js` | Troca de tema (botão na barra superior e Configurações → Aparência), guardada neste dispositivo |
| `js/config.js` | **Configurações**: ambientes de login, chave do Google e servidores de rotas (OSRM e Valhalla) |
| `js/engine.js` | Motor de cálculo: setorização (k-means balanceado), distribuição em dias/semanas pela frequência, sequência (vizinho mais próximo + 2-opt + Or-opt), métricas de KM e tempo |
| `js/app.js` | Aplicação: bases, estudos, mapa (Leaflet), pinos de GPS, laço, régua, seleção, importação/exportação Excel, roteirização pelas ruas (OSRM), Google opcional, login, duas etapas, privacidade e registro de atividades |
| `js/rotas.js` | Módulo Rotas: bases de roteiros por período e estudos, tabela, mapa, histórico e comparação |
| `js/calendario.js` | Módulo Calendário: feriados, eventos, dias úteis e semanas do ciclo (S1 a S4, 1,3 e 2,4) |
| `js/verba.js` | Módulo Verba Indenizatória: racionais, cálculo, extrato, reembolsos, descontos, histórico e comparativo |
| `js/pedagios.js` | Módulo Pedágios: praças e tarifas, mapa com as rotas, relatório e os pedágios de cada rota no Planner |
| `exemplos/` | Modelos CSV de clientes, colaboradores e roteiro (os modelos .xlsx com instruções são baixados na aba Importação) |
| `ferramentas/build.py` | Gera `dist/roteirizador.html`, um arquivo único com tudo embutido |
| `supabase/schema.sql` | Estrutura do banco para o Supabase: tabelas, regras de acesso e consultas prontas |
| `supabase/migracao_04_seguranca.sql` | Duas etapas exigida pelo banco, política do ambiente, aceite de privacidade e registro de atividades |
| `supabase/migracao_05_rotas.sql` | Tabelas do módulo Rotas |
| `supabase/migracao_06_calendario_verba.sql` | Tabelas do Calendário e da Verba Indenizatória (escrita só do administrador) |
| `supabase/migracao_07_pedagios.sql` | Tabela das praças de pedágio |
| `ferramentas/backup_para_sql.py` | Converte um backup do sistema em SQL para carregar no Supabase |
| `dist/roteirizador.html` | Versão em arquivo único, pronta para enviar ou hospedar |
| `desktop/` | App de Windows (Electron): `main.js` (janela, menu, atualização), `preload.js`, `scripts/` (cópia da web, bibliotecas, ícone) e `package.json` (instalador) |
| `landing/` | Página de download do instalador (`index.html` + `icon.png`) |

Bibliotecas usadas (carregadas por CDN na web, nada para instalar): Leaflet 1.9.4 (mapa), SheetJS 0.18.5 (Excel), Leaflet.GoogleMutant 0.16.0 (Google opcional), Supabase JS 2.118.0 (banco) e qrcode-generator 1.4.4 (duas etapas). Fontes: Inter, Space Grotesk e IBM Plex Mono (Google Fonts). No desktop, todas vão embutidas no instalador.

## Serviços externos

- **Mapa:** Esri (gratuito, sem chave): claro, escuro, ruas detalhadas e satélite; OpenStreetMap padrão também disponível. A CARTO foi removida porque passou a exigir chave de API e devolvia o mapa em branco com a marca d'água "API KEY REQUIRED".
- **Rotas pelas ruas:** OSRM público (`router.project-osrm.org`), gratuito, cerca de 1 consulta por segundo, sem trânsito em tempo real. Para uso intenso, suba um servidor OSRM próprio e troque em **Configurações** ou em `osrmUrl`, no `js/config.js`.
- **Formatos de rota:** Valhalla público (`valhalla1.openstreetmap.de`), gratuito, sem trânsito em tempo real e sem garantia de disponibilidade. Aceita 10 pontos por consulta, então rotas longas viram várias consultas, cerca de uma por segundo. Se ele estiver fora do ar, o cálculo para e avisa, sem trocar de formato em silêncio. Para uso intenso, suba um servidor próprio e troque `valhallaUrl` em `js/config.js`.
- **Google (opcional):** mapa, rotas e geocodificação. Só carrega se você escolher Google no seletor de mapa ou em "Motor de rotas". Precisa das APIs Maps JavaScript, Directions e Geocoding ativas e da chave restrita ao seu endereço (ex.: `http://127.0.0.1:5500/*`).
- **Geocodificação gratuita:** Nominatim (OpenStreetMap), 1 endereço por segundo.

## Onde ficam os dados

No Supabase, por ambiente (veja acima). Sem o Supabase configurado, ficam no navegador (localStorage), separados por ambiente, por navegador e por endereço. Em qualquer caso, para guardar uma cópia ou levar os dados, use **Estudos e setores → Exportar backup / Restaurar backup** (arquivo JSON). O backup leva os dados do ambiente aberto, mas não os usuários, e pede confirmação se for restaurado em outro ambiente.

## Atalhos do mapa

`H` mover · `V` selecionar · `B` retângulo · `L` laço · `M` régua · `E` enquadrar · `F` tela cheia · `Esc` limpar · `Ctrl+Z` desfazer · Shift soma à seleção, Alt remove.

## Próximos passos sugeridos

- Hospedar (Vercel, Netlify, servidor da empresa) para a equipe acessar por um link.
- Servidores OSRM e Valhalla próprios com o mapa do Sudeste, para roteirizar estudos grandes sem limite de consultas.

## Interface e temas

A interface tem 4 temas da marca, mais o Automático, que segue o tema claro ou escuro do sistema operacional:

| Tema | Fundo | Destaque |
|---|---|---|
| Escuro · Navy Vortex (padrão) | `#0B1426` | ciano `#22D3EE` e azul `#3B82F6` |
| Claro | `#F5F8FC` | azul `#2563EB` |
| Monocromático | azul `#1D4ED8` | branco |
| Vertical · Noite | `#111D35` | azul `#3B82F6` e ciano `#22D3EE` |

Troque pelo botão de tema na barra superior ou em **Configurações → Aparência**. A escolha fica no dispositivo (chave `rvx:tema`). O laranja `#F97316` do centro do vórtice é o mesmo em todos.

O visual enterprise está numa camada separada no fim de `css/style.css`. Ela só usa as variáveis de cada tema (`--bg`, `--surface`, `--ink`, `--accent`…), então um ajuste de cor no tema vale para a interface toda. Para mudar uma cor, edite as variáveis do tema no começo do arquivo, não a camada.

## Versão para Windows (desktop)

A pasta `desktop/` gera o aplicativo de Windows com Electron. Ele é um **espelho da versão web oficial**: não tem interface própria e usa os mesmos `index.html`, `css/` e `js/`. A cada execução ou build, esses arquivos são copiados para `desktop/web/`. Mudou na web, muda no desktop no próximo build. O app usa o mesmo Supabase, então os usuários e os dados são os mesmos da web.

### Como funciona

- **Cópia da web** (`scripts/copiar-web.js`): copia `index.html`, `css/` e `js/` e **embute as bibliotecas e as fontes** que a web carrega de CDN (Leaflet, SheetJS, Supabase, QR code e Google Fonts). Elas são baixadas uma vez para `desktop/vendor/` (cache), e o `index.html` copiado passa a apontar para `web/vendor/`. Assim o app abre sem depender dos CDNs. Mapa de fundo, rotas, busca de endereços e banco continuam pela internet. Se não houver internet no primeiro build, o app segue usando os CDNs, como a web.
- **Janela** (`main.js`): a interface é servida pelo endereço interno `app://rrm/`, que mantém o login e os dados locais entre aberturas. Só existe uma janela (abrir o atalho de novo traz a que já está aberta). Tamanho, posição, zoom e a barra de menus são lembrados. Links externos abrem no navegador padrão, e arquivos exportados vão para **Downloads** com a janela de "Salvar como".
- **Menu** em português:
  - **Arquivo:** recarregar, pasta de downloads, sair.
  - **Editar:** desfazer, copiar, colar e afins.
  - **Exibir:** zoom, tela cheia, mostrar ou ocultar a barra de menus, ferramentas de desenvolvedor.
  - **Ajuda:** verificar atualizações, página de download, pasta de dados, Sobre.
- **Atualização automática** (`electron-updater`): o app instalado verifica o GitHub Releases ao abrir e a cada 6 horas. A versão nova é baixada em segundo plano. Ela é instalada ao reiniciar, quando o app pergunta, ou ao fechar. Os dados não são afetados.
- **Ponte com a web** (`preload.js`): a interface recebe só `window.rrmDesktop`, com `desktop`, `plataforma`, `versaoElectron`, `versao()`, `verificarAtualizacao()` e `sobre()`. O app não dá à página acesso a arquivos nem ao sistema.
- **Segurança:** `contextIsolation` e `sandbox` ligados, sem `nodeIntegration`. Todas as permissões são negadas, exceto área de transferência e tela cheia. A navegação fica restrita ao endereço interno.
- **Tela de erro:** se os arquivos da interface faltarem ou não carregarem, o app mostra uma orientação em vez de uma janela em branco.

### Como executar (sem instalar)

Precisa do Node.js 18 ou mais novo. Na pasta do projeto:

```
npm run desktop:instalar   # só na primeira vez: instala o Electron e o electron-builder
npm run desktop:start      # copia a web, embute as bibliotecas, gera o ícone (se faltar) e abre o app
```

### Como compilar o instalador

```
npm run desktop:build
```

O resultado sai em `desktop/dist/`:

- `Roteirizador-RRM-Setup.exe`: o instalador (Windows 10/11, 64 bits, cerca de 120 MB).
- `latest.yml` e `Roteirizador-RRM-Setup.exe.blockmap`: usados pela atualização automática.

O instalador não pede administrador, deixa escolher a pasta e cria atalhos **Route VORTEX** na área de trabalho e no menu Iniciar. O app só roda no Windows.

> Se o build parar com `EBUSY: resource busy or locked` em `default_app.asar`, outro programa está lendo a pasta `desktop/dist` (antivírus, indexação ou o próprio editor). Feche o app, se estiver aberto, e rode de novo. Se não resolver, gere em outra pasta: dentro de `desktop/`, `npx electron-builder --win nsis --x64 --config.directories.output=C:/rrm-build`.

### Como publicar uma versão nova

1. Aumente `version` em `desktop/package.json` (ex.: `1.1.0` → `1.2.0`).
2. Defina a variável `GH_TOKEN` com um token do GitHub com acesso ao repositório.
3. Rode `npm run desktop:publicar`. O build é feito e o instalador vai para o GitHub Releases (`Ramon-chok/roteirizador`).

A landing page passa a baixar a versão nova, e os apps já instalados se atualizam sozinhos.

### Detalhes

- **Ícone:** `desktop/build/icon.png`, gerado a partir do logo na primeira execução. Para gerar de novo depois de mudar o logo, apague o arquivo ou rode `npm --prefix desktop run icone`.
- **Nome técnico:** o `productName` continua "Roteirizador RRM" de propósito. É ele que define a pasta de dados do Windows (`%APPDATA%\Roteirizador RRM`), e trocá-lo faria quem já usa o app perder o login e os dados locais. O nome visível (janela, atalhos, Sobre) é **Route VORTEX**.
- **Esqueci minha senha no desktop:** preencha `urlWeb` em `js/config.js` com o endereço da versão web. O link do e-mail abre nela, porque o endereço interno do app (`app://rrm`) não abre a partir de um e-mail.
- **Chave do Google:** se a chave tiver restrição por site, inclua `app://rrm/*` na lista de sites permitidos para os mapas do Google funcionarem no desktop.
- **Aviso do Windows:** o instalador não é assinado digitalmente, então o Windows mostra "O Windows protegeu o computador" (é preciso clicar em **Mais informações → Executar assim mesmo**). Para tirar o aviso, é preciso um certificado de assinatura de código, configurável em `build.win` no `package.json`.
- **Testar pelo terminal do VS Code:** o terminal define `ELECTRON_RUN_AS_NODE`, que faz o Electron rodar como Node. Os scripts já removem essa variável (`scripts/rodar-electron.js`). Para abrir pelo terminal o executável de `desktop/dist/win-unpacked`, remova a variável antes.

Atalhos no app: `F5` recarrega, `Shift+F5` recarrega sem cache, `F11` tela cheia, `Ctrl` `+`/`-`/`0` zoom, `F12` ferramentas de desenvolvedor, `Alt` mostra o menu quando ele está oculto.

## Landing page de download

`landing/index.html` é uma página estática e simples, só para baixar o app. Ela tem o nome do sistema, o botão **Baixar para Windows**, a versão e o tamanho da última versão publicada (lidos do GitHub) e os 3 passos da instalação. Fora do Windows, avisa que o app é só para Windows.

- **Hospedar:** envie a pasta `landing/` (com `index.html` e `icon.png`) para qualquer lugar, como GitHub Pages, Netlify ou o mesmo servidor da versão web.
- **De onde vem o download:** por padrão, a última versão do GitHub Releases (variável `DOWNLOAD`, no fim do arquivo). Para hospedar o `.exe` junto da página, copie `desktop/dist/Roteirizador-RRM-Setup.exe` para `landing/` e troque `DOWNLOAD` por `'Roteirizador-RRM-Setup.exe'`.
- **Link para a versão web:** preencha `WEB` no fim do arquivo com o endereço da web, para aparecer o botão "Usar a versão web" no topo.
