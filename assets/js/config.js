/* ALTUM Sales Intelligence — configuração
 * ---------------------------------------------------------------
 * Etapa 1: tudo roda no navegador com DADOS FICTÍCIOS.
 * Etapa 2: preencher supabase.url e supabase.publishableKey (sb_publishable_…,
 * pública por design; quem protege os dados é o Row Level Security).
 * NUNCA coloque aqui: token da Nuvemshop, secret key (sb_secret_…) / service_role do Supabase
 * ou qualquer outra credencial privada.
 */
window.ALTUM = window.ALTUM || {};

ALTUM.config = {
  appName: 'ALTUM Sales Intelligence',
  version: '0.1.1-etapa1',
  dataMode: 'demo',          // 'demo' (Etapa 1) | 'supabase' (Etapa 2)
  storageKey: 'altum-si-demo-v1',
  supabase: { url: '', publishableKey: '' },
  // Listas de domínio usadas pelas telas (independem da fonte de dados)
  leadOrigens: ['WhatsApp', 'Anúncio', 'Instagram', 'Indicação', 'B2B', 'Cadastro manual', 'Importação autorizada']
};
