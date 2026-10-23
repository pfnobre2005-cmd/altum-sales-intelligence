/* ALTUM Sales Intelligence — camada de dados
 * ---------------------------------------------------------------
 * Etapa 1: dados fictícios salvos SOMENTE no navegador (localStorage).
 * Etapa 2: este é o único arquivo que troca de implementação para falar com
 * o Supabase. As telas usam apenas os métodos expostos aqui.
 */
(function (A) {
  'use strict';
  const KEY = A.config.storageKey;
  let db = null;

  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(db)); }
    catch (e) { console.warn('Não foi possível salvar no navegador:', e); }
  }

  A.session = {
    get role() { try { return localStorage.getItem('altum-si-role') || 'admin'; } catch (e) { return 'admin'; } },
    set role(v) { try { localStorage.setItem('altum-si-role', v); } catch (e) { /* ignore */ } },
    isAdmin() { return this.role === 'admin'; }
  };

  A.store = {
    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.meta && parsed.meta.versao === A.mock_VERSION) { db = parsed; return db; }
        }
      } catch (e) { console.warn('Base local inválida, gerando nova.', e); }
      db = A.mock.generate();
      persist();
      return db;
    },
    get db() { return db || this.load(); },
    save: persist,
    reset() {
      try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      db = A.mock.generate();
      persist();
      this.audit('Base fictícia recriada', 'Todos os dados de teste foram gerados novamente');
    },
    audit(acao, detalhe) {
      const d = this.db;
      d.auditoria.unshift({ data: new Date().toISOString(), usuario: A.session.role, acao, detalhe: detalhe || '' });
      d.auditoria = d.auditoria.slice(0, 300);
      persist();
    },

    // ---- consultas ----
    cliente(id) { return this.db.clientes.find(c => c.id === id); },
    lead(id) { return this.db.leads.find(l => l.id === id); },
    campanha(id) { return this.db.campanhas.find(c => c.id === id); },
    produto(id) { return this.db.produtos.find(p => p.id === id); },

    // ---- escrita (cada uma registra auditoria) ----
    updateCliente(id, patch, acao) {
      const c = this.cliente(id); if (!c) return;
      Object.assign(c, patch);
      this.audit(acao || 'Cliente atualizado', `${c.nome} (${id})`);
    },
    setConsentimento(id, canal, valor) {
      const c = this.cliente(id); if (!c) return;
      c.consentimento[canal] = valor;
      c.consentimento.atualizadoEm = new Date().toISOString().slice(0, 10);
      c.consentimento.fonte = 'Alterado manualmente no sistema';
      this.audit('Permissão de comunicação alterada', `${c.nome}: ${canal} → ${valor ? 'autorizado' : 'não autorizado'}`);
    },
    addInteracao(clienteId, inter) {
      const c = this.cliente(clienteId); if (!c) return;
      c.interacoes.unshift(inter);
      this.audit('Interação registrada', `${c.nome}: ${inter.canal}`);
    },
    anonimizarCliente(id) {
      const c = this.cliente(id); if (!c) return;
      const nome = c.nome;
      Object.assign(c, {
        nome: 'Cliente anonimizado', email: '', telefone: '', cidade: '', uf: '',
        statusComercial: 'nao_contatar', interacoes: [], anonimizado: true,
        consentimento: { whatsapp: false, email: false, atualizadoEm: new Date().toISOString().slice(0, 10), fonte: 'Anonimização (LGPD)' }
      });
      this.audit('Cliente anonimizado (LGPD)', `${nome} (${id}) — pedidos mantidos sem dados pessoais`);
    },

    addLead(lead) {
      const d = this.db;
      const norm = s => (s || '').replace(/\D/g, '');
      const dupe = d.leads.find(l => (lead.email && l.email && l.email.toLowerCase() === lead.email.toLowerCase()) ||
        (norm(lead.telefone) && norm(l.telefone) === norm(lead.telefone)));
      if (dupe) return { erro: `Já existe um contato com este e-mail/telefone: ${dupe.nome}` };
      const dupeCli = d.clientes.find(c => (lead.email && c.email.toLowerCase() === lead.email.toLowerCase()) ||
        (norm(lead.telefone) && norm(c.telefone) === norm(lead.telefone)));
      if (dupeCli) return { erro: `Este contato já é cliente: ${dupeCli.nome}` };
      const n = d.leads.reduce((m, l) => Math.max(m, parseInt(l.id.slice(2), 10) || 0), 0) + 1;
      lead.id = 'l-' + String(n).padStart(3, '0');
      lead.criadoEm = new Date().toISOString().slice(0, 10);
      lead.observacoes = lead.observacoes || [];
      d.leads.push(lead);
      this.audit('Contato criado no funil', `${lead.nome} (${lead.origem})`);
      return { lead };
    },
    addObservacaoLead(id, obs) {
      const l = this.lead(id); if (!l) return;
      l.observacoes.push(obs);
      this.audit('Observação registrada no funil', l.nome);
    },
    updateLead(id, patch, acao) {
      const l = this.lead(id); if (!l) return;
      Object.assign(l, patch);
      this.audit(acao || 'Contato do funil atualizado', l.nome);
    },

    addCampanha(c) {
      const d = this.db;
      const n = d.campanhas.reduce((m, x) => Math.max(m, parseInt(x.id.slice(3), 10) || 0), 0) + 1;
      c.id = 'cp-' + String(n).padStart(3, '0');
      c.criadaEm = new Date().toISOString().slice(0, 10);
      d.campanhas.unshift(c);
      this.audit('Campanha criada', c.nome);
      return c;
    },
    updateCampanha(id, patch, acao) {
      const c = this.campanha(id); if (!c) return;
      Object.assign(c, patch);
      this.audit(acao || 'Campanha atualizada', c.nome);
    },

    marcarEnvio(campanhaId, clienteId, data, autor) {
      const c = this.campanha(campanhaId); if (!c) return;
      const d = c.destinatarios.find(x => x.clienteId === clienteId); if (!d || d.enviadoEm) return;
      d.enviadoEm = data;
      if (c.status === 'rascunho') c.status = 'andamento';
      const cli = this.cliente(clienteId);
      if (cli) cli.interacoes.unshift({ data, canal: c.canal === 'email' ? 'E-mail' : 'WhatsApp', nota: `Mensagem da campanha "${c.nome}" enviada manualmente.`, autor });
      this.audit('Envio de campanha marcado', `${c.nome} → ${cli ? cli.nome : clienteId}`);
    },
    setRegras(patch) {
      Object.assign(this.db.regras, patch);
      this.audit('Regras de segmentação alteradas', JSON.stringify(this.db.regras));
    },
    setCiclos(map) {
      this.db.produtos.forEach(p => { if (map[p.id] > 0) p.cicloDias = map[p.id]; });
      this.audit('Ciclos de recompra alterados', this.db.produtos.map(p => `${p.nome}: ${p.cicloDias}d`).join(', '));
    },
    pedidosDoCliente(id) { return this.db.pedidos.filter(o => o.clienteId === id); },

    exportJSON() {
      return JSON.stringify(this.db, null, 2);
    }
  };
})(window.ALTUM);
