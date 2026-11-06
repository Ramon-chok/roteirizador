/* Configuração do Roteirizador — edite aqui, sem mexer no resto do código */
window.RT_CONFIG = {
  // Chave da API do Google Maps (opcional). Só é usada se você escolher um mapa ou motor do Google.
  googleMapsKey: 'AIzaSyBdSARhzRlQNoO47wgN7izPQQLgy_5ZaUM',
  // Servidor de rotas OSRM. O público é gratuito (≈1 consulta/segundo). Troque pelo seu servidor quando tiver um.
  osrmUrl: 'https://router.project-osrm.org',
  // Servidor de rotas Valhalla: usado em "mais curta", "evitar pedágios" e "evitar estrada de terra", que o OSRM público não oferece.
  // O público é gratuito, mas aceita 10 pontos por consulta; rotas longas viram várias consultas. Troque pelo seu servidor quando tiver um.
  valhallaUrl: 'https://valhalla1.openstreetmap.de',
  // Banco de dados (Supabase). A chave é a pública (publishable): pode ficar aqui, quem protege os dados são as regras do banco.
  // Nunca coloque aqui a chave service_role / sb_secret nem a senha do banco. Sem os dois valores, os dados ficam só neste navegador.
  supabaseUrl: 'https://bdwliwttetmwgbknhqfb.supabase.co',
  supabaseKey: 'sb_publishable_NOApo3rAD9ZC7jfmd1k9FQ_uue31XhF',
  // Endereço da versão web (ex.: https://seusite.com.br/). O app de Windows usa este endereço no link de "Esqueci minha senha" enviado por e-mail.
  urlWeb: '',
  // Segurança e privacidade (LGPD). A política de cada ambiente (duas etapas obrigatória e minutos de inatividade)
  // é ajustada pelo administrador em Configurações → Segurança e privacidade; estes são os valores iniciais.
  seguranca: {
    inatividadeMin: 30, // encerra a sessão depois de tantos minutos sem uso (0 = nunca)
    tentativas: 5, // senhas ou códigos errados seguidos antes de bloquear o login neste navegador
    bloqueioMin: 5, // duração do primeiro bloqueio; dobra a cada novo bloqueio
    reautenticarMin: 5, // backup, restauração, política, remover pessoas e exportar dados pessoais pedem a senha (ou o código) de novo depois de tantos minutos
    verificarSenhaVazada: true, // senha nova é conferida na base de vazamentos (Have I Been Pwned): só os 5 primeiros caracteres do hash saem do computador
    cifrarCampos: true, // com a migração 08: endereço e coordenadas das bases de saída e a Verba Indenizatória ficam cifrados (AES-256-GCM) no banco
    // Verificação "não sou um robô" no login, na redefinição de senha e na criação de contas (opcional).
    // provedor: 'turnstile' (Cloudflare) ou 'hcaptcha'. Ligue o mesmo provedor no Supabase em Authentication → Attack Protection.
    captcha: { provedor: '', siteKey: '' },
    privacidade: {
      versao: '2026-11.2', // troque a versão quando mudar o texto do aviso: todos aceitam de novo no próximo login
      controlador: '', // razão social da empresa responsável pelos dados. Vazio = nome do ambiente
      encarregado: '', // nome do encarregado (DPO)
      contato: '' // e-mail ou telefone do encarregado
    }
  },
  // Ponto no mar onde ficam os clientes cujo endereço não foi encontrado (para arrastar até o local certo).
  // O padrão fica no oceano, cerca de 50 km do litoral norte de SP. Troque se a sua região for outra.
  pontoMar: { lat: -24.40, lng: -45.40 },
  // Ambientes da tela de login. Cada um tem usuários, clientes, colaboradores e estudos separados.
  // Não troque o "id" de um ambiente em uso: os dados salvos ficam guardados por ele.
  // O que for próprio de uma empresa entra no ambiente dela (todos opcionais):
  //   padroes: valores iniciais dos novos estudos, ex.: { jornada: 440, vel: 30, semanas: 2, dias: [1, 2, 3, 4, 5, 6] }
  //   pontoMar: ponto no mar próprio, ex.: { lat: -24.40, lng: -45.40 }
  empresas: [
    { id: 'g4', nome: 'G4 Distribuidora', sigla: 'G4' },
    { id: 'jarantes', nome: 'J.Arantes', sigla: 'JA' },
    { id: 'chok', nome: 'Chok Distribuidora', sigla: 'CH' },
    { id: 'grupoarantes', nome: 'Grupo Arantes', sigla: 'GA' }
  ]
};
