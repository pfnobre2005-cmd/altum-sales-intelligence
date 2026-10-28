/* ALTUM Sales Intelligence — configuração
 * ---------------------------------------------------------------
 * Supabase: SOMENTE a Project URL e a chave publishable (sb_publishable_…).
 * As duas são públicas por design; quem protege os dados é o Row Level Security
 * do banco (migrações 001–010) e a verificação em 2 etapas.
 * NUNCA coloque aqui: secret key (sb_secret_…), service_role, senha do banco,
 * token da Nuvemshop ou qualquer outra credencial privada.
 * Se a Project URL mudar, atualize também o Content-Security-Policy do index.html (connect-src e img-src).
 */
window.ALTUM = window.ALTUM || {};

ALTUM.config = {
  appName: 'ALTUM Sales Intelligence',
  version: '0.7.0-clientes',
  dataMode: 'misto',         // Dashboard, Clientes e Produtos: Supabase · demais telas: base fictícia local
  dashboard: {
    permitirFicticios: true  // botão "Ver dados fictícios de teste" (some sozinho quando não houver fictícios); false = esconde
  },
  storageKey: 'altum-si-demo-v1',
  inatividadeMinutos: 30,   // sessão encerrada após este tempo sem uso (também após recarregar a aba)
  supabase: {
    url: 'https://abjnmqzzhsqirlsogwwd.supabase.co',
    publishableKey: 'sb_publishable_ow5h0Mto3_WMWpUaiqYwJg_8sBwMK5D'
  },
  // Listas de domínio usadas pelas telas (independem da fonte de dados)
  leadOrigens: ['WhatsApp', 'Anúncio', 'Instagram', 'Indicação', 'B2B', 'Cadastro manual', 'Importação autorizada']
};
