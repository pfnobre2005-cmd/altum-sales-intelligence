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
        .select('id, nome, sku, categoria, preco, ciclo_recompra_dias, ativo, fonte, imagem_path, nuvemshop_produto_id, nuvemshop_variante_id, sincronizado_em, versao, criado_em, atualizado_em', o)
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
        imagemPath: p.imagem_path, imagemUrl: urlImagemProduto(p.imagem_path),
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
    // entregue uma única vez (para app.js, no carregamento); o cliente só chega após aal2
    entregarConfigurador() {
      if (configuradorEntregue) return null;
      configuradorEntregue = true;
      return function configurar(cliente) { if (sb || !cliente) return false; sb = cliente; return true; };
    }
  });
})(window.ALTUM);
