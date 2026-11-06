/* ALTUM Sales Intelligence — leitura de dados no Supabase
 * ---------------------------------------------------------------
 * Fonte ÚNICA das telas já conectadas ao banco (Dashboard, Clientes, Produtos e Recompra).
 * Nunca lê nem grava o localStorage: os dados do Supabase não se misturam
 * com a base fictícia local que as demais telas ainda usam.
 *
 * Segurança:
 *  • Usa o cliente Supabase da sessão autenticada (chave publishable + token do
 *    usuário). Quem decide o que pode ser lido é o RLS das migrações 001–010:
 *    leitura só para perfil ATIVO com verificação em 2 etapas (aal2).
 *  • Só pede as colunas que a tela usa (sem e-mail/telefone de clientes).
 *  • Sem aal2 o RLS devolve listas VAZIAS (não erro). Para não exibir zeros
 *    enganosos, toda leitura confere a linha única de configuracoes: se ela
 *    não vier, o acesso não está liberado e a tela mostra erro.
 */
(function (A) {
  'use strict';

  const PAGINA = 1000;                  // limite padrão de linhas por resposta no Supabase
  const LIMITE_SEGURANCA = 100000;      // evita laço infinito se o servidor responder algo inesperado
  let sb = null;

  class ErroDados extends Error {
    constructor(tipo, mensagem, detalhe) { super(mensagem); this.tipo = tipo; this.detalhe = detalhe; }
  }

  function traduzirErro(error, oque) {
    const cod = String((error && (error.code || '')) || '');
    const status = error && error.status;
    const msg = String((error && error.message) || '');
    if (status === 401 || /PGRST30[0-9]|jwt|JWT/.test(cod + ' ' + msg))
      return new ErroDados('sessao', 'Sua sessão expirou. Saia e entre novamente.', cod);
    if (cod === '42501' || status === 403)
      return new ErroDados('permissao', `Sem permissão para ler ${oque}. Verifique se o seu perfil está ativo.`, cod);
    if (!status || status >= 500 || /fetch|network|Failed/i.test(msg))
      return new ErroDados('rede', 'Não foi possível falar com o Supabase. Verifique a conexão e tente de novo.', cod || msg);
    return new ErroDados('consulta', `Erro ao ler ${oque}.`, cod || msg);
  }

  // Lê todas as linhas, página a página, até o total informado pelo servidor
  // (funciona mesmo que o limite de linhas do projeto seja menor que PAGINA).
  async function lerTudo(montar, oque) {
    const linhas = [];
    let total = null;
    while (linhas.length < LIMITE_SEGURANCA) {
      let r;
      try {
        r = await montar(total === null ? { count: 'exact' } : undefined).range(linhas.length, linhas.length + PAGINA - 1);
      } catch (e) { throw traduzirErro(e, oque); }
      if (r.error) throw traduzirErro(r.error, oque);
      if (total === null) total = typeof r.count === 'number' ? r.count : null;
      const dados = r.data || [];
      linhas.push(...dados);
      if (dados.length === 0) break;
      if (total !== null ? linhas.length >= total : dados.length < PAGINA) break;
    }
    if (total !== null && linhas.length !== total)
      throw new ErroDados('consulta', `Leitura incompleta de ${oque} (${linhas.length} de ${total}). Tente de novo.`);
    return linhas;
  }

  function exigirCliente() {
    if (!sb) throw new ErroDados('acesso', 'Conexão com o banco não iniciada. Recarregue a página.');
  }

  // Data/hora do banco (timestamptz) → dia no fuso do navegador (mesma regra das telas)
  function diaLocal(ts) {
    if (!ts) return null;
    const d = new Date(ts);
    return Number.isNaN(d.getTime()) ? null : A.analytics.iso(d);
  }
  const num = v => (v === null || v === undefined ? 0 : Number(v));

  // Origem dos registros (coluna "fonte" de clientes, pedidos, leads e produtos).
  // "real" = manual + nuvemshop + importacao · "ficticio" = carga de teste da migração 010.
  // As duas NUNCA se misturam num mesmo cálculo.
  const ORIGENS_DASHBOARD = ['real', 'ficticio'];
  const filtrarOrigem = (q, origem) => (origem === 'ficticio' ? q.eq('fonte', 'ficticio') : q.neq('fonte', 'ficticio'));
  const daOrigem = (fonte, origem) => (origem === 'ficticio' ? fonte === 'ficticio' : fonte !== 'ficticio');

  /**
   * Dados do Dashboard comercial, todos do Supabase, de UMA origem (real ou fictícia).
   * Devolve a "base" no formato de A.analytics + oportunidades de recompra da visão
   * v_oportunidades_recompra (regras da 006/011: só produto ativo, sem anonimizados).
   */
  async function dashboard(origem) {
    exigirCliente();
    if (!ORIGENS_DASHBOARD.includes(origem)) throw new ErroDados('consulta', 'Origem de dados inválida.');
    const hoje = A.analytics.iso(A.analytics.today());

    const [cfg, clientes, pedidos, leads, oportunidades, produtos, ficticios] = await Promise.all([
      lerTudo(o => sb.from('configuracoes')
        .select('id, inativo_apos_dias, fidelidade_min_pedidos, janela_antes_dias, janela_depois_dias', o).order('id'), 'as configurações'),
      lerTudo(o => filtrarOrigem(sb.from('clientes')
        .select('id, nome, origem, cadastrado_em, status_comercial, anonimizado_em, fonte', o), origem).order('id'), 'os clientes'),
      lerTudo(o => filtrarOrigem(sb.from('pedidos')
        .select('id, cliente_id, data_pedido, status, total, cupom_codigo, fonte', o).eq('status', 'pago'), origem).order('id'), 'os pedidos'),
      lerTudo(o => filtrarOrigem(sb.from('leads')
        .select('id, nome, empresa, origem, etapa, proximo_contato, fonte', o)
        .is('anonimizado_em', null).not('etapa', 'in', '(comprou,perdido)')
        .not('proximo_contato', 'is', null).lte('proximo_contato', hoje), origem).order('id'), 'os follow-ups do funil'),
      lerTudo(o => sb.from('v_oportunidades_recompra')
        .select('cliente_id, produto_id, produto, reposicao_estimada, dias_apos_estimativa, situacao, pode_whatsapp, pode_email', o)
        .eq('situacao', 'janela').order('cliente_id').order('produto_id'), 'as oportunidades de recompra'),
      lerTudo(o => sb.from('produtos').select('id, fonte', o).order('id'), 'os produtos'),
      (async () => {
        let r;
        try { r = await sb.from('clientes').select('id', { count: 'exact', head: true }).eq('fonte', 'ficticio'); }
        catch (e) { throw traduzirErro(e, 'os dados de teste'); }
        if (r.error) throw traduzirErro(r.error, 'os dados de teste');
        return r.count || 0;
      })()
    ]);

    // Sem a linha única de configurações, o RLS não liberou o acesso (sem aal2 ou perfil inativo)
    if (cfg.length !== 1) {
      throw new ErroDados('acesso', 'O banco não liberou a leitura dos dados. Saia e entre novamente com o código do autenticador.');
    }
    // Conferência defensiva: o filtro foi feito no banco; nada de outra origem passa daqui.
    if ([clientes, pedidos, leads].some(l => l.some(x => !daOrigem(x.fonte, origem)))) {
      throw new ErroDados('consulta', 'O banco devolveu registros de outra origem. Nenhum número foi exibido.');
    }
    const c = cfg[0];
    const idsClientes = new Set(clientes.map(x => x.id));
    // Pedido desta origem ligado a cliente de OUTRA origem: fica fora de todos os indicadores e é informado.
    const pedidosValidos = pedidos.filter(p => idsClientes.has(p.cliente_id));
    const pedidosForaDaOrigem = pedidos.length - pedidosValidos.length;

    const base = {
      fonte: 'supabase', origem,
      regras: {
        inativoAposDias: c.inativo_apos_dias,
        fidelidadeMinPedidos: c.fidelidade_min_pedidos,
        janelaAntesDias: c.janela_antes_dias,
        janelaDepoisDias: c.janela_depois_dias
      },
      clientes: clientes.map(x => ({
        id: x.id,
        nome: x.anonimizado_em ? null : x.nome,          // anonimizado: nenhum dado pessoal (o banco já guarda nulo)
        origem: x.origem,
        criadoEm: diaLocal(x.cadastrado_em),
        statusComercial: x.status_comercial,
        anonimizado: !!x.anonimizado_em,
        consentimento: {}
      })),
      pedidos: pedidosValidos.map(p => ({
        id: p.id, clienteId: p.cliente_id, data: diaLocal(p.data_pedido), status: p.status,
        total: num(p.total), cupom: p.cupom_codigo, itens: []       // itens não são usados pelos indicadores do Dashboard
      })),
      leads: leads.map(l => ({
        id: l.id, nome: l.nome, empresa: l.empresa, origem: l.origem, etapa: l.etapa, proximoContato: l.proximo_contato
      })),
      produtos: [],
      campanhas: []
    };

    // Recompra: só clientes e produtos desta origem; uma linha por cliente (reposição mais adiantada
    // na janela); fora "não contatar" e anonimizados. Ícones = regra real do banco (app.marketing_permitido).
    const fonteProduto = new Map(produtos.map(p => [p.id, p.fonte]));
    const porId = new Map(base.clientes.map(x => [x.id, x]));
    const melhor = new Map();
    oportunidades.forEach(o => {
      const cli = porId.get(o.cliente_id);
      if (!cli || cli.anonimizado || cli.statusComercial === 'nao_contatar') return;
      if (!fonteProduto.has(o.produto_id) || !daOrigem(fonteProduto.get(o.produto_id), origem)) return;
      const atual = melhor.get(o.cliente_id);
      if (!atual || o.dias_apos_estimativa < atual.delta) {
        melhor.set(o.cliente_id, {
          clienteId: o.cliente_id,
          cliente: Object.assign({}, cli, { consentimento: { whatsapp: o.pode_whatsapp === true, email: o.pode_email === true } }),
          produto: { id: o.produto_id, nome: o.produto },
          estimada: o.reposicao_estimada,
          delta: o.dias_apos_estimativa,
          status: 'janela'
        });
      }
    });
    const janela = [...melhor.values()].sort((a, b) => a.delta - b.delta || String(a.cliente.nome).localeCompare(String(b.cliente.nome)));

    return {
      origem, base, janela, lidoEm: new Date(),
      vazio: clientes.length === 0 && pedidos.length === 0 && leads.length === 0,
      pedidosForaDaOrigem,
      existemFicticios: ficticios > 0
    };
  }

  // ---------------------------------------------------------------
  // Produtos (migração 011)
  // ---------------------------------------------------------------
  const BUCKET = 'produtos';
  const IMAGEM_MAX_BYTES = 1024 * 1024;
  const TIPOS_IMAGEM = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const CODIGOS_DO_BANCO = { '22023': 'validacao', '23505': 'duplicado', 'PT409': 'conflito', 'P0002': 'nao_encontrado', '23503': 'historico',
                            'P0001': 'validacao', 'P0D01': 'possivel_duplicado' };

  // Erros das funções de gravação: as mensagens do banco já vêm em português e são exibidas como estão.
  function traduzirErroGravacao(error, oque) {
    const cod = String((error && error.code) || '');
    if (CODIGOS_DO_BANCO[cod]) return new ErroDados(CODIGOS_DO_BANCO[cod], String(error.message || 'Dados inválidos.'), cod);
    if (cod === '42501') return new ErroDados('permissao', String(error.message || 'Sem permissão.'), cod);
    return traduzirErro(error, oque);
  }

  async function rpc(nome, args, oque) {
    exigirCliente();
    let r;
    try { r = await sb.rpc(nome, args); } catch (e) { throw traduzirErro(e, oque); }
    if (r.error) throw traduzirErroGravacao(r.error, oque);
    return r.data;
  }

  // Imagem vinda da Nuvemshop: só https dos domínios da loja (os mesmos liberados no CSP do index.html)
  function urlImagemLoja(url) {
    let u;
    try { u = new URL(String(url || '')); } catch (e) { return null; }
    return u.protocol === 'https:' && /(^|\.)(mitiendanube\.com|nuvemshop\.com\.br)$/.test(u.hostname) ? u.href : null;
  }

  function urlImagemProduto(caminho) {
    if (!caminho || !/^[0-9a-f-]{36}\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(caminho)) return null;
    const base = (A.config && A.config.supabase && A.config.supabase.url) || '';
    return `${base}/storage/v1/object/public/${BUCKET}/${caminho}`;
  }

  // Lista de produtos (todos os perfis com 2 etapas) + custos (SOMENTE administrador: o banco recusa os demais).
  async function produtos() {
    exigirCliente();
    const admin = A.session.isAdmin();
    const [cfg, lista, custos] = await Promise.all([
      lerTudo(o => sb.from('configuracoes').select('id', o).order('id'), 'as configurações'),
      lerTudo(o => sb.from('produtos')
        .select('id, nome, sku, categoria, preco, ciclo_recompra_dias, ativo, fonte, imagem_path, nuvemshop_imagem_url, nuvemshop_produto_id, nuvemshop_variante_id, sincronizado_em, versao, criado_em, atualizado_em', o)
        .order('nome').order('id'), 'os produtos'),
      admin ? lerTudo(o => sb.from('produto_custos').select('produto_id, custo, atualizado_em', o).order('produto_id'), 'os custos') : Promise.resolve(null)
    ]);
    if (cfg.length !== 1) {
      throw new ErroDados('acesso', 'O banco não liberou a leitura dos dados. Saia e entre novamente com o código do autenticador.');
    }
    const mapaCustos = custos ? new Map(custos.map(c => [c.produto_id, num(c.custo)])) : null;
    return {
      lidoEm: new Date(),
      comCusto: !!mapaCustos,
      itens: lista.map(p => ({
        id: p.id, nome: p.nome, sku: p.sku, categoria: p.categoria,
        preco: p.preco === null ? null : num(p.preco),
        custo: mapaCustos ? (mapaCustos.has(p.id) ? mapaCustos.get(p.id) : null) : undefined,
        ciclo: p.ciclo_recompra_dias, ativo: p.ativo, fonte: p.fonte,
        imagemPath: p.imagem_path, imagemUrl: urlImagemProduto(p.imagem_path) || urlImagemLoja(p.nuvemshop_imagem_url),
        nuvemshopProdutoId: p.nuvemshop_produto_id, nuvemshopVarianteId: p.nuvemshop_variante_id,
        sincronizadoEm: p.sincronizado_em, versao: num(p.versao), criadoEm: p.criado_em, atualizadoEm: p.atualizado_em
      }))
    };
  }

  function salvarProduto(d) {
    return rpc('produto_salvar', {
      p_id: d.id || null, p_versao: d.id ? d.versao : null,
      p_nome: d.nome, p_sku: d.sku, p_categoria: d.categoria || null,
      p_preco: d.preco, p_custo: d.custo === undefined ? null : d.custo, p_ciclo: d.ciclo === undefined ? null : d.ciclo
    }, 'o produto');
  }

  function alterarStatusProduto(id, ativo, versao) {
    return rpc('produto_alterar_status', { p_id: id, p_ativo: !!ativo, p_versao: versao }, 'o produto');
  }

  // Confere o conteúdo real do arquivo (não só a extensão): JPG, PNG ou WebP.
  async function tipoRealDaImagem(arquivo) {
    const b = new Uint8Array(await arquivo.slice(0, 12).arrayBuffer());
    if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image/jpeg';
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47) return 'image/png';
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
    return null;
  }

  async function validarImagem(arquivo) {
    if (!arquivo) throw new ErroDados('validacao', 'Escolha um arquivo de imagem.');
    if (arquivo.size > IMAGEM_MAX_BYTES) throw new ErroDados('validacao', `Imagem muito grande (${(arquivo.size / 1048576).toFixed(1).replace('.', ',')} MB). O limite é 1 MB.`);
    if (arquivo.size === 0) throw new ErroDados('validacao', 'O arquivo de imagem está vazio.');
    const tipo = await tipoRealDaImagem(arquivo);
    if (!tipo || !TIPOS_IMAGEM[tipo]) throw new ErroDados('validacao', 'Formato não aceito. Use JPG, PNG ou WebP.');
    return tipo;
  }

  async function apagarArquivo(caminho) {
    if (!caminho) return;
    try { await sb.storage.from(BUCKET).remove([caminho]); } catch (e) { /* arquivo órfão não afeta o produto */ }
  }

  function erroDoStorage(error) {
    const msg = String((error && (error.message || error.error)) || '');
    const status = Number(error && (error.statusCode || error.status));
    if (status === 413 || /too large|size/i.test(msg)) return new ErroDados('validacao', 'Imagem acima do limite de 1 MB.');
    if (/mime|type/i.test(msg)) return new ErroDados('validacao', 'Formato não aceito. Use JPG, PNG ou WebP.');
    if (status === 403 || /row-level security|unauthorized|policy/i.test(msg)) return new ErroDados('permissao', 'O armazenamento recusou o envio: só administrador com verificação em 2 etapas pode enviar imagens.');
    if (status === 401) return new ErroDados('sessao', 'Sua sessão expirou. Saia e entre novamente.');
    return new ErroDados('rede', 'Não foi possível enviar a imagem. Verifique a conexão e tente de novo.');
  }

  // Envia a imagem para o Storage e liga ao produto. Se a ligação falhar, apaga o arquivo enviado.
  async function enviarImagemProduto(id, versao, arquivo) {
    exigirCliente();
    const tipo = await validarImagem(arquivo);
    const caminho = `${id}/${crypto.randomUUID()}.${TIPOS_IMAGEM[tipo]}`;
    let r;
    try {
      // envia com o tipo detectado no conteúdo (não o informado pelo nome do arquivo)
      const corpo = new Blob([arquivo], { type: tipo });
      r = await sb.storage.from(BUCKET).upload(caminho, corpo, { contentType: tipo, upsert: false, cacheControl: '31536000' });
    } catch (e) { throw erroDoStorage(e); }
    if (r.error) throw erroDoStorage(r.error);
    let res;
    try {
      res = await rpc('produto_definir_imagem', { p_id: id, p_caminho: caminho, p_versao: versao }, 'a imagem');
    } catch (e) {
      await apagarArquivo(caminho);
      throw e;
    }
    if (res && res.imagem_anterior && res.imagem_anterior !== caminho) await apagarArquivo(res.imagem_anterior);
    return res;
  }

  async function removerImagemProduto(id, versao) {
    const res = await rpc('produto_definir_imagem', { p_id: id, p_caminho: null, p_versao: versao }, 'a imagem');
    if (res && res.imagem_anterior) await apagarArquivo(res.imagem_anterior);
    return res;
  }

  // ---------------------------------------------------------------
  // Clientes (migração 012 + estruturas 003/004/005/007/008)
  // ---------------------------------------------------------------
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const COLUNAS_RESUMO = 'id, nome, cidade, uf, origem, status_comercial, fonte, anonimizado, cadastrado_em, versao, tem_email, tem_telefone, '
    + 'pedidos_pagos, total_pago, primeira_compra, ultima_compra, dias_sem_comprar, segmento, pode_whatsapp, pode_email';

  // Restrição de gravação direta em tabela: mensagens técnicas viram texto claro
  function erroDeGravacao(error, oque) {
    if (error && error.code === '23514') return new ErroDados('validacao', `Dados inválidos para ${oque}. Confira os campos.`, error.code);
    return traduzirErroGravacao(error, oque);
  }
  async function gravar(montar, oque) {
    exigirCliente();
    let r;
    try { r = await montar(); } catch (e) { throw traduzirErro(e, oque); }
    if (r.error) throw erroDeGravacao(r.error, oque);
    return r.data;
  }
  async function lerUm(montar, oque) {
    let r;
    try { r = await montar(); } catch (e) { throw traduzirErro(e, oque); }
    if (r.error) throw traduzirErro(r.error, oque);
    return r.data;
  }

  // Texto de busca seguro para o filtro "or" do PostgREST (sem vírgula, parênteses, asterisco, dois-pontos)
  function termoBusca(q) {
    return String(q || '').replace(/[,()*:\\"]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  // E-mail completo ou telefone (≥ 8 dígitos): buscado no banco pela RPC, que devolve só IDs.
  function pareceContato(q) {
    const t = String(q || '').trim();
    if (t.includes('@')) return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t);
    return /^[0-9()+\-.\s]+$/.test(t) && t.replace(/\D/g, '').length >= 8;
  }
  async function idsPorContato(q) {
    const termo = String(q || '').trim().slice(0, 254);
    if (!pareceContato(termo)) return [];
    let r;
    try { r = await sb.rpc('clientes_buscar_por_contato', { p_termo: termo }); } catch (e) { throw traduzirErro(e, 'a busca por contato'); }
    if (r.error) throw traduzirErro(r.error, 'a busca por contato');
    return (r.data || []).map(String).filter(x => UUID_RE.test(x)).slice(0, 50);
  }

  /** Lista paginada no servidor (v_clientes_resumo, security_invoker → RLS + 2 etapas).
   *  A visão não tem e-mail/telefone: a busca por contato usa clientes_buscar_por_contato (só IDs). */
  async function clientesListaComTotal(f) {
    exigirCliente();
    const origem = f.origem === 'ficticio' ? 'ficticio' : 'real';
    const porPagina = Math.min(Math.max(Number(f.porPagina) || 25, 10), 100);
    const pagina = Math.max(Number(f.pagina) || 1, 1);
    const idsContato = await idsPorContato(f.q);
    const montar = () => {
      let q = sb.from('v_clientes_resumo').select(COLUNAS_RESUMO, { count: 'exact' });
      q = filtrarOrigem(q, origem);
      if (f.status) q = q.eq('status_comercial', f.status);
      if (f.segmento) q = q.eq('segmento', f.segmento);
      if (f.permissao === 'whatsapp') q = q.eq('pode_whatsapp', true);
      if (f.permissao === 'email') q = q.eq('pode_email', true);
      if (f.permissao === 'nenhuma') q = q.eq('pode_whatsapp', false).eq('pode_email', false);
      if (f.anonimizados === 'sem') q = q.eq('anonimizado', false);
      if (f.anonimizados === 'so') q = q.eq('anonimizado', true);
      const t = termoBusca(f.q);
      if (t) {
        const partes = [`nome.ilike.*${t}*`, `cidade.ilike.*${t}*`];
        if (idsContato.length) partes.push(`id.in.(${idsContato.join(',')})`);
        q = q.or(partes.join(','));
      }
      if (f.ordem === 'ultima') q = q.order('ultima_compra', { ascending: false, nullsFirst: false });
      else if (f.ordem === 'total') q = q.order('total_pago', { ascending: false });
      else q = q.order('nome', { ascending: true, nullsFirst: false });
      return q.order('id').range((pagina - 1) * porPagina, pagina * porPagina - 1);
    };
    const contarFicticios = async () => {
      const r = await sb.from('clientes').select('id', { count: 'exact', head: true }).eq('fonte', 'ficticio');
      if (r.error) throw traduzirErro(r.error, 'os dados de teste');
      return r.count || 0;
    };
    let cfg, r, fic;
    try {
      [cfg, r, fic] = await Promise.all([
        lerTudo(o => sb.from('configuracoes').select('id', o).order('id'), 'as configurações'), montar(), contarFicticios()]);
    } catch (e) { throw e instanceof ErroDados ? e : traduzirErro(e, 'os clientes'); }
    if (r.error) throw traduzirErro(r.error, 'os clientes');
    if (cfg.length !== 1) throw new ErroDados('acesso', 'O banco não liberou a leitura dos dados. Saia e entre novamente com o código do autenticador.');
    const itens = (r.data || []).map(x => ({
      id: x.id, nome: x.nome, cidade: x.cidade, uf: x.uf, origem: x.origem, status: x.status_comercial, fonte: x.fonte,
      anonimizado: x.anonimizado, cadastradoEm: x.cadastrado_em, temEmail: x.tem_email, temTelefone: x.tem_telefone,
      pedidos: num(x.pedidos_pagos), total: num(x.total_pago), primeira: x.primeira_compra, ultima: x.ultima_compra,
      diasSemComprar: x.dias_sem_comprar, segmento: x.segmento, podeWhatsapp: x.pode_whatsapp === true, podeEmail: x.pode_email === true
    }));
    if (itens.some(x => !daOrigem(x.fonte, origem))) throw new ErroDados('consulta', 'O banco devolveu clientes de outra origem. Nada foi exibido.');
    return { itens, total: typeof r.count === 'number' ? r.count : itens.length, pagina, porPagina, origem, existemFicticios: fic > 0, lidoEm: new Date() };
  }

  /** Ficha completa de um cliente (todas as leituras respeitam o RLS). */
  async function cliente(id) {
    exigirCliente();
    if (!UUID_RE.test(String(id || ''))) throw new ErroDados('nao_encontrado', 'Este endereço não corresponde a um cliente do Supabase (pode vir de uma tela que ainda usa a base local de teste).');
    const [cfg, c, resumo, pedidos, permAtuais, permHist, oposicoes, interacoes, sugestoes, solicitacoes, textos] = await Promise.all([
      lerTudo(o => sb.from('configuracoes').select('id', o).order('id'), 'as configurações'),
      lerUm(() => sb.from('clientes').select('id, nome, email, telefone, cidade, uf, origem, status_comercial, fonte, anonimizado_em, cadastrado_em, versao, nuvemshop_cliente_id, grupo_pessoa_id').eq('id', id).maybeSingle(), 'o cliente'),
      lerUm(() => sb.from('v_clientes_resumo').select(COLUNAS_RESUMO).eq('id', id).maybeSingle(), 'o resumo do cliente'),
      lerTudo(o => sb.from('pedidos').select('id, numero, data_pedido, status, subtotal, desconto, frete, total, cupom_codigo, fonte, pedido_itens(id, produto_id, nome_produto, qtd, preco_unit)', o)
        .eq('cliente_id', id).order('data_pedido', { ascending: false }).order('id'), 'os pedidos'),
      lerTudo(o => sb.from('v_permissoes_atuais').select('canal, situacao, ocorrido_em, marketing_permitido', o).eq('cliente_id', id).order('canal'), 'as permissões'),
      lerTudo(o => sb.from('permissoes_comunicacao').select('id, canal, situacao, como_obtida, meio_coleta, evidencia_ref, ocorrido_em, registrado_em, fonte', o)
        .eq('cliente_id', id).order('ocorrido_em', { ascending: false }).order('seq', { ascending: false }), 'o histórico de permissões'),
      lerTudo(o => sb.from('oposicoes').select('id, escopo, como_recebida, registrada_em, encerrada_em, motivo_encerramento', o).eq('cliente_id', id).order('registrada_em', { ascending: false }).order('id'), 'as oposições'),
      lerTudo(o => sb.from('interacoes').select('id, data, canal, nota, fonte', o).eq('cliente_id', id).order('data', { ascending: false }).order('id'), 'as interações'),
      lerTudo(o => sb.from('sugestoes_vinculo').select('id, tipo, cliente_id, cliente_b_id, lead_id, motivo, status, criado_em', o)
        .eq('status', 'pendente').or(`cliente_id.eq.${id},cliente_b_id.eq.${id}`).order('criado_em').order('id'), 'as sugestões de vínculo'),
      lerTudo(o => sb.from('solicitacoes_titular').select('id, protocolo, tipo, status, canal_recebimento, recebida_em, prazo_resposta_em, identidade_verificada', o)
        .eq('cliente_id', id).order('recebida_em', { ascending: false }).order('id'), 'as solicitações LGPD'),
      lerTudo(o => sb.from('textos_consentimento').select('id, versao, canal, vigente_desde, vigente_ate', o).is('vigente_ate', null).order('vigente_desde', { ascending: false }).order('id'), 'os textos de consentimento')
    ]);
    if (cfg.length !== 1) throw new ErroDados('acesso', 'O banco não liberou a leitura dos dados. Saia e entre novamente com o código do autenticador.');
    if (!c) throw new ErroDados('nao_encontrado', 'Cliente não encontrado no Supabase.');
    // nomes dos outros clientes das sugestões (só nome e cidade)
    const outros = [...new Set(sugestoes.map(s => (s.cliente_id === id ? s.cliente_b_id : s.cliente_id)).filter(Boolean))];
    const nomes = outros.length ? await lerUm(() => sb.from('clientes').select('id, nome, cidade, uf, fonte').in('id', outros), 'as sugestões de vínculo') : [];
    const mapaNomes = new Map((nomes || []).map(x => [x.id, x]));
    const ficticio = c.fonte === 'ficticio';
    return {
      lidoEm: new Date(),
      cliente: {
        id: c.id, nome: c.nome, email: c.email, telefone: c.telefone, cidade: c.cidade, uf: c.uf, origem: c.origem,
        status: c.status_comercial, fonte: c.fonte, anonimizado: !!c.anonimizado_em, anonimizadoEm: c.anonimizado_em,
        cadastradoEm: c.cadastrado_em, versao: num(c.versao), nuvemshopId: c.nuvemshop_cliente_id, grupo: c.grupo_pessoa_id
      },
      resumo: resumo ? { pedidos: num(resumo.pedidos_pagos), total: num(resumo.total_pago), primeira: resumo.primeira_compra, ultima: resumo.ultima_compra,
                         diasSemComprar: resumo.dias_sem_comprar, segmento: resumo.segmento, podeWhatsapp: resumo.pode_whatsapp === true, podeEmail: resumo.pode_email === true } : null,
      pedidos: pedidos.map(p => ({ id: p.id, numero: p.numero, data: p.data_pedido, status: p.status, total: num(p.total), subtotal: num(p.subtotal),
                                   desconto: num(p.desconto), frete: num(p.frete), cupom: p.cupom_codigo, fonte: p.fonte,
                                   foraDaOrigem: (p.fonte === 'ficticio') !== ficticio,
                                   itens: (p.pedido_itens || []).map(i => ({ produtoId: i.produto_id, nome: i.nome_produto, qtd: num(i.qtd), preco: num(i.preco_unit) })) })),
      permissoes: permAtuais, historicoPermissoes: permHist, oposicoes, interacoes, solicitacoes,
      sugestoes: sugestoes.map(s => {
        const outro = s.cliente_id === id ? s.cliente_b_id : s.cliente_id;
        return { id: s.id, tipo: s.tipo, motivo: s.motivo, criadoEm: s.criado_em, lead: !!s.lead_id, outro: mapaNomes.get(outro) || null };
      }),
      // concessão real nunca aponta para texto de TESTE (bloquearia a remoção dos fictícios, 010)
      textosVigentes: textos.filter(t => ficticio || !/^FICTICIO-/.test(t.versao))
    };
  }

  function clienteSalvar(d) {
    return rpc('cliente_salvar', {
      p_id: d.id || null, p_versao: d.id ? d.versao : null, p_nome: d.nome, p_email: d.email || null, p_telefone: d.telefone || null,
      p_cidade: d.cidade || null, p_uf: d.uf || null, p_origem: d.origem || null, p_status: d.status, p_confirmar_duplicado: !!d.confirmarDuplicado
    }, 'o cliente');
  }
  async function clientesPossiveisDuplicados(d) {
    const r = await rpc('clientes_possiveis_duplicados', { p_id: d.id || null, p_nome: d.nome || null, p_email: d.email || null, p_telefone: d.telefone || null, p_cidade: d.cidade || null }, 'os possíveis duplicados');
    return Array.isArray(r) ? r : [];
  }
  function registrarPermissao(d) {
    const linha = { cliente_id: d.clienteId, canal: d.canal, situacao: d.situacao, como_obtida: d.comoObtida };
    if (d.meioColeta) linha.meio_coleta = d.meioColeta;
    if (d.evidenciaRef) linha.evidencia_ref = d.evidenciaRef;
    if (d.textoId) linha.texto_consentimento_id = d.textoId;
    if (d.ocorridoEm) linha.ocorrido_em = d.ocorridoEm;
    return gravar(() => sb.from('permissoes_comunicacao').insert(linha), 'a permissão');
  }
  function registrarOposicao(d) {
    return gravar(() => sb.from('oposicoes').insert({ cliente_id: d.clienteId, escopo: d.escopo, como_recebida: d.comoRecebida }), 'a oposição');
  }
  function encerrarOposicao(id, motivo) {
    return gravar(() => sb.from('oposicoes').update({ encerrada_em: new Date().toISOString(), motivo_encerramento: motivo }).eq('id', id).is('encerrada_em', null).select('id'), 'a oposição')
      .then(r => { if (!r || !r.length) throw new ErroDados('permissao', 'A oposição não foi encerrada (só administrador com 2 etapas pode encerrar, e ela não pode já estar encerrada).'); return r; });
  }
  function registrarInteracao(d) {
    const linha = { cliente_id: d.clienteId, canal: d.canal, nota: d.nota };
    if (d.data) linha.data = d.data;
    return gravar(() => sb.from('interacoes').insert(linha), 'a interação');
  }
  function registrarSolicitacao(d) {
    const linha = { cliente_id: d.clienteId, tipo: d.tipo, canal_recebimento: d.canal };
    if (d.contato) linha.contato_resposta = d.contato;
    if (d.descricao) linha.descricao = d.descricao;
    return gravar(() => sb.from('solicitacoes_titular').insert(linha).select('id, protocolo'), 'a solicitação');
  }
  function iniciarAtendimento(id, comoVerificada) {
    const mud = { status: 'em_andamento' };
    if (comoVerificada) { mud.identidade_verificada = true; mud.como_verificada = comoVerificada; }
    return gravar(() => sb.from('solicitacoes_titular').update(mud).eq('id', id).eq('status', 'recebida').select('id, status'), 'a solicitação')
      .then(r => { if (!r || !r.length) throw new ErroDados('permissao', 'A solicitação não foi atualizada (só administrador com 2 etapas trata solicitações, e ela precisa estar "recebida").'); return r; });
  }
  function cadastrarTextoConsentimento(d) {
    const linha = { versao: d.versao, texto: d.texto, canal: d.canal || null };
    if (d.vigenteDesde) linha.vigente_desde = d.vigenteDesde;
    return gravar(() => sb.from('textos_consentimento').insert(linha).select('id'), 'o texto de consentimento')
      .then(r => { if (!r || !r.length) throw new ErroDados('permissao', 'Só administrador com 2 etapas cadastra textos de consentimento.'); return r; });
  }
  function anonimizarSimular(clienteId, solicitacaoId) {
    return rpc('anonimizar_titular', { p_cliente: clienteId, p_lead: null, p_origem: 'solicitacao', p_solicitacao: solicitacaoId, p_executar: false, p_confirmacao: null }, 'a anonimização');
  }
  function anonimizarExecutar(clienteId, solicitacaoId, confirmacao) {
    return rpc('anonimizar_titular', { p_cliente: clienteId, p_lead: null, p_origem: 'solicitacao', p_solicitacao: solicitacaoId, p_executar: true, p_confirmacao: confirmacao }, 'a anonimização');
  }
  // Confirmação reforçada: novo código do autenticador (renova o horário do código no token — exigido pela 008)
  async function reconfirmarCodigo(codigo) {
    exigirCliente();
    const f = await sb.auth.mfa.listFactors();
    if (f.error) throw traduzirErro(f.error, 'o autenticador');
    const totp = ((f.data && f.data.totp) || [])[0];
    if (!totp) throw new ErroDados('permissao', 'Nenhum autenticador cadastrado nesta conta.');
    const r = await sb.auth.mfa.challengeAndVerify({ factorId: totp.id, code: String(codigo || '').replace(/\D/g, '') });
    if (r.error) throw new ErroDados('validacao', r.error.status === 429 ? 'Muitas tentativas. Aguarde alguns minutos.' : 'Código incorreto ou expirado. Digite o código atual do aplicativo.');
    return true;
  }

  // ---------------------------------------------------------------
  // Recompra (migração 013): v_recompra_painel + recompra_registrar
  //   A visão não tem e-mail/telefone. O contato só é lido sob demanda, para
  //   os canais com permissão atual (ver recompraContato).
  // ---------------------------------------------------------------
  const COLUNAS_PAINEL = 'cliente_id, cliente_nome, cliente_fonte, status_comercial, produto_id, produto, produto_sku, ultima_compra, qtd, '
    + 'compras_do_produto, ciclo_recompra_dias, reposicao_estimada, dias_restantes, dias_sem_comprar, ultima_compra_cliente, situacao, '
    + 'pode_whatsapp, pode_email, pode_contatar, acompanhamento, ultimo_acompanhamento_id, ultimo_resultado, ultimo_acompanhamento_em, '
    + 'proxima_acao, proxima_acao_em, acompanhamentos';
  const SITUACOES_RECOMPRA = ['janela', 'atrasado', 'antes_da_janela', 'inativo'];
  const ACOMP_RECOMPRA = ['sem_acompanhamento', 'agendada', 'vencida', 'encerrada'];
  const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
  const filtrarOrigemCliente = (q, origem) => (origem === 'ficticio' ? q.eq('cliente_fonte', 'ficticio') : q.neq('cliente_fonte', 'ficticio'));

  function mapearOportunidade(x) {
    return {
      clienteId: x.cliente_id, cliente: x.cliente_nome, fonte: x.cliente_fonte, statusComercial: x.status_comercial,
      produtoId: x.produto_id, produto: x.produto, sku: x.produto_sku,
      ultimaCompra: x.ultima_compra, qtd: num(x.qtd), compras: num(x.compras_do_produto), ciclo: num(x.ciclo_recompra_dias),
      estimada: x.reposicao_estimada, diasRestantes: num(x.dias_restantes), diasSemComprar: num(x.dias_sem_comprar),
      ultimaCompraCliente: x.ultima_compra_cliente, situacao: x.situacao,
      podeWhatsapp: x.pode_whatsapp === true, podeEmail: x.pode_email === true, podeContatar: x.pode_contatar === true,
      acompanhamento: x.acompanhamento, ultimoId: x.ultimo_acompanhamento_id || null, ultimoResultado: x.ultimo_resultado,
      ultimoEm: x.ultimo_acompanhamento_em, proximaAcao: x.proxima_acao, proximaAcaoEm: x.proxima_acao_em,
      acompanhamentos: num(x.acompanhamentos)
    };
  }

  // Aplica os filtros da tela (todos no servidor). "sem" = nomes de filtros a ignorar (usado nos contadores).
  function filtrarRecompra(q, f, sem) {
    const ign = new Set(sem || []);
    q = filtrarOrigemCliente(q, f.origem === 'ficticio' ? 'ficticio' : 'real');
    if (!ign.has('situacao') && SITUACOES_RECOMPRA.includes(f.situacao)) q = q.eq('situacao', f.situacao);
    if (!ign.has('acompanhamento')) {
      if (f.acompanhamento === 'abertas' || !f.acompanhamento) q = q.neq('acompanhamento', 'encerrada');
      else if (ACOMP_RECOMPRA.includes(f.acompanhamento)) q = q.eq('acompanhamento', f.acompanhamento);
    }
    if (UUID_RE.test(String(f.produto || ''))) q = q.eq('produto_id', f.produto);
    if (f.contato === 'whatsapp') q = q.eq('pode_whatsapp', true);
    else if (f.contato === 'email') q = q.eq('pode_email', true);
    else if (f.contato === 'algum') q = q.eq('pode_contatar', true);
    else if (f.contato === 'nenhum') q = q.eq('pode_contatar', false);
    if (DATA_RE.test(String(f.de || ''))) q = q.gte('reposicao_estimada', f.de);
    if (DATA_RE.test(String(f.ate || ''))) q = q.lte('reposicao_estimada', f.ate);
    const t = termoBusca(f.q);
    if (t) q = q.ilike('cliente_nome', `*${t}*`);
    return q;
  }

  async function contar(montar, oque) {
    let r;
    try { r = await montar(); } catch (e) { throw traduzirErro(e, oque); }
    if (r.error) throw traduzirErro(r.error, oque);
    return typeof r.count === 'number' ? r.count : 0;
  }

  /** Lista paginada no servidor + contadores por situação (mesmos filtros, exceto situação). */
  async function recompraLista(f) {
    exigirCliente();
    const origem = f.origem === 'ficticio' ? 'ficticio' : 'real';
    const porPagina = Math.min(Math.max(Number(f.porPagina) || 25, 10), 100);
    const pagina = Math.max(Number(f.pagina) || 1, 1);
    if (f.de && f.ate && DATA_RE.test(f.de) && DATA_RE.test(f.ate) && f.de > f.ate)
      throw new ErroDados('validacao', 'Período inválido: a data inicial é posterior à final.');
    const ff = Object.assign({}, f, { origem });
    const montar = () => {
      let q = filtrarRecompra(sb.from('v_recompra_painel').select(COLUNAS_PAINEL, { count: 'exact' }), ff);
      if (f.ordem === 'cliente') q = q.order('cliente_nome', { ascending: true, nullsFirst: false });
      else if (f.ordem === 'proxima') q = q.order('proxima_acao_em', { ascending: true, nullsFirst: false }).order('reposicao_estimada');
      else if (f.ordem === 'ultima') q = q.order('ultima_compra', { ascending: false });
      else q = q.order('reposicao_estimada', { ascending: true });
      return q.order('cliente_id').order('produto_id').range((pagina - 1) * porPagina, pagina * porPagina - 1);
    };
    const contadores = SITUACOES_RECOMPRA.map(s => contar(() =>
      filtrarRecompra(sb.from('v_recompra_painel').select('cliente_id', { count: 'exact', head: true }), Object.assign({}, ff, { situacao: s }), []), 'os contadores'));
    const vencidas = contar(() => filtrarRecompra(sb.from('v_recompra_painel').select('cliente_id', { count: 'exact', head: true }),
      Object.assign({}, ff, { situacao: '', acompanhamento: 'vencida' }), []), 'os contadores');
    let cfg, r, cont, venc, fic;
    try {
      [cfg, r, cont, venc, fic] = await Promise.all([
        lerTudo(o => sb.from('configuracoes').select('id, inativo_apos_dias, janela_antes_dias, janela_depois_dias', o).order('id'), 'as configurações'),
        montar(), Promise.all(contadores), vencidas,
        contar(() => sb.from('clientes').select('id', { count: 'exact', head: true }).eq('fonte', 'ficticio'), 'os dados de teste')
      ]);
    } catch (e) { throw e instanceof ErroDados ? e : traduzirErro(e, 'as oportunidades'); }
    if (r.error) throw traduzirErro(r.error, 'as oportunidades');
    if (cfg.length !== 1) throw new ErroDados('acesso', 'O banco não liberou a leitura dos dados. Saia e entre novamente com o código do autenticador.');
    const itens = (r.data || []).map(mapearOportunidade);
    if (itens.some(x => !daOrigem(x.fonte, origem))) throw new ErroDados('consulta', 'O banco devolveu oportunidades de outra origem. Nada foi exibido.');
    return {
      itens, total: typeof r.count === 'number' ? r.count : itens.length, pagina, porPagina, origem,
      contagem: Object.fromEntries(SITUACOES_RECOMPRA.map((s, i) => [s, cont[i]])), vencidas: venc,
      regras: { inativoAposDias: cfg[0].inativo_apos_dias, janelaAntesDias: cfg[0].janela_antes_dias, janelaDepoisDias: cfg[0].janela_depois_dias },
      existemFicticios: fic > 0, lidoEm: new Date()
    };
  }

  /** Produtos que geram recompra (ativos, com ciclo), da origem escolhida — para o filtro. */
  async function recompraProdutos(origem) {
    exigirCliente();
    const l = await lerTudo(o => filtrarOrigem(sb.from('produtos').select('id, nome, sku, fonte', o), origem === 'ficticio' ? 'ficticio' : 'real')
      .eq('ativo', true).not('ciclo_recompra_dias', 'is', null).order('nome').order('id'), 'os produtos');
    return l.map(p => ({ id: p.id, nome: p.nome, sku: p.sku }));
  }

  /** Oportunidade atual + histórico (todos os ciclos) deste cliente × produto + últimas interações do cliente. */
  async function recompraDetalhe(clienteId, produtoId) {
    exigirCliente();
    if (!UUID_RE.test(String(clienteId || '')) || !UUID_RE.test(String(produtoId || ''))) throw new ErroDados('nao_encontrado', 'Oportunidade inválida.');
    const [op, hist, inter] = await Promise.all([
      lerUm(() => sb.from('v_recompra_painel').select(COLUNAS_PAINEL).eq('cliente_id', clienteId).eq('produto_id', produtoId).maybeSingle(), 'a oportunidade'),
      lerTudo(o => sb.from('recompra_acompanhamentos')
        .select('id, compra_referencia, canal, iniciativa, resultado, proxima_acao, proxima_acao_em, criado_em, interacoes(nota)', o)
        .eq('cliente_id', clienteId).eq('produto_id', produtoId).order('seq', { ascending: false }), 'o histórico de acompanhamento'),
      lerUm(() => sb.from('interacoes').select('id, data, canal, nota, fonte').eq('cliente_id', clienteId)
        .order('data', { ascending: false }).order('id').limit(10), 'as interações')
    ]);
    if (!op) throw new ErroDados('nao_encontrado', 'Esta oportunidade não está mais disponível (nova compra, produto desativado, oposição, "não contatar" ou anonimização).');
    return {
      oportunidade: mapearOportunidade(op),
      historico: hist.map(h => ({
        id: h.id, compraReferencia: h.compra_referencia, canal: h.canal, iniciativa: h.iniciativa, resultado: h.resultado,
        proximaAcao: h.proxima_acao, proximaAcaoEm: h.proxima_acao_em, em: h.criado_em, nota: h.interacoes ? h.interacoes.nota : null
      })),
      interacoes: inter || [],
      lidoEm: new Date()
    };
  }

  /** Contato do cliente SÓ para os canais com permissão atual (minimização: nada é lido para canal bloqueado). */
  async function recompraContato(clienteId, canais) {
    exigirCliente();
    if (!UUID_RE.test(String(clienteId || ''))) throw new ErroDados('nao_encontrado', 'Cliente inválido.');
    const cols = ['id'];
    if (canais.whatsapp) cols.push('telefone');
    if (canais.email) cols.push('email');
    if (cols.length === 1) return {};
    const c = await lerUm(() => sb.from('clientes').select(cols.join(', ')).eq('id', clienteId).maybeSingle(), 'o contato');
    if (!c) throw new ErroDados('nao_encontrado', 'Cliente não encontrado.');
    return { telefone: canais.whatsapp ? c.telefone || null : undefined, email: canais.email ? c.email || null : undefined };
  }

  function recompraRegistrar(d) {
    return rpc('recompra_registrar', {
      p_cliente: d.clienteId, p_produto: d.produtoId, p_compra_referencia: d.compraReferencia,
      p_canal: d.canal, p_iniciativa: d.iniciativa, p_resultado: d.resultado, p_nota: d.nota || null,
      p_proxima_acao: d.proximaAcao || null, p_proxima_acao_em: d.proximaAcaoEm || null, p_ultimo_conhecido: d.ultimoConhecido || null
    }, 'o acompanhamento');
  }

  // ---------------------------------------------------------------
  // Prospecção & Funil (004 leads/histórico/interações/sugestões, 005 bases para contato,
  //   007 auditoria e supressão, 008 MFA/anonimização, 015 separação real × fictício).
  //   Leitura e gravação direto nas tabelas, sempre sob o RLS (perfil ativo + 2 etapas).
  //   Edição simultânea: toda alteração grava "onde atualizado_em = <valor lido>".
  //   Nada é enviado a ninguém: a tela só registra.
  // ---------------------------------------------------------------
  const ETAPAS_FUNIL = ['novo', 'autorizado', 'atendimento', 'interessado', 'proposta', 'comprou', 'perdido'];
  const FINALIDADES_CONTATO = ['atendimento_solicitado', 'prospeccao_b2b', 'relacionamento'];
  const BASES_CONTATO = {               // combinações aceitas pela 005 (R6) para liberar o funil
    'atendimento_solicitado|contrato_ou_preliminares': true, 'atendimento_solicitado|consentimento': true,
    'prospeccao_b2b|consentimento': true, 'prospeccao_b2b|legitimo_interesse': true,
    'relacionamento|consentimento': true, 'relacionamento|legitimo_interesse': true
  };
  const CANAIS_INTERACAO = ['whatsapp', 'email', 'telefone', 'instagram'];
  const COLUNAS_LEAD = 'id, nome, origem, email, telefone, empresa, etapa, proximo_contato, valor_potencial, motivo_perda, '
    + 'responsavel_id, cliente_id, cliente_vinculado_em, motivo_duplicidade, fonte, criado_por, criado_em, atualizado_em';
  const MSG_SEM_ACESSO = 'O banco não liberou a leitura dos dados. Saia e entre novamente com o código do autenticador.';

  // Mesmas regras de app.normalizar_email / app.normalizar_telefone (001)
  function normEmail(e) { const t = String(e || '').replace(/^ +| +$/g, '').toLowerCase(); return t || null; }
  function normTelefone(t) {
    const s = String(t || ''), d = s.replace(/\D/g, '');
    if (!d) return null;
    if (s.replace(/^ +/, '').startsWith('+')) return d;
    return d.length === 10 || d.length === 11 ? '55' + d : d;
  }

  function mapearLead(l, nomes) {
    return {
      id: l.id, nome: l.nome, origem: l.origem, email: l.email, telefone: l.telefone, empresa: l.empresa,
      etapa: l.etapa, proximoContato: l.proximo_contato, valor: num(l.valor_potencial), motivoPerda: l.motivo_perda,
      responsavelId: l.responsavel_id, responsavel: l.responsavel_id ? (nomes.get(l.responsavel_id) || 'Outro usuário') : null,
      clienteId: l.cliente_id, clienteVinculadoEm: l.cliente_vinculado_em, motivoDuplicidade: l.motivo_duplicidade,
      fonte: l.fonte, criadoPor: l.criado_por ? (nomes.get(l.criado_por) || 'Outro usuário') : null,
      criadoEm: diaLocal(l.criado_em), atualizadoEm: l.atualizado_em
    };
  }

  // Nomes de usuários: o banco mostra ao operador só o próprio perfil; ao administrador, todos (002).
  async function perfisVisiveis() {
    const p = await lerTudo(o => sb.from('perfis').select('id, nome, papel, ativo', o).order('nome').order('id'), 'os usuários');
    return p.map(x => ({ id: x.id, nome: x.nome, papel: x.papel, ativo: x.ativo }));
  }

  // id do usuário da sessão (só para "Meus contatos" e "(você)" na tela; quem decide acesso é o RLS)
  async function usuarioDaSessao() {
    try { const r = await sb.auth.getSession(); return (r && r.data && r.data.session && r.data.session.user && r.data.session.user.id) || null; }
    catch (e) { return null; }
  }

  // Origem (real × fictício) dos clientes citados, em lotes
  async function fontesDeClientes(ids) {
    const unicos = [...new Set(ids.filter(x => UUID_RE.test(String(x || ''))))];
    const mapa = new Map();
    for (let i = 0; i < unicos.length; i += 150) {
      const lote = unicos.slice(i, i + 150);
      const r = await lerUm(() => sb.from('clientes').select('id, nome, cidade, uf, fonte, anonimizado_em').in('id', lote), 'os clientes vinculados');
      (r || []).forEach(c => mapa.set(c.id, c));
    }
    return mapa;
  }

  /** Quadro do funil: contatos ATIVOS de uma origem + base para contato + sugestões de vínculo pendentes. */
  async function funilLista(origemPedida) {
    exigirCliente();
    const origem = origemPedida === 'ficticio' ? 'ficticio' : 'real';
    let cfg, leads, bases, sugestoes, perfis, fic, eu;
    try {
      [cfg, leads, bases, sugestoes, perfis, fic, eu] = await Promise.all([
        lerTudo(o => sb.from('configuracoes').select('id', o).order('id'), 'as configurações'),
        lerTudo(o => filtrarOrigem(sb.from('leads').select(COLUNAS_LEAD, o), origem).is('anonimizado_em', null)
          .order('criado_em', { ascending: false }).order('id'), 'os contatos do funil'),
        lerTudo(o => sb.from('bases_tratamento').select('id, lead_id', o).not('lead_id', 'is', null).is('encerrada_em', null)
          .in('finalidade', FINALIDADES_CONTATO).order('id'), 'as bases para contato'),
        lerTudo(o => sb.from('sugestoes_vinculo').select('id, lead_id, cliente_id', o).eq('tipo', 'lead_cliente').eq('status', 'pendente').order('id'), 'as sugestões de vínculo'),
        perfisVisiveis(),
        contar(() => sb.from('leads').select('id', { count: 'exact', head: true }).eq('fonte', 'ficticio'), 'os dados de teste'),
        usuarioDaSessao()
      ]);
    } catch (e) { throw e instanceof ErroDados ? e : traduzirErro(e, 'o funil'); }
    if (cfg.length !== 1) throw new ErroDados('acesso', MSG_SEM_ACESSO);
    if (leads.some(l => !daOrigem(l.fonte, origem))) throw new ErroDados('consulta', 'O banco devolveu contatos de outra origem. Nada foi exibido.');

    const idsLeads = new Set(leads.map(l => l.id));
    const sugs = sugestoes.filter(s => idsLeads.has(s.lead_id));
    const fontes = await fontesDeClientes(sugs.map(s => s.cliente_id));
    const comBase = new Set(bases.map(b => b.lead_id));
    const nSug = new Map();
    sugs.forEach(s => {                  // sugestão para cliente de OUTRA origem ou anonimizado não aparece
      const c = fontes.get(s.cliente_id);
      if (!c || c.anonimizado_em || !daOrigem(c.fonte, origem)) return;
      nSug.set(s.lead_id, (nSug.get(s.lead_id) || 0) + 1);
    });
    const nomes = new Map(perfis.map(p => [p.id, p.nome]));
    return {
      origem, lidoEm: new Date(), existemFicticios: fic > 0, perfis, usuarioId: eu,
      itens: leads.map(l => Object.assign(mapearLead(l, nomes), { temBase: comBase.has(l.id), sugestoes: nSug.get(l.id) || 0 }))
    };
  }

  /** Ficha completa de um contato do funil. */
  async function funilLead(id) {
    exigirCliente();
    if (!UUID_RE.test(String(id || ''))) throw new ErroDados('nao_encontrado', 'Contato inválido.');
    const [l, movs, inter, bases, sugs, hist, oposicoes, perfis, testes, eu] = await Promise.all([
      lerUm(() => sb.from('leads').select(COLUNAS_LEAD + ', anonimizado_em').eq('id', id).maybeSingle(), 'o contato'),
      lerTudo(o => sb.from('lead_movimentacoes').select('id, etapa_anterior, etapa_nova, movido_por, movido_em', o).eq('lead_id', id)
        .order('movido_em', { ascending: false }).order('id'), 'o histórico do funil'),
      lerTudo(o => sb.from('interacoes').select('id, data, canal, nota, autor_id, fonte', o).eq('lead_id', id)
        .order('data', { ascending: false }).order('id'), 'as observações'),
      lerTudo(o => sb.from('bases_tratamento').select('id, finalidade, base_legal, evidencia, registrado_por, registrado_em, encerrada_em, motivo_encerramento', o)
        .eq('lead_id', id).order('registrado_em', { ascending: false }).order('id'), 'as bases para contato'),
      lerTudo(o => sb.from('sugestoes_vinculo').select('id, cliente_id, motivo, criado_em', o).eq('lead_id', id).eq('tipo', 'lead_cliente')
        .eq('status', 'pendente').order('criado_em').order('id'), 'as sugestões de vínculo'),
      lerTudo(o => sb.from('lead_vinculos_historico').select('id, acao, cliente_id, cliente_anterior_id, origem, feito_por, feito_em', o).eq('lead_id', id)
        .order('feito_em', { ascending: false }).order('id'), 'o histórico de vínculos'),
      lerTudo(o => sb.from('oposicoes').select('id, escopo', o).eq('lead_id', id).is('encerrada_em', null).order('id'), 'as oposições'),
      perfisVisiveis(),
      lerTudo(o => sb.from('testes_legitimo_interesse').select('id, finalidade', o).is('encerrado_em', null).order('id'), 'os testes de legítimo interesse'),
      usuarioDaSessao()
    ]);
    if (!l) throw new ErroDados('nao_encontrado', 'Contato não encontrado (pode ter sido excluído).');
    const nomes = new Map(perfis.map(p => [p.id, p.nome]));
    const quem = idp => (idp ? nomes.get(idp) || 'Outro usuário' : 'Sistema');
    const clientes = await fontesDeClientes([l.cliente_id, ...sugs.map(s => s.cliente_id), ...hist.map(h => h.cliente_id), ...hist.map(h => h.cliente_anterior_id)]);
    const resumoCliente = cid => { const c = clientes.get(cid); return c ? { id: c.id, nome: c.anonimizado_em ? 'Cliente anonimizado' : c.nome, cidade: c.cidade, uf: c.uf, fonte: c.fonte } : null; };
    const origem = l.fonte === 'ficticio' ? 'ficticio' : 'real';
    const oposicaoTotal = oposicoes.some(o => o.escopo === 'todo_contato_nao_essencial');
    return {
      lidoEm: new Date(), perfis, usuarioId: eu,
      lead: Object.assign(mapearLead(l, nomes), {
        anonimizado: !!l.anonimizado_em,
        temBase: bases.some(b => !b.encerrada_em && FINALIDADES_CONTATO.includes(b.finalidade)),
        oposicaoTotal, oposicaoMarketing: oposicoes.some(o => o.escopo === 'marketing')
      }),
      cliente: l.cliente_id ? resumoCliente(l.cliente_id) : null,
      movimentacoes: movs.map(m => ({ de: m.etapa_anterior, para: m.etapa_nova, por: quem(m.movido_por), em: m.movido_em })),
      interacoes: inter.map(i => ({ id: i.id, data: i.data, canal: i.canal, nota: i.nota, por: quem(i.autor_id), fonte: i.fonte })),
      bases: bases.map(b => ({ id: b.id, finalidade: b.finalidade, baseLegal: b.base_legal, evidencia: b.evidencia, por: quem(b.registrado_por),
                               em: b.registrado_em, encerradaEm: b.encerrada_em, motivoEncerramento: b.motivo_encerramento })),
      // só clientes da MESMA origem e não anonimizados (sugestão mista é resolvida na remoção dos fictícios)
      sugestoes: sugs.map(s => ({ id: s.id, motivo: s.motivo, criadoEm: s.criado_em, cliente: resumoCliente(s.cliente_id) }))
        .filter(s => s.cliente && s.cliente.nome !== 'Cliente anonimizado' && daOrigem(s.cliente.fonte, origem)),
      vinculos: hist.map(h => ({ acao: h.acao, cliente: resumoCliente(h.cliente_id), anterior: resumoCliente(h.cliente_anterior_id), origem: h.origem, por: quem(h.feito_por), em: h.feito_em })),
      testesLi: testes.map(t => ({ id: t.id, finalidade: t.finalidade }))
    };
  }

  /** Possíveis duplicados ANTES de criar: contatos reais do funil com o mesmo e-mail/telefone e clientes reais
   *  (clientes_possiveis_duplicados, 012: só reais, sem devolver contato). Nunca bloqueia: a pessoa decide. */
  async function funilPossiveisDuplicados(d) {
    exigirCliente();
    const em = normEmail(d.email), tel = normTelefone(d.telefone);
    const consultas = [];
    const leadsPor = col => lerUm(() => sb.from('leads').select('id, nome, empresa, etapa, fonte').eq(col.c, col.v)
      .neq('fonte', 'ficticio').is('anonimizado_em', null).limit(20), 'os possíveis duplicados');
    if (em) consultas.push(leadsPor({ c: 'email_norm', v: em }).then(r => (r || []).map(x => Object.assign(x, { motivo: 'mesmo_email' }))));
    if (tel) consultas.push(leadsPor({ c: 'telefone_norm', v: tel }).then(r => (r || []).map(x => Object.assign(x, { motivo: 'mesmo_telefone' }))));
    const [cli, ...listas] = await Promise.all([
      (em || tel) ? rpc('clientes_possiveis_duplicados', { p_id: null, p_nome: d.nome || null, p_email: d.email || null, p_telefone: d.telefone || null, p_cidade: null }, 'os possíveis duplicados') : Promise.resolve([]),
      ...consultas
    ]);
    const leads = new Map();
    listas.flat().forEach(x => { if (x.id !== d.id && !leads.has(x.id)) leads.set(x.id, { id: x.id, nome: x.nome, empresa: x.empresa, etapa: x.etapa, motivo: x.motivo }); });
    const clientes = (Array.isArray(cli) ? cli : []).filter(c => c.motivo !== 'nome_cidade')
      .map(c => ({ id: c.id, nome: c.nome, cidade: c.cidade, uf: c.uf, motivo: c.motivo }));
    return { leads: [...leads.values()], clientes };
  }

  async function exigirClienteReal(clienteId) {
    if (!UUID_RE.test(String(clienteId || ''))) throw new ErroDados('validacao', 'Cliente inválido.');
    const c = await lerUm(() => sb.from('clientes').select('id, fonte, anonimizado_em').eq('id', clienteId).maybeSingle(), 'o cliente');
    if (!c) throw new ErroDados('nao_encontrado', 'Cliente não encontrado.');
    if (c.fonte === 'ficticio') throw new ErroDados('validacao', 'Contato real não pode ser vinculado a cliente fictício (dados de teste).');
    if (c.anonimizado_em) throw new ErroDados('validacao', 'Cliente anonimizado não pode ser vinculado a um contato.');
  }

  function linhaBase(leadId, b) {
    if (!BASES_CONTATO[`${b.finalidade}|${b.baseLegal}`]) throw new ErroDados('validacao', 'Escolha uma base para contato válida.');
    const linha = { lead_id: leadId, finalidade: b.finalidade, base_legal: b.baseLegal, evidencia: String(b.evidencia || '').trim() };
    if (b.baseLegal === 'legitimo_interesse') {
      if (!UUID_RE.test(String(b.testeLiId || ''))) throw new ErroDados('validacao', 'Legítimo interesse exige teste aprovado pelo administrador.');
      linha.teste_li_id = b.testeLiId;
    }
    return linha;
  }

  /** Cria contato real (fonte "manual", carimbos de autor/responsável pelo banco). Etapa inicial sempre "Novo contato";
   *  com base para contato informada, registra a base e avança para "Contato autorizado". */
  async function funilCriar(d) {
    exigirCliente();
    const linha = {
      nome: String(d.nome || '').trim(), origem: d.origem,
      email: String(d.email || '').trim() || null, telefone: String(d.telefone || '').trim() || null,
      empresa: String(d.empresa || '').trim() || null, proximo_contato: d.proximoContato || null,
      valor_potencial: Number(d.valor) > 0 ? Number(d.valor) : 0
    };
    if (UUID_RE.test(String(d.responsavelId || ''))) linha.responsavel_id = d.responsavelId;
    if (d.clienteId) { await exigirClienteReal(d.clienteId); linha.cliente_id = d.clienteId; }
    if (d.motivoDuplicidade) linha.motivo_duplicidade = String(d.motivoDuplicidade).trim().slice(0, 500);
    const baseLinha = d.base ? linhaBase('00000000-0000-0000-0000-000000000000', d.base) : null;   // valida antes de criar
    const r = await gravar(() => sb.from('leads').insert(linha).select('id, atualizado_em').single(), 'o contato');
    const avisos = [];
    if (baseLinha) {
      try {
        await gravar(() => sb.from('bases_tratamento').insert(Object.assign(baseLinha, { lead_id: r.id })), 'a base para contato');
        await funilAtualizar(r.id, r.atualizado_em, { etapa: 'autorizado' });
      } catch (e) { avisos.push(`A base para contato não foi registrada (${e.message}). O contato ficou em "Novo contato".`); }
    }
    if (d.nota) {
      try { await funilRegistrarInteracao(r.id, { canal: d.canal, nota: d.nota }); }
      catch (e) { avisos.push(`A observação não foi registrada (${e.message}).`); }
    }
    return { id: r.id, avisos };
  }

  /** Altera o contato SÓ se ninguém o alterou depois da leitura (atualizado_em). */
  async function funilAtualizar(id, atualizadoEm, patch) {
    exigirCliente();
    if (!UUID_RE.test(String(id || '')) || !atualizadoEm) throw new ErroDados('validacao', 'Contato inválido.');
    const m = {};
    const mapa = { nome: 'nome', origem: 'origem', email: 'email', telefone: 'telefone', empresa: 'empresa', etapa: 'etapa',
                   proximoContato: 'proximo_contato', valor: 'valor_potencial', motivoPerda: 'motivo_perda', responsavelId: 'responsavel_id',
                   clienteId: 'cliente_id' };
    Object.keys(patch).forEach(k => {
      const col = mapa[k] || (Object.values(mapa).includes(k) ? k : null);
      if (!col) return;
      let v = patch[k];
      if (typeof v === 'string') v = v.trim();
      m[col] = v === '' ? null : v;
    });
    if (m.etapa && !ETAPAS_FUNIL.includes(m.etapa)) throw new ErroDados('validacao', 'Etapa inválida.');
    if (m.etapa === 'comprou' || m.etapa === 'perdido') m.proximo_contato = null;
    if (m.valor_potencial !== undefined) m.valor_potencial = Number(m.valor_potencial) > 0 ? Number(m.valor_potencial) : 0;
    if (m.cliente_id) await exigirClienteReal(m.cliente_id);
    const r = await gravar(() => sb.from('leads').update(m).eq('id', id).eq('atualizado_em', atualizadoEm).select('id, atualizado_em'), 'o contato');
    if (r && r.length) return r[0];
    const atual = await lerUm(() => sb.from('leads').select('id, atualizado_em, anonimizado_em').eq('id', id).maybeSingle(), 'o contato');
    if (!atual) throw new ErroDados('nao_encontrado', 'Este contato não existe mais.');
    if (atual.anonimizado_em) throw new ErroDados('permissao', 'Contato anonimizado (LGPD): não pode ser alterado.');
    if (atual.atualizado_em !== atualizadoEm) throw new ErroDados('conflito', 'Este contato foi alterado por outra pessoa enquanto você editava. Os dados foram recarregados: confira e salve de novo.');
    throw new ErroDados('permissao', 'O banco não permitiu a alteração. Verifique se o seu perfil está ativo com verificação em 2 etapas.');
  }

  function funilRegistrarBase(leadId, b) {
    return gravar(() => sb.from('bases_tratamento').insert(linhaBase(leadId, b)), 'a base para contato');
  }

  function funilRegistrarInteracao(leadId, d) {
    if (!CANAIS_INTERACAO.includes(d.canal)) return Promise.reject(new ErroDados('validacao', 'Escolha o canal.'));
    const nota = String(d.nota || '').trim();
    if (!nota || nota.length > 2000) return Promise.reject(new ErroDados('validacao', 'A observação precisa ter de 1 a 2.000 caracteres.'));
    const linha = { lead_id: leadId, canal: d.canal, nota };
    if (d.data) linha.data = d.data;
    return gravar(() => sb.from('interacoes').insert(linha), 'a observação');
  }

  async function funilRejeitarSugestao(id) {
    const r = await gravar(() => sb.from('sugestoes_vinculo').update({ status: 'rejeitada' }).eq('id', id).eq('status', 'pendente').select('id'), 'a sugestão');
    if (!r || !r.length) throw new ErroDados('conflito', 'A sugestão já foi decidida ou não está mais disponível.');
    return r;
  }

  /** Busca de clientes REAIS para vincular (nome, ou e-mail/telefone completos via RPC que devolve só IDs). */
  async function funilBuscarClientes(q) {
    exigirCliente();
    const t = termoBusca(q);
    if (t.length < 2) return [];
    const ids = await idsPorContato(q);
    let consulta = sb.from('v_clientes_resumo').select('id, nome, cidade, uf, fonte, pedidos_pagos').neq('fonte', 'ficticio').eq('anonimizado', false);
    consulta = ids.length ? consulta.or(`nome.ilike.*${t}*,id.in.(${ids.join(',')})`) : consulta.ilike('nome', `*${t}*`);
    const r = await lerUm(() => consulta.order('nome').order('id').limit(10), 'os clientes');
    return (r || []).filter(c => c.fonte !== 'ficticio').map(c => ({ id: c.id, nome: c.nome, cidade: c.cidade, uf: c.uf, pedidos: num(c.pedidos_pagos) }));
  }

  // ---------------------------------------------------------------
  // Campanhas (006 + 016): campanhas, destinatários (só pela função de inclusão, com a regra
  //   única de permissão de marketing), envio MANUAL marcado e revalidado, aprovação humana
  //   (administrador), resultados com atribuição SÓ com evidência (pedido pago da Nuvemshop,
  //   com o cupom da campanha, depois do envio, na janela). Cupons: referência local do código
  //   que já existe na loja (administrador). Nada é enviado nem alterado na Nuvemshop.
  // ---------------------------------------------------------------
  const COLUNAS_RESULTADO = 'campanha_id, nome, objetivo, canal, publico, status, cupom, aprovada_em, iniciada_em, concluida_em, meta_pedidos, meta_receita, '
    + 'destinatarios, enviados, bloqueados, clientes_convertidos, pedidos_atribuidos, receita_atribuida, pedidos_com_produto_foco, '
    + 'usos_cupom_total, usos_cupom_fora_do_publico, usos_cupom_atribuidos_a_outra_campanha, fonte, data_inicio, data_fim, janela_atribuicao_dias, pendentes';
  const COLUNAS_CAMPANHA = 'id, nome, objetivo, canal, publico, cupom_id, mensagem, data_inicio, data_fim, janela_atribuicao_dias, meta_pedidos, meta_receita, '
    + 'observacoes, status, resultado_notas, aprovada_por, aprovada_em, aprovacao_observacao, criada_por, criada_em, iniciada_em, concluida_em, atualizado_em, fonte';
  const PUBLICOS_CAMPANHA = ['janela', 'atrasado', 'primeira_compra', 'recorrentes', 'fieis', 'inativos', 'selecao_manual'];
  const CANAIS_CAMPANHA = ['whatsapp', 'email'];

  function mapearResultado(r) {
    const enviados = num(r.enviados), comp = num(r.clientes_convertidos);
    return {
      id: r.campanha_id, nome: r.nome, objetivo: r.objetivo, canal: r.canal, publico: r.publico, status: r.status, cupom: r.cupom,
      aprovadaEm: r.aprovada_em, iniciadaEm: r.iniciada_em, concluidaEm: r.concluida_em, metaPedidos: r.meta_pedidos, metaReceita: r.meta_receita === null ? null : num(r.meta_receita),
      destinatarios: num(r.destinatarios), enviados, bloqueados: num(r.bloqueados), pendentes: num(r.pendentes),
      compradores: comp, pedidos: num(r.pedidos_atribuidos), receita: num(r.receita_atribuida), pedidosProdutoFoco: num(r.pedidos_com_produto_foco),
      taxa: enviados ? comp / enviados : NaN,
      usosCupom: r.usos_cupom_total === null ? null : num(r.usos_cupom_total),
      usosForaDoPublico: r.usos_cupom_fora_do_publico === null ? null : num(r.usos_cupom_fora_do_publico),
      usosOutraCampanha: r.usos_cupom_atribuidos_a_outra_campanha === null ? null : num(r.usos_cupom_atribuidos_a_outra_campanha),
      fonte: r.fonte, dataInicio: r.data_inicio, dataFim: r.data_fim, janela: num(r.janela_atribuicao_dias)
    };
  }

  /** Lista de campanhas de UMA origem, com os resultados calculados pelo banco. */
  async function campanhasLista(origemPedida) {
    exigirCliente();
    const origem = origemPedida === 'ficticio' ? 'ficticio' : 'real';
    let cfg, lista, fic;
    try {
      [cfg, lista, fic] = await Promise.all([
        lerTudo(o => sb.from('configuracoes').select('id', o).order('id'), 'as configurações'),
        lerTudo(o => filtrarOrigem(sb.from('v_campanhas_resultados').select(COLUNAS_RESULTADO, o), origem).order('campanha_id'), 'as campanhas'),
        contar(() => sb.from('campanhas').select('id', { count: 'exact', head: true }).eq('fonte', 'ficticio'), 'os dados de teste')
      ]);
    } catch (e) { throw e instanceof ErroDados ? e : traduzirErro(e, 'as campanhas'); }
    if (cfg.length !== 1) throw new ErroDados('acesso', MSG_SEM_ACESSO);
    if (lista.some(x => !daOrigem(x.fonte, origem))) throw new ErroDados('consulta', 'O banco devolveu campanhas de outra origem. Nada foi exibido.');
    const ordem = { andamento: 0, rascunho: 1, concluida: 2 };
    const itens = lista.map(mapearResultado)
      .sort((a, b) => (ordem[a.status] - ordem[b.status]) || String(b.iniciadaEm || '').localeCompare(String(a.iniciadaEm || '')) || a.nome.localeCompare(b.nome));
    return { origem, itens, existemFicticios: fic > 0, lidoEm: new Date() };
  }

  /** Campanha completa: dados, resultado, destinatários (sem contato), pedidos atribuídos (evidência), cupom e produtos. */
  async function campanhaDetalhe(id) {
    exigirCliente();
    if (!UUID_RE.test(String(id || ''))) throw new ErroDados('nao_encontrado', 'Este endereço não corresponde a uma campanha do Supabase (pode vir de uma tela que ainda usa a base local de teste).');
    const [c, res, dest, atrib, prods, perfis] = await Promise.all([
      lerUm(() => sb.from('campanhas').select(COLUNAS_CAMPANHA).eq('id', id).maybeSingle(), 'a campanha'),
      lerUm(() => sb.from('v_campanhas_resultados').select(COLUNAS_RESULTADO).eq('campanha_id', id).maybeSingle(), 'o resultado da campanha'),
      lerTudo(o => sb.from('v_campanha_destinatarios').select('id, cliente_id, nome, situacao, motivo_bloqueio, incluido_em, verificado_em, enviado_em, enviado_por, pode_enviar_agora', o)
        .eq('campanha_id', id).order('nome', { nullsFirst: false }).order('id'), 'os destinatários'),
      lerTudo(o => sb.from('v_atribuicao_pedidos').select('pedido_id, cliente_id, data_pedido, total, cupom_codigo, enviado_em', o)
        .eq('campanha_id', id).order('data_pedido', { ascending: false }).order('pedido_id'), 'os pedidos atribuídos'),
      lerTudo(o => sb.from('campanha_produtos').select('produto_id, produtos(nome, sku, ciclo_recompra_dias, nuvemshop_produto_id)', o).eq('campanha_id', id).order('produto_id'), 'os produtos da campanha'),
      perfisVisiveis()
    ]);
    if (!c) throw new ErroDados('nao_encontrado', 'Campanha não encontrada.');
    // consultas por lista de IDs em lotes (URL curta mesmo com campanhas grandes)
    const emLotes = async (ids, montar, oque) => {
      const unicos = [...new Set(ids)], saida = [];
      for (let i = 0; i < unicos.length; i += 150) saida.push(...((await lerUm(() => montar(unicos.slice(i, i + 150)), oque)) || []));
      return saida;
    };
    const [cupom, numeros, ultimas] = await Promise.all([
      c.cupom_id ? lerUm(() => sb.from('cupons').select('id, codigo, tipo, valor, ativo, fonte').eq('id', c.cupom_id).maybeSingle(), 'o cupom') : Promise.resolve(null),
      emLotes(atrib.map(a => a.pedido_id), l => sb.from('pedidos').select('id, numero, nuvemshop_pedido_id').in('id', l), 'os pedidos'),
      emLotes(dest.map(d => d.cliente_id), l => sb.from('v_clientes_resumo').select('id, ultima_compra').in('id', l), 'as últimas compras')
    ]);
    const nomes = new Map(perfis.map(p => [p.id, p.nome]));
    const quem = idp => (idp ? nomes.get(idp) || 'Outro usuário' : 'Sistema');
    const nomeCli = new Map(dest.map(d => [d.cliente_id, d.nome]));
    const numPed = new Map((numeros || []).map(p => [p.id, p.numero || (p.nuvemshop_pedido_id ? '#' + p.nuvemshop_pedido_id : '—')]));
    const ultima = new Map((ultimas || []).map(u => [u.id, u.ultima_compra]));
    return {
      lidoEm: new Date(),
      campanha: {
        id: c.id, nome: c.nome, objetivo: c.objetivo, canal: c.canal, publico: c.publico, cupomId: c.cupom_id, mensagem: c.mensagem,
        dataInicio: c.data_inicio, dataFim: c.data_fim, janela: c.janela_atribuicao_dias, metaPedidos: c.meta_pedidos, metaReceita: c.meta_receita === null ? null : num(c.meta_receita),
        observacoes: c.observacoes, status: c.status, resultadoNotas: c.resultado_notas,
        aprovadaPor: c.aprovada_por ? quem(c.aprovada_por) : null, aprovadaEm: c.aprovada_em, aprovacaoObservacao: c.aprovacao_observacao,
        criadaPor: quem(c.criada_por), criadaEm: c.criada_em, iniciadaEm: c.iniciada_em, concluidaEm: c.concluida_em, atualizadoEm: c.atualizado_em, fonte: c.fonte
      },
      resultado: res ? mapearResultado(res) : null,
      cupom: cupom ? { id: cupom.id, codigo: cupom.codigo, tipo: cupom.tipo, valor: cupom.valor === null ? null : num(cupom.valor), ativo: cupom.ativo, fonte: cupom.fonte } : null,
      produtos: prods.map(p => ({ id: p.produto_id, nome: p.produtos ? p.produtos.nome : '—', sku: p.produtos ? p.produtos.sku : null,
                                  ciclo: p.produtos ? p.produtos.ciclo_recompra_dias : null,
                                  produtoLoja: p.produtos && p.produtos.nuvemshop_produto_id !== null ? String(p.produtos.nuvemshop_produto_id) : null })),
      destinatarios: dest.map(d => ({ id: d.id, clienteId: d.cliente_id, nome: d.nome, situacao: d.situacao, motivo: d.motivo_bloqueio,
                                     incluidoEm: d.incluido_em, verificadoEm: d.verificado_em, enviadoEm: d.enviado_em, enviadoPor: d.enviado_em ? quem(d.enviado_por) : null,
                                     podeEnviar: d.pode_enviar_agora === true, ultimaCompra: ultima.get(d.cliente_id) || null })),
      atribuidos: atrib.map(a => ({ pedidoId: a.pedido_id, numero: numPed.get(a.pedido_id) || '—', cliente: nomeCli.get(a.cliente_id) || '—', clienteId: a.cliente_id,
                                    data: a.data_pedido, total: num(a.total), cupom: a.cupom_codigo, enviadoEm: a.enviado_em }))
    };
  }

  /** Contato SÓ dos destinatários pendentes que podem receber agora, e só do canal da campanha (minimização). */
  async function campanhaContatos(campanhaId, canal) {
    exigirCliente();
    if (!UUID_RE.test(String(campanhaId || '')) || !CANAIS_CAMPANHA.includes(canal)) return {};
    const col = canal === 'email' ? 'email' : 'telefone';
    const r = await lerTudo(o => sb.from('v_campanha_destinatarios').select(`id, ${col}`, o).eq('campanha_id', campanhaId)
      .eq('situacao', 'pendente').eq('pode_enviar_agora', true).order('id'), 'os contatos');
    return Object.fromEntries(r.map(x => [x.id, x[col] || null]));
  }

  function linhaCampanha(d) {
    const l = {};
    const set = (k, v) => { if (v !== undefined) l[k] = typeof v === 'string' ? (v.trim() || null) : v; };
    set('nome', d.nome); set('objetivo', d.objetivo); set('canal', d.canal); set('publico', d.publico); set('cupom_id', d.cupomId);
    set('mensagem', d.mensagem); set('data_inicio', d.dataInicio); set('data_fim', d.dataFim); set('janela_atribuicao_dias', d.janela);
    set('meta_pedidos', d.metaPedidos); set('meta_receita', d.metaReceita); set('observacoes', d.observacoes); set('resultado_notas', d.resultadoNotas);
    if (l.canal !== undefined && !CANAIS_CAMPANHA.includes(l.canal)) throw new ErroDados('validacao', 'Canal inválido.');
    if (l.publico !== undefined && !PUBLICOS_CAMPANHA.includes(l.publico)) throw new ErroDados('validacao', 'Público inválido.');
    if (l.cupom_id && !UUID_RE.test(l.cupom_id)) throw new ErroDados('validacao', 'Cupom inválido.');
    return l;
  }

  async function campanhaCriar(d) {
    exigirCliente();
    const r = await gravar(() => sb.from('campanhas').insert(linhaCampanha(d)).select('id').single(), 'a campanha');
    return r.id;
  }

  /** Altera a campanha SÓ se ninguém a alterou depois da leitura (atualizado_em). */
  async function campanhaAtualizar(id, atualizadoEm, d, status) {
    exigirCliente();
    if (!UUID_RE.test(String(id || '')) || !atualizadoEm) throw new ErroDados('validacao', 'Campanha inválida.');
    const l = d ? linhaCampanha(d) : {};
    if (status) { if (status !== 'concluida') throw new ErroDados('validacao', 'Mudança de status inválida.'); l.status = status; }
    if (!Object.keys(l).length) return null;
    const r = await gravar(() => sb.from('campanhas').update(l).eq('id', id).eq('atualizado_em', atualizadoEm).select('id, atualizado_em'), 'a campanha');
    if (r && r.length) return r[0];
    const atual = await lerUm(() => sb.from('campanhas').select('id, atualizado_em').eq('id', id).maybeSingle(), 'a campanha');
    if (!atual) throw new ErroDados('nao_encontrado', 'Esta campanha não existe mais.');
    if (atual.atualizado_em !== atualizadoEm) throw new ErroDados('conflito', 'Esta campanha foi alterada por outra pessoa enquanto você editava. Os dados foram recarregados: confira e salve de novo.');
    throw new ErroDados('permissao', 'O banco não permitiu a alteração.');
  }

  async function campanhaExcluir(id) {
    const r = await gravar(() => sb.from('campanhas').delete().eq('id', id).eq('status', 'rascunho').select('id'), 'a campanha');
    if (!r || !r.length) throw new ErroDados('permissao', 'Só o administrador exclui, e só rascunho sem nenhum envio marcado.');
    return r;
  }

  function campanhaAprovar(id, observacao) { return rpc('campanha_aprovar', { p_campanha: id, p_observacao: observacao }, 'a aprovação'); }
  function campanhaIncluir(id, clientes) { return rpc('campanha_incluir_destinatarios', { p_campanha: id, p_clientes: clientes }, 'os destinatários'); }
  function campanhaRevalidar(id) { return rpc('campanha_revalidar', { p_campanha: id }, 'a revalidação'); }
  function campanhaMarcarEnvio(destinatarioId) { return rpc('campanha_marcar_envio', { p_destinatario: destinatarioId }, 'o envio'); }
  async function campanhaRemoverDestinatario(destinatarioId) {
    const r = await gravar(() => sb.from('campanha_destinatarios').delete().eq('id', destinatarioId).neq('situacao', 'enviado').select('id'), 'o destinatário');
    if (!r || !r.length) throw new ErroDados('conflito', 'O destinatário não pode ser removido (já marcado como enviado ou não existe mais).');
    return r;
  }

  /** Candidatos do público GRAVADO na campanha (público + produtos em foco), com permissão atual no canal.
   *  Regra única no banco (018: campanha_candidatos = a mesma da inclusão). Sem e-mail/telefone. */
  async function campanhaCandidatos(campanhaId, q) {
    exigirCliente();
    if (!UUID_RE.test(String(campanhaId || ''))) throw new ErroDados('validacao', 'Campanha inválida.');
    const r = await rpc('campanha_candidatos', { p_campanha: campanhaId, p_busca: termoBusca(q) || null }, 'os candidatos');
    return (r || []).map(x => ({ id: x.cliente_id, nome: x.nome, detalhe: x.detalhe || '' }));
  }

  /** Produtos reais ativos que podem entrar como "produto em foco" (variantes da loja agrupadas pela tela). */
  async function produtosParaCampanha() {
    exigirCliente();
    const r = await lerTudo(o => sb.from('produtos').select('id, nome, sku, ciclo_recompra_dias, nuvemshop_produto_id, fonte', o)
      .neq('fonte', 'ficticio').eq('ativo', true).order('nome').order('id'), 'os produtos');
    return r.map(p => ({ id: p.id, nome: p.nome, sku: p.sku, ciclo: p.ciclo_recompra_dias, produtoLoja: p.nuvemshop_produto_id === null ? null : String(p.nuvemshop_produto_id) }));
  }

  /** Troca atômica dos produtos em foco (o banco confere origem, produto ativo, rascunho, destinatários e anula a aprovação). */
  function campanhaDefinirProdutos(campanhaId, produtoIds) {
    if (!UUID_RE.test(String(campanhaId || '')) || !Array.isArray(produtoIds) || produtoIds.some(x => !UUID_RE.test(String(x))))
      return Promise.reject(new ErroDados('validacao', 'Produtos inválidos.'));
    return rpc('campanha_definir_produtos', { p_campanha: campanhaId, p_produtos: produtoIds }, 'os produtos da campanha');
  }

  /** Cupons de UMA origem + códigos usados em pedidos pagos da loja que ainda não foram cadastrados. */
  async function cupons(origemPedida) {
    exigirCliente();
    const origem = origemPedida === 'ficticio' ? 'ficticio' : 'real';
    const [lista, usados] = await Promise.all([
      lerTudo(o => filtrarOrigem(sb.from('cupons').select('id, codigo, tipo, valor, ativo, fonte, criado_em', o), origem).order('codigo').order('id'), 'os cupons'),
      origem === 'real'
        ? lerTudo(o => sb.from('pedidos').select('cupom_codigo', o).eq('fonte', 'nuvemshop').eq('status', 'pago').not('cupom_codigo', 'is', null).order('id'), 'os cupons usados na loja')
        : Promise.resolve([])
    ]);
    const cadastrados = new Set(lista.map(c => c.codigo.trim().toUpperCase()));
    const contagem = new Map();
    usados.forEach(p => { const k = String(p.cupom_codigo || '').trim().toUpperCase(); if (k && !cadastrados.has(k)) contagem.set(k, (contagem.get(k) || 0) + 1); });
    return {
      itens: lista.map(c => ({ id: c.id, codigo: c.codigo, tipo: c.tipo, valor: c.valor === null ? null : num(c.valor), ativo: c.ativo, fonte: c.fonte })),
      usadosNaoCadastrados: [...contagem.entries()].map(([codigo, n]) => ({ codigo, pedidos: n })).sort((a, b) => b.pedidos - a.pedidos || a.codigo.localeCompare(b.codigo))
    };
  }
  function cupomRegistrar(d) { return rpc('cupom_registrar', { p_codigo: d.codigo, p_tipo: d.tipo || null, p_valor: d.valor === '' || d.valor === undefined || d.valor === null ? null : Number(d.valor) }, 'o cupom'); }
  function cupomAlterarStatus(id, ativo) { return rpc('cupom_alterar_status', { p_id: id, p_ativo: !!ativo }, 'o cupom'); }

  // Regras reais de segmentação: tabela protegida por RLS (admin + MFA).
  // Nunca escreve no protótipo local nem altera Nuvemshop/cron.
  const CAMPOS_REGRAS = {
    inativoAposDias: ['inativo_apos_dias', 15, 720],
    fidelidadeMinPedidos: ['fidelidade_min_pedidos', 2, 20],
    janelaAntesDias: ['janela_antes_dias', 0, 60],
    janelaDepoisDias: ['janela_depois_dias', 0, 120]
  };
  function mapearRegras(c) {
    return {
      id: c.id, atualizadoEm: c.atualizado_em,
      inativoAposDias: c.inativo_apos_dias, fidelidadeMinPedidos: c.fidelidade_min_pedidos,
      janelaAntesDias: c.janela_antes_dias, janelaDepoisDias: c.janela_depois_dias
    };
  }
  async function regrasReais() {
    exigirCliente();
    let r;
    try {
      r = await sb.from('configuracoes')
        .select('id, inativo_apos_dias, fidelidade_min_pedidos, janela_antes_dias, janela_depois_dias, atualizado_em');
    } catch (e) { throw traduzirErro(e, 'as regras reais'); }
    if (r.error) throw traduzirErro(r.error, 'as regras reais');
    if (!Array.isArray(r.data) || r.data.length !== 1)
      throw new ErroDados('acesso', 'Não foi possível verificar a configuração única do Supabase. Nenhuma regra será alterada.');
    return mapearRegras(r.data[0]);
  }
  async function salvarRegrasReais(atual, valores) {
    exigirCliente();
    if (!atual || !Number.isInteger(atual.id) || !atual.atualizadoEm)
      throw new ErroDados('validacao', 'Recarregue as regras atuais antes de salvar.');
    const patch = {};
    for (const [campo, [coluna, minimo, maximo]] of Object.entries(CAMPOS_REGRAS)) {
      const n = Number(valores[campo]);
      if (!Number.isInteger(n) || n < minimo || n > maximo || String(valores[campo]).trim() === '')
        throw new ErroDados('validacao', `Valor inválido em ${campo}. Informe um inteiro entre ${minimo} e ${maximo}.`);
      patch[coluna] = n;
    }
    // Evita sobrescrever silenciosamente mudanças feitas em outra sessão.
    let r;
    try {
      r = await sb.from('configuracoes').update(patch)
        .eq('id', atual.id).eq('atualizado_em', atual.atualizadoEm)
        .select('id, inativo_apos_dias, fidelidade_min_pedidos, janela_antes_dias, janela_depois_dias, atualizado_em');
    } catch (e) { throw traduzirErro(e, 'a gravação das regras reais'); }
    if (r.error) throw traduzirErroGravacao(r.error, 'as regras reais');
    if (!Array.isArray(r.data) || r.data.length !== 1)
      throw new ErroDados('conflito', 'As regras foram alteradas em outra sessão ou você não tem permissão. Recarregue antes de tentar novamente.');
    return mapearRegras(r.data[0]);
  }

  // ---------------------------------------------------------------
  // Inteligência comercial (somente leitura; só dados REAIS; nada de nome/contato de cliente)
  //   Reaproveita: pedidos pagos + itens (003/014), produtos (011), v_campanhas_resultados
  //   (atribuição com evidência, 016), v_recompra_painel (013), v_clientes_resumo (012), leads (004).
  // ---------------------------------------------------------------
  async function inteligencia() {
    exigirCliente();
    const hoje = A.analytics.iso(A.analytics.today());
    const real = q => q.neq('fonte', 'ficticio');
    let cfg, clientes, pedidos, produtos, camps, recompra, fups, fieis, inativos;
    try {
      [cfg, clientes, pedidos, produtos, camps, recompra, fups, fieis, inativos] = await Promise.all([
        lerTudo(o => sb.from('configuracoes').select('id, inativo_apos_dias, fidelidade_min_pedidos, janela_antes_dias, janela_depois_dias', o).order('id'), 'as configurações'),
        lerTudo(o => real(sb.from('clientes').select('id, origem, fonte', o)).order('id'), 'os clientes'),
        lerTudo(o => real(sb.from('pedidos').select('id, cliente_id, data_pedido, total, fonte, pedido_itens(produto_id, qtd, preco_unit)', o)).eq('status', 'pago').order('id'), 'os pedidos pagos'),
        lerTudo(o => real(sb.from('produtos').select('id, nome, ciclo_recompra_dias, fonte', o)).order('id'), 'os produtos'),
        lerTudo(o => real(sb.from('v_campanhas_resultados').select('campanha_id, nome, status, cupom, enviados, clientes_convertidos, pedidos_atribuidos, receita_atribuida, fonte', o))
          .neq('status', 'rascunho').order('campanha_id'), 'as campanhas'),
        lerTudo(o => sb.from('v_recompra_painel').select('cliente_id, produto_id, situacao, pode_contatar, cliente_fonte', o).neq('cliente_fonte', 'ficticio')
          .in('situacao', ['janela', 'atrasado']).neq('acompanhamento', 'encerrada').order('cliente_id').order('produto_id'), 'as oportunidades de recompra'),
        lerTudo(o => real(sb.from('leads').select('id, fonte', o)).is('anonimizado_em', null).not('etapa', 'in', '(comprou,perdido)')
          .not('proximo_contato', 'is', null).lte('proximo_contato', hoje).order('id'), 'os follow-ups do funil'),
        lerTudo(o => real(sb.from('v_clientes_resumo').select('id, pode_whatsapp, pode_email, fonte', o)).eq('anonimizado', false).eq('segmento', 'fieis')
          .neq('status_comercial', 'nao_contatar').order('id'), 'os clientes elegíveis à fidelização'),
        lerTudo(o => real(sb.from('v_clientes_resumo').select('id, pode_whatsapp, pode_email, fonte', o)).eq('anonimizado', false).eq('segmento', 'inativos')
          .neq('status_comercial', 'nao_contatar').order('id'), 'os clientes inativos')
      ]);
    } catch (e) { throw e instanceof ErroDados ? e : traduzirErro(e, 'a inteligência comercial'); }
    if (cfg.length !== 1) throw new ErroDados('acesso', MSG_SEM_ACESSO);
    // conferência defensiva: nada fictício passa daqui
    if ([clientes, pedidos, produtos, camps, fups, fieis, inativos].some(l => l.some(x => x.fonte === 'ficticio')) || recompra.some(x => x.cliente_fonte === 'ficticio'))
      throw new ErroDados('consulta', 'O banco devolveu dados de teste junto com os reais. Nada foi exibido.');
    const c = cfg[0];
    const distintos = (lista, f) => new Set(lista.filter(f || (() => true)).map(x => x.cliente_id)).size;
    const comPermissao = l => l.filter(x => x.pode_whatsapp === true || x.pode_email === true).length;
    return {
      lidoEm: new Date(),
      // base no formato de A.analytics (só o necessário: ids, origem, pedidos pagos e itens)
      base: {
        regras: { inativoAposDias: c.inativo_apos_dias, fidelidadeMinPedidos: c.fidelidade_min_pedidos, janelaAntesDias: c.janela_antes_dias, janelaDepoisDias: c.janela_depois_dias },
        clientes: clientes.map(x => ({ id: x.id, origem: x.origem || 'Sem origem informada' })),
        pedidos: pedidos.map(p => ({ id: p.id, clienteId: p.cliente_id, data: diaLocal(p.data_pedido), status: 'pago', total: num(p.total),
          itens: (p.pedido_itens || []).map(i => ({ produtoId: i.produto_id, qtd: num(i.qtd), precoUnit: num(i.preco_unit) })) })),
        produtos: produtos.map(p => ({ id: p.id, nome: p.nome, cicloDias: p.ciclo_recompra_dias })),
        leads: [], campanhas: []
      },
      campanhas: camps.map(r => ({ id: r.campanha_id, nome: r.nome, status: r.status, cupom: r.cupom, enviados: num(r.enviados),
        compradores: num(r.clientes_convertidos), pedidos: num(r.pedidos_atribuidos), receita: num(r.receita_atribuida) })),
      acompanhamento: {
        janela: distintos(recompra, x => x.situacao === 'janela'), janelaComPermissao: distintos(recompra, x => x.situacao === 'janela' && x.pode_contatar === true),
        atrasado: distintos(recompra, x => x.situacao === 'atrasado'),
        followUps: fups.length,
        fieis: fieis.length, fieisComPermissao: comPermissao(fieis),
        inativos: inativos.length, inativosComPermissao: comPermissao(inativos)
      }
    };
  }

  // ---------------------------------------------------------------
  // Nuvemshop — SOMENTE teste de conexão (Edge Function nuvemshop-consulta)
  //   Usa o cliente da sessão (o token do usuário vai sozinho no cabeçalho).
  //   Nada é gravado, importado ou sincronizado. Da resposta só sai um RESUMO:
  //   quantidade de pedidos e contagem por status de pagamento. Nenhum outro
  //   campo (cliente, e-mail, endereço, IDs) é guardado ou exibido; o corpo de
  //   respostas de erro nunca é lido.
  // ---------------------------------------------------------------
  const FUNCAO_NUVEMSHOP = 'nuvemshop-consulta';
  const STATUS_PAGAMENTO_RE = /^[a-z][a-z_ -]{0,29}$/i;

  function resumirRespostaNuvemshop(bruto) {
    let d = bruto;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { d = null; } }
    if (!d || typeof d !== 'object') return { reconhecido: false, pedidos: null, status: [] };
    const obj = Array.isArray(d) ? {} : d;
    const lista = Array.isArray(d) ? d : [obj.pedidos, obj.orders, obj.data, obj.resultados, obj.items].find(Array.isArray) || null;
    let pedidos = null;
    for (const k of ['total_pedidos', 'quantidade_pedidos', 'quantidade', 'total', 'count']) {
      if (Number.isInteger(obj[k]) && obj[k] >= 0) { pedidos = obj[k]; break; }
    }
    if (pedidos === null && lista) pedidos = lista.length;
    const contagem = new Map();
    const somar = (s, n) => { const k = STATUS_PAGAMENTO_RE.test(String(s)) ? String(s).toLowerCase() : 'outro'; contagem.set(k, (contagem.get(k) || 0) + n); };
    const resumo = [obj.status_pagamento, obj.payment_status, obj.statusPagamento, obj.por_status_pagamento]
      .find(x => x && typeof x === 'object' && !Array.isArray(x));
    if (resumo) Object.entries(resumo).forEach(([s, n]) => { if (Number.isInteger(n) && n >= 0) somar(s, n); });
    else if (lista) lista.forEach(o => {
      const s = o && typeof o === 'object' ? (o.payment_status ?? o.status_pagamento ?? o.paymentStatus) : null;
      if (typeof s === 'string' && s) somar(s, 1);
    });
    return { reconhecido: pedidos !== null || contagem.size > 0, pedidos, status: [...contagem.entries()].map(([status, n]) => ({ status, n })).sort((a, b) => b.n - a.n) };
  }

  function erroNuvemshop(error) {
    const nome = (error && error.name) || '';
    const st = error && error.context && typeof error.context.status === 'number' ? error.context.status : null;
    if (nome === 'FunctionsFetchError') {
      const abortado = /abort/i.test(String(error.context && (error.context.name || error.context.message) || ''));
      return new ErroDados('rede', abortado ? 'A função não respondeu em 30 segundos. Tente de novo.' : 'Não foi possível falar com o Supabase. Verifique a conexão e tente de novo.');
    }
    if (nome === 'FunctionsRelayError') return new ErroDados('rede', 'O Supabase não conseguiu executar a função agora. Tente de novo em alguns minutos.');
    const msgs = {
      401: 'Sessão não aceita pela função (401). Saia e entre novamente com o código do autenticador.',
      403: 'Acesso negado (403). A função só atende administradores com verificação em 2 etapas — ou a Nuvemshop recusou a credencial configurada na função.',
      404: 'Função "nuvemshop-consulta" não encontrada (404). Confira se ela está publicada no projeto.',
      500: 'Erro interno na função (500). Consulte os registros (Logs) da função no painel do Supabase.',
      502: 'A Nuvemshop não respondeu corretamente (502). Tente de novo em alguns minutos; se continuar, confira o token e o ID da loja nos segredos da função.'
    };
    if (st && msgs[st]) return new ErroDados(st === 401 ? 'sessao' : st === 403 ? 'permissao' : 'integracao', msgs[st], String(st));
    return new ErroDados('integracao', st ? `A função respondeu com erro (código ${st}).` : 'Erro inesperado ao testar a conexão.', st ? String(st) : '');
  }

  /** Testa a conexão com a Nuvemshop (somente leitura). Só administrador com 2 etapas. */
  async function testarNuvemshop() {
    exigirCliente();
    if (!A.session.isAdmin()) throw new ErroDados('permissao', 'Somente administradores podem testar a integração.');
    let nivel;
    try { nivel = await sb.auth.mfa.getAuthenticatorAssuranceLevel(); } catch (e) { nivel = { error: e }; }
    if (nivel.error || !nivel.data || nivel.data.currentLevel !== 'aal2')
      throw new ErroDados('sessao', 'A verificação em 2 etapas desta sessão não foi confirmada. Saia e entre novamente.');
    const ctrl = new AbortController();
    const prazo = setTimeout(() => ctrl.abort(), 30000);
    let r;
    try { r = await sb.functions.invoke(FUNCAO_NUVEMSHOP, { signal: ctrl.signal }); }
    catch (e) { throw erroNuvemshop({ name: 'FunctionsFetchError', context: e }); }
    finally { clearTimeout(prazo); }
    if (r.error) throw erroNuvemshop(r.error);
    return Object.assign(resumirRespostaNuvemshop(r.data), { em: new Date() });
  }

  // ---------------------------------------------------------------
  // Nuvemshop — importação (Edge Function nuvemshop-sincronizar, migração 014)
  //   Prévia (nada gravado) e execução. Só administrador com 2 etapas (o banco confere de novo).
  //   O token da loja nunca passa pelo navegador. A resposta traz só contadores e avisos sem dado pessoal.
  // ---------------------------------------------------------------
  const FUNCAO_SINCRONIZAR = 'nuvemshop-sincronizar';
  const MSG_SINCRONIZACAO = {
    sessao_invalida: 'Sessão não aceita pela função. Saia e entre novamente com o código do autenticador.',
    sem_permissao: 'Somente administrador ativo com verificação em 2 etapas pode importar dados da loja.',
    em_andamento: 'Já existe uma importação em andamento. Aguarde terminar e atualize o painel.',
    modo_invalido: 'Pedido inválido para a função.',
    configuracao_incompleta: 'A função não está configurada (segredos ausentes no Supabase). Nada foi importado.',
    nuvemshop_credencial: 'A Nuvemshop recusou a credencial configurada na função (token ou permissões). Nada foi importado.',
    nuvemshop_indisponivel: 'A Nuvemshop não respondeu corretamente agora. Nada foi importado; tente de novo em alguns minutos.',
    nuvemshop_sem_resposta: 'A Nuvemshop não respondeu a tempo. Nada foi importado; tente de novo.',
    nuvemshop_limite_de_chamadas: 'A Nuvemshop limitou as chamadas desta conta. Nada foi importado; tente de novo em alguns minutos.',
    nuvemshop_nao_encontrado: 'A Nuvemshop não encontrou a loja ou o recurso pedido. Confira o ID da loja.',
    nuvemshop_resposta_invalida: 'A Nuvemshop devolveu uma resposta inesperada. Nada foi importado.',
    nuvemshop_link_invalido: 'A paginação da Nuvemshop apontou para outro endereço; a leitura foi interrompida por segurança. Nada foi importado.',
    nuvemshop_volume_excessivo: 'Volume acima do limite de uma execução. Nada foi importado; fale com o suporte técnico.',
    tempo_esgotado: 'A leitura da loja passou do tempo limite. Nada foi importado; tente de novo.',
    banco_inicio: 'O banco não conseguiu iniciar a importação. Nada foi importado.',
    banco_aplicar: 'O banco recusou a gravação. Nada foi importado.',
    inesperado: 'Erro inesperado na função. Nada foi importado.'
  };

  async function exigirAdminMfa() {
    exigirCliente();
    if (!A.session.isAdmin()) throw new ErroDados('permissao', 'Somente administradores podem importar dados da loja.');
    let nivel;
    try { nivel = await sb.auth.mfa.getAuthenticatorAssuranceLevel(); } catch (e) { nivel = { error: e }; }
    if (nivel.error || !nivel.data || nivel.data.currentLevel !== 'aal2')
      throw new ErroDados('sessao', 'A verificação em 2 etapas desta sessão não foi confirmada. Saia e entre novamente.');
  }

  /** modo: 'previa' (nada é gravado) ou 'execucao'. */
  async function nuvemshopSincronizar(modo) {
    if (!['previa', 'execucao'].includes(modo)) throw new ErroDados('validacao', 'Modo inválido.');
    await exigirAdminMfa();
    const ctrl = new AbortController();
    const prazo = setTimeout(() => ctrl.abort(), 170000);
    let r;
    try { r = await sb.functions.invoke(FUNCAO_SINCRONIZAR, { body: { modo }, signal: ctrl.signal }); }
    catch (e) { r = { error: { name: 'FunctionsFetchError', context: e } }; }
    finally { clearTimeout(prazo); }
    if (r.error) {
      const err = r.error;
      if (err.name === 'FunctionsFetchError') {
        const abort = /abort/i.test(String((err.context && (err.context.name || err.context.message)) || ''));
        throw new ErroDados('rede', abort
          ? 'A importação passou de 170 segundos sem resposta. Atualize o painel: a execução pode ter terminado no servidor.'
          : 'Não foi possível falar com o Supabase. Verifique a conexão e tente de novo.');
      }
      if (err.name === 'FunctionsRelayError') throw new ErroDados('rede', 'O Supabase não conseguiu executar a função agora. Tente de novo em alguns minutos.');
      let codigo = '', status = err.context && err.context.status;
      try { const corpo = await err.context.json(); codigo = String((corpo && corpo.codigo) || ''); } catch (e) { codigo = ''; }
      if (status === 404 && !codigo) throw new ErroDados('integracao', 'Função "nuvemshop-sincronizar" não encontrada. Confira se ela foi publicada.');
      const msg = MSG_SINCRONIZACAO[codigo] || (/^nuvemshop_erro_\d+$/.test(codigo) ? `A Nuvemshop respondeu com erro (${codigo.slice(15)}). Nada foi importado.` : `A função respondeu com erro${status ? ` (${status})` : ''}. Nada foi importado.`);
      throw new ErroDados(codigo === 'sem_permissao' ? 'permissao' : codigo === 'sessao_invalida' ? 'sessao' : codigo === 'em_andamento' ? 'conflito' : 'integracao', msg, codigo);
    }
    const d = r.data;
    if (!d || typeof d !== 'object' || !d.contadores) throw new ErroDados('integracao', 'Resposta inesperada da função. Atualize o painel para conferir.');
    if (modo === 'execucao') window.dispatchEvent(new CustomEvent('altum:dados-alterados', { detail: { origem: 'nuvemshop' } }));
    return d;
  }

  // ---------------------------------------------------------------
  // Nuvem Marketing — VERIFICAÇÃO da integração (Edge Function nuvem-marketing)
  //   Só confere se a chave está nos Secrets do Supabase. Não envia e-mail, não lê nem envia clientes.
  //   A sessão já autenticada (senha + código, aal2) vai no cabeçalho Authorization pelo próprio
  //   supabase-js; nenhum token ou chave é lido, montado ou guardado aqui. A função confere de novo
  //   (token ECC válido, aal2 e administrador ativo no banco).
  // ---------------------------------------------------------------
  const FUNCAO_MARKETING = 'nuvem-marketing';
  const MSG_MARKETING = {
    mfa_obrigatorio: 'A verificação em 2 etapas desta sessão não foi confirmada. Saia e entre novamente.',
    sem_permissao: 'Somente administrador ativo com verificação em 2 etapas pode verificar o Nuvem Marketing.',
    sessao_invalida: 'Sessão não aceita pela função. Saia e entre novamente com o código do autenticador.',
    configuracao_incompleta: 'A chave do Nuvem Marketing não está configurada nos segredos da função (Supabase → Edge Functions → Secrets).',
    banco_perfil: 'A função não conseguiu conferir o seu perfil no banco. Tente de novo.',
    metodo_invalido: 'Pedido inválido para a função.',
    MISSING_CREDENTIALS: 'A função não recebeu a sessão. Saia e entre novamente.',
    UNUSABLE_CREDENTIAL: 'A função não recebeu a sessão do usuário (só a chave pública). Saia e entre novamente.',
    INVALID_JWT: 'A função recusou o token da sessão (vencido ou não assinado pelas chaves atuais do projeto). Saia e entre novamente.',
    JWKS_NOT_CONFIGURED: 'A função não tem as chaves públicas do projeto para conferir a sessão (JWKS). Fale com o suporte técnico.',
    JWKS_FETCH_FAILED: 'A função não conseguiu ler as chaves públicas do projeto agora. Tente de novo.',
    acao_invalida: 'Esta versão da função "nuvem-marketing" não tem o teste de conexão. Publique a versão 0.13.2 da função.',
    pedido_invalido: 'Pedido inválido para a função.',
    conta_nao_configurada: 'Falta o nome da conta: crie o Secret NUVEM_MARKETING_CONTA no Supabase (Edge Functions → Secrets).',
    api_chave_recusada: 'O Nuvem Marketing recusou a chave (401). Confira a chave API nos Secrets do Supabase.',
    api_sem_permissao: 'A chave é válida, mas o usuário dela no Nuvem Marketing não tem permissão para ler listas (403).',
    api_conta_nao_encontrada: 'O Nuvem Marketing não encontrou a conta (404). Confira o Secret NUVEM_MARKETING_CONTA.',
    api_limite_ou_indisponivel: 'O Nuvem Marketing está limitando o acesso ou indisponível agora. Tente de novo em alguns minutos.',
    api_sem_resposta: 'O Nuvem Marketing não respondeu em 10 segundos. Tente de novo.',
    api_indisponivel: 'Não foi possível falar com o Nuvem Marketing agora. Tente de novo.',
    api_redirecionamento: 'O Nuvem Marketing respondeu com um redirecionamento; por segurança a chave não foi reenviada. Fale com o suporte técnico.',
    api_resposta_invalida: 'O Nuvem Marketing devolveu uma resposta inesperada.',
    api_erro: 'O Nuvem Marketing respondeu com erro. Tente de novo.'
  };

  // Chamada comum às duas ações (a sessão vai sozinha no Authorization; nada é montado aqui).
  async function chamarNuvemMarketing(corpo, prazoMs) {
    exigirCliente();
    if (!A.session.isAdmin()) throw new ErroDados('permissao', 'Somente administradores podem usar a integração Nuvem Marketing.');
    let nivel;
    try { nivel = await sb.auth.mfa.getAuthenticatorAssuranceLevel(); } catch (e) { nivel = { error: e }; }
    if (nivel.error || !nivel.data || nivel.data.currentLevel !== 'aal2')
      throw new ErroDados('sessao', 'A verificação em 2 etapas desta sessão não foi confirmada. Saia e entre novamente.');
    const ctrl = new AbortController();
    const prazo = setTimeout(() => ctrl.abort(), prazoMs);
    let r;
    try { r = await sb.functions.invoke(FUNCAO_MARKETING, { body: corpo, signal: ctrl.signal }); }
    catch (e) { r = { error: { name: 'FunctionsFetchError', context: e } }; }
    finally { clearTimeout(prazo); }
    if (r.error) {
      const err = r.error;
      if (err.name === 'FunctionsFetchError') {
        const abort = /abort/i.test(String((err.context && (err.context.name || err.context.message)) || ''));
        throw new ErroDados('rede', abort ? `A função não respondeu em ${Math.round(prazoMs / 1000)} segundos. Tente de novo.` : 'Não foi possível falar com o Supabase. Verifique a conexão e tente de novo.');
      }
      if (err.name === 'FunctionsRelayError') throw new ErroDados('rede', 'O Supabase não conseguiu executar a função agora. Tente de novo em alguns minutos.');
      const status = err.context && typeof err.context.status === 'number' ? err.context.status : null;
      let codigo = '';
      try { const c = await err.context.json(); codigo = String((c && (c.codigo || c.code)) || ''); } catch (e) { codigo = ''; }
      if (!codigo && err.context && err.context.headers && typeof err.context.headers.get === 'function') codigo = String(err.context.headers.get('x-supabase-server-error') || '');
      if (status === 404 && !MSG_MARKETING[codigo]) throw new ErroDados('integracao', 'Função "nuvem-marketing" não encontrada. Confira se ela está publicada no projeto.', '404');
      const tipo = status === 401 ? 'sessao' : status === 403 ? 'permissao' : 'integracao';
      throw new ErroDados(tipo, MSG_MARKETING[codigo] || `A função respondeu com erro${status ? ` (${status})` : ''}.`, codigo || (status ? String(status) : ''));
    }
    const d = r.data;
    if (!d || typeof d !== 'object' || d.ok !== true || d.integracao !== 'nuvem-marketing')
      throw new ErroDados('integracao', 'Resposta inesperada da função "nuvem-marketing".');
    return d;
  }

  /** Verifica se a integração Nuvem Marketing está configurada. Só administrador com 2 etapas. Nada é enviado. */
  async function nuvemMarketingVerificar() {
    const d = await chamarNuvemMarketing({}, 30000);
    return { configurada: d.chaveConfigurada === true, envioHabilitado: d.emailSendingEnabled === true, em: new Date() };
  }

  /** Testa a autenticação REAL na API (uma leitura das listas, feita pelo servidor). Não sincroniza contatos nem envia e-mail. */
  async function nuvemMarketingTestarConexao() {
    const d = await chamarNuvemMarketing({ acao: 'testar_conexao' }, 30000);
    if (d.acao !== 'testar_conexao' || d.autenticada !== true) throw new ErroDados('integracao', 'Resposta inesperada da função "nuvem-marketing". Confira se a versão 0.13.2 dela foi publicada.');
    const n = d.listas;
    return { autenticada: true, listas: Number.isSafeInteger(n) && n >= 0 ? n : null, envioHabilitado: d.emailSendingEnabled === true, em: new Date() };
  }

  /** Listas do Nuvem Marketing: SÓ metadados (id, nome, contadores informados pela API). Uma leitura; nada é alterado. */
  async function nuvemMarketingListas() {
    const d = await chamarNuvemMarketing({ acao: 'analisar_listas' }, 30000);
    if (d.acao !== 'analisar_listas' || !Array.isArray(d.listas)) throw new ErroDados('integracao', 'Resposta inesperada da função "nuvem-marketing". Confira se a versão 0.13.3 dela foi publicada.');
    const inteiro = n => (Number.isSafeInteger(n) && n >= 0 ? n : null);
    return {
      listas: d.listas.slice(0, 50).map(l => ({
        id: l && l.id != null ? String(l.id).slice(0, 40) : null,
        nome: l && typeof l.nome === 'string' ? l.nome.slice(0, 120) : null,
        contadores: Object.fromEntries(Object.entries((l && l.contadores) || {}).filter(([k, v]) => /^[A-Za-z][A-Za-z0-9_.]{0,80}$/.test(k) && inteiro(v) !== null).slice(0, 20))
      })),
      total: inteiro(d.total), envioHabilitado: d.emailSendingEnabled === true, em: new Date()
    };
  }

  /** Prévia da recompra por e-mail (só contagens; nada gravado). Só administrador com 2 etapas (o banco confere). */
  async function recompraEmailPrevia(produtoIds) {
    exigirCliente();
    if (!A.session.isAdmin()) throw new ErroDados('permissao', 'Somente administradores podem calcular a prévia.');
    if (!Array.isArray(produtoIds) || !produtoIds.length || produtoIds.some(x => !UUID_RE.test(String(x))))
      throw new ErroDados('validacao', 'Escolha um produto.');
    const r = await rpc('recompra_email_previa', { p_produtos: produtoIds }, 'a prévia da recompra');
    if (!r || typeof r !== 'object' || !r.janela || !r.situacao) throw new ErroDados('integracao', 'Resposta inesperada do banco. Confira se a migração 019 foi aplicada.');
    return Object.assign({}, r, { em: new Date() });
  }

  /** Painel: estado da loja e últimas execuções (o banco só mostra a administradores com 2 etapas). */
  async function nuvemshopPainel() {
    exigirCliente();
    const [est, ex] = await Promise.all([
      lerUm(() => sb.from('nuvemshop_estado').select('loja_id, ultima_sincronizacao_em, ultima_execucao_id, agendamento_ativo, cursor_produtos, cursor_clientes, cursor_pedidos').limit(1), 'o estado da integração'),
      lerUm(() => sb.from('nuvemshop_sincronizacoes').select('id, modo, status, incremental, iniciada_em, concluida_em, lidos, contadores, avisos, erro_codigo')
        .order('iniciada_em', { ascending: false }).order('id').limit(10), 'o histórico de importações')
    ]);
    return { estado: (est && est[0]) || null, execucoes: ex || [], lidoEm: new Date() };
  }

  let configuradorEntregue = false;
  A.repositorio = Object.freeze({
    ErroDados,
    dashboard,
    produtos,
    salvarProduto,
    alterarStatusProduto,
    enviarImagemProduto,
    removerImagemProduto,
    validarImagem,
    urlImagemProduto,
    IMAGEM_MAX_BYTES,
    clientesLista: clientesListaComTotal,
    cliente,
    clienteSalvar,
    clientesPossiveisDuplicados,
    registrarPermissao,
    registrarOposicao,
    encerrarOposicao,
    registrarInteracao,
    registrarSolicitacao,
    iniciarAtendimento,
    cadastrarTextoConsentimento,
    anonimizarSimular,
    anonimizarExecutar,
    reconfirmarCodigo,
    recompraLista,
    recompraProdutos,
    recompraDetalhe,
    recompraContato,
    recompraRegistrar,
    funilLista,
    funilLead,
    funilPossiveisDuplicados,
    funilCriar,
    funilAtualizar,
    funilRegistrarBase,
    funilRegistrarInteracao,
    funilRejeitarSugestao,
    funilBuscarClientes,
    campanhasLista,
    campanhaDetalhe,
    campanhaContatos,
    campanhaCriar,
    campanhaAtualizar,
    campanhaExcluir,
    campanhaAprovar,
    campanhaIncluir,
    campanhaRevalidar,
    campanhaMarcarEnvio,
    campanhaRemoverDestinatario,
    campanhaCandidatos,
    produtosParaCampanha,
    campanhaDefinirProdutos,
    cupons,
    cupomRegistrar,
    cupomAlterarStatus,
    inteligencia,
    regrasReais,
    salvarRegrasReais,
    testarNuvemshop,
    nuvemshopSincronizar,
    nuvemMarketingVerificar,
    nuvemMarketingTestarConexao,
    nuvemMarketingListas,
    recompraEmailPrevia,
    nuvemshopPainel,
    urlImagemLoja,
    // entregue uma única vez (para app.js, no carregamento); o cliente só chega após aal2
    entregarConfigurador() {
      if (configuradorEntregue) return null;
      configuradorEntregue = true;
      return function configurar(cliente) { if (sb || !cliente) return false; sb = cliente; return true; };
    }
  });
})(window.ALTUM);
