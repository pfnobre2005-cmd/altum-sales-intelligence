/* ALTUM Sales Intelligence — configuração
 * ---------------------------------------------------------------
 * Supabase: SOMENTE a Project URL e a chave publishable (sb_publishable_…).
 * As duas são públicas por design; quem protege os dados é o Row Level Security
 * do banco (migrações 001–010) e a verificação em 2 etapas.
 * NUNCA coloque aqui: secret key (sb_secret_…), service_role, senha do banco,
 * token da Nuvemshop ou qualquer outra credencial privada.
 * Se a Project URL mudar, atualize também o Content-Security-Policy do index.html.
 */
window.ALTUM = window.ALTUM || {};

ALTUM.config = {
  appName: 'ALTUM Sales Intelligence',
  version: '0.2.0-auth1',
  dataMode: 'demo',          // telas ainda com dados fictícios do navegador (conexão ao banco: etapa futura)
  storageKey: 'altum-si-demo-v1',
  supabase: {
    url: 'https://abjnmqzzhsqirlsogwwd.supabase.co',
    publishableKey: 'sb_publishable_ow5h0Mto3_WMWpUaiqYwJg_8sBwMK5D'
  },
  // Listas de domínio usadas pelas telas (independem da fonte de dados)
  leadOrigens: ['WhatsApp', 'Anúncio', 'Instagram', 'Indicação', 'B2B', 'Cadastro manual', 'Importação autorizada']
};
