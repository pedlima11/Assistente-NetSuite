/**
 * Parser de XML NFS-e (Nota Fiscal de Servico Eletronica).
 *
 * Suporta dois padroes:
 * - ABRASF 2.x (maioria das prefeituras)
 * - NFS-e Nacional (ADN, 2023+)
 *
 * Roda no browser — usa DOMParser nativo (sem dependencias externas).
 *
 * Decisoes oficiais (spec):
 * - 1 item por NFS-e
 * - ISS sempre role: 'main', mesmo retido
 * - Federais retidos: role: 'withholding' se valor > 0
 * - CFOP inferido: 5933 (intra) / 6933 (inter)
 * - Aliquota ISS defensiva: <= 1 → decimal (×100), > 1 → ja percentual
 * - _rawSnippet truncado (max 2KB)
 * - nfeKey via deterministicHash
 */

import { deterministicHash } from '../../shared/canonical.js';

// ── Helpers ─────────────────────────────────────────────────────────────────

const MAX_RAW_SNIPPET = 2048;

/**
 * Busca elemento por localName, ignorando namespace prefixes.
 * Retorna o primeiro match ou null.
 */
function findByLocalName(parent, localName) {
  if (!parent) return null;
  // Tentar getElementsByTagName direto (funciona sem namespace)
  const direct = parent.getElementsByTagName(localName);
  if (direct.length > 0) return direct[0];
  // Fallback: iterar children comparando localName (com namespace)
  const all = parent.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === localName) return all[i];
  }
  return null;
}

/**
 * Busca todos os elementos por localName, ignorando namespace prefixes.
 */
function findAllByLocalName(parent, localName) {
  if (!parent) return [];
  const results = [];
  const all = parent.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    if (all[i].localName === localName) results.push(all[i]);
  }
  return results;
}

/**
 * Extrai texto de um elemento, com path simples separado por '/'.
 * Usa localName para ignorar namespaces.
 */
function getText(parent, path) {
  if (!parent) return '';
  const parts = path.split('/');
  let el = parent;
  for (const part of parts) {
    el = findByLocalName(el, part);
    if (!el) return '';
  }
  return (el.textContent || '').trim();
}

/**
 * Tenta extrair texto de multiplos caminhos alternativos.
 */
function getTextMulti(parent, paths) {
  for (const path of paths) {
    const val = getText(parent, path);
    if (val) return val;
  }
  return '';
}

/**
 * Formata cidade no padrao "Cidade - UF".
 */
function formatCity(cityName, uf) {
  if (!cityName) return '';
  return uf ? `${cityName} - ${uf}` : cityName;
}

/**
 * Normaliza aliquota ISS.
 * ABRASF normalmente usa decimal (0.05 = 5%), mas algumas prefeituras enviam percentual (5.00).
 * Regra: <= 1 → decimal (×100). > 1 → ja percentual.
 */
function normalizeIssAliq(raw) {
  const val = parseFloat(raw) || 0;
  if (val <= 0) return 0;
  return val <= 1 ? val * 100 : val;
}

// ── Detector ────────────────────────────────────────────────────────────────

const NFSE_TAGS = [
  // ABRASF 2.x
  'CompNfse', 'ListaNfse', 'ConsultarNfseRpsResposta', 'GerarNfseResposta',
  'ConsultarNfseResposta', 'EnviarLoteRpsResposta',
  // Nacional
  'NFS-e', 'NFSe',
  // Ambos
  'InfNfse', 'infNfse',
  // SP (prefeitura.sp.gov.br) — usa <NFe> como tag (!) e tags proprias
  'RetornoConsulta', 'RetornoEnvioLoteRPS', 'ChaveNFe', 'TributacaoNFe',
];

/**
 * Detecta se um documento XML e uma NFS-e.
 * Usa localName para ignorar prefixos de namespace.
 * @param {Document} xmlDoc
 * @returns {boolean}
 */
export function isNFSe(xmlDoc) {
  const all = xmlDoc.getElementsByTagName('*');
  for (let i = 0; i < all.length; i++) {
    const name = all[i].localName;
    if (NFSE_TAGS.includes(name)) return true;
  }
  return false;
}

// ── Extrator principal ──────────────────────────────────────────────────────

/**
 * Extrai dados do prestador (emitente) de um bloco NFS-e.
 */
function extractPrestador(nfseBlock) {
  const prest = findByLocalName(nfseBlock, 'PrestadorServico')
    || findByLocalName(nfseBlock, 'Prestador');

  if (!prest) return { cnpj: '', uf: '', codMun: '', name: '', city: '' };

  const cnpj = getTextMulti(prest, [
    'IdentificacaoPrestador/CpfCnpj/Cnpj',
    'IdentificacaoPrestador/Cnpj',
    'CpfCnpj/Cnpj',
    'Cnpj',
  ]);

  const uf = getTextMulti(prest, ['Endereco/Uf', 'Uf']);
  const codMun = getTextMulti(prest, [
    'Endereco/CodigoMunicipio', 'Endereco/cMun', 'CodigoMunicipio',
  ]);
  const name = getTextMulti(prest, ['RazaoSocial', 'NomeFantasia', 'xNome']);
  const cityName = getTextMulti(prest, ['Endereco/xMun', 'Endereco/Municipio']);

  return { cnpj, uf, codMun, name, city: formatCity(cityName, uf) };
}

/**
 * Extrai dados do tomador (destinatario) de um bloco NFS-e.
 */
function extractTomador(nfseBlock) {
  const tom = findByLocalName(nfseBlock, 'TomadorServico')
    || findByLocalName(nfseBlock, 'Tomador');

  if (!tom) return { cnpj: '', uf: '', codMun: '', city: '' };

  const cnpj = getTextMulti(tom, [
    'IdentificacaoTomador/CpfCnpj/Cnpj',
    'IdentificacaoTomador/CpfCnpj/Cpf',
    'IdentificacaoTomador/Cnpj',
    'IdentificacaoTomador/Cpf',
    'CpfCnpj/Cnpj',
    'CpfCnpj/Cpf',
  ]);

  const uf = getTextMulti(tom, ['Endereco/Uf', 'Uf']);
  const codMun = getTextMulti(tom, [
    'Endereco/CodigoMunicipio', 'Endereco/cMun', 'CodigoMunicipio',
  ]);
  const cityName = getTextMulti(tom, ['Endereco/xMun', 'Endereco/Municipio']);

  return { cnpj, uf, codMun, city: formatCity(cityName, uf) };
}

/**
 * Extrai impostos de um bloco de servico NFS-e.
 * Retorna array de taxes com retention e role.
 */
function extractNFSeTaxes(servicoEl, valoresEl, issRetido, cListServ, cMunFG) {
  const taxes = [];

  // ── ISS (imposto principal) ──
  const issValor = parseFloat(getTextMulti(valoresEl, ['ValorIss', 'vISS'])) || 0;
  const issAliqRaw = getTextMulti(valoresEl, ['Aliquota', 'vAliq', 'AliquotaIss']);
  const issAliq = normalizeIssAliq(issAliqRaw);
  const issBc = parseFloat(getTextMulti(valoresEl, ['BaseCalculo', 'vBC', 'BaseDeCalculo'])) || 0;

  if (issValor > 0 || issAliq > 0) {
    taxes.push({
      type: 'ISS',
      cst: '',
      aliq: issAliq,
      bc: issBc,
      valor: issValor,
      retention: issRetido,
      role: 'main',
      cListServ: cListServ || '',
      cMunFG: cMunFG || '',
    });
  }

  // ── Federais retidos ──
  // bc para federais: usar ValorServicos (base do servico)
  const valorServicos = parseFloat(getTextMulti(valoresEl, [
    'ValorServicos', 'vServ', 'ValorServicosPrestados',
  ])) || 0;

  const federais = [
    { field: 'ValorPis', type: 'PIS' },
    { field: 'ValorCofins', type: 'COFINS' },
    { field: 'ValorIr', type: 'IRRF' },
    { field: 'ValorCsll', type: 'CSLL' },
    { field: 'ValorInss', type: 'INSS' },
  ];

  for (const { field, type } of federais) {
    const valor = parseFloat(getText(valoresEl, field)) || 0;
    if (valor <= 0) continue;

    const bc = valorServicos;
    const aliq = bc > 0 ? parseFloat((valor / bc * 100).toFixed(4)) : 0;

    taxes.push({
      type,
      cst: '',
      aliq,
      bc,
      valor,
      retention: true,
      role: 'withholding',
    });
  }

  return taxes;
}

/**
 * Extrai itens de NFS-e no formato SP (prefeitura.sp.gov.br).
 * SP usa <NFe> como tag de servico (!) com estrutura flat — campos diretos no elemento.
 * @param {Document} xmlDoc
 * @returns {Object[]}
 */
function extractSPNFSeItems(xmlDoc) {
  // SP: RetornoConsulta > NFe, ou RetornoEnvioLoteRPS > NFe
  let nfeEls = [];
  const containers = ['RetornoConsulta', 'RetornoEnvioLoteRPS'];
  for (const tag of containers) {
    const container = findByLocalName(xmlDoc, tag);
    if (container) {
      nfeEls = findAllByLocalName(container, 'NFe');
      if (nfeEls.length > 0) break;
    }
  }
  // Fallback: NFe direto no root se tem ChaveNFe (confirma SP)
  if (nfeEls.length === 0) {
    const allNfe = findAllByLocalName(xmlDoc, 'NFe');
    nfeEls = allNfe.filter(el => findByLocalName(el, 'ChaveNFe'));
  }
  if (nfeEls.length === 0) return [];

  const items = [];

  for (const nfe of nfeEls) {
    // ── Header ──
    const numero = getText(nfe, 'ChaveNFe/NumeroNFe');
    const codVerif = getText(nfe, 'ChaveNFe/CodigoVerificacao');
    const dhEmi = getTextMulti(nfe, ['DataEmissaoNFe', 'DataEmissao']);
    const serie = getText(nfe, 'ChaveNFe/SerieNFe') || 'U';

    // ── Prestador ──
    const emitCNPJ = getTextMulti(nfe, [
      'CPFCNPJPrestador/CNPJ', 'CPFCNPJPrestador/CPF',
    ]);
    const emitName = getTextMulti(nfe, [
      'RazaoSocialPrestador', 'NomeFantasiaPrestador',
    ]);
    const emitUF = getText(nfe, 'EnderecoPrestador/UF');
    const emitCodMun = getTextMulti(nfe, [
      'EnderecoPrestador/Cidade', 'EnderecoPrestador/CodigoMunicipio',
    ]);
    const emitCityName = getText(nfe, 'EnderecoPrestador/xMun') || '';

    // ── Tomador ──
    const destCNPJ = getTextMulti(nfe, [
      'CPFCNPJTomador/CNPJ', 'CPFCNPJTomador/CPF',
    ]);
    const destUF = getText(nfe, 'EnderecoTomador/UF');
    const destCodMun = getTextMulti(nfe, [
      'EnderecoTomador/Cidade', 'EnderecoTomador/CodigoMunicipio',
    ]);
    const destCityName = getText(nfe, 'EnderecoTomador/xMun') || '';

    // ── Servico ──
    const valorServicos = parseFloat(getText(nfe, 'ValorServicos')) || 0;
    const cListServ = getTextMulti(nfe, ['CodigoServico', 'ItemListaServico']);
    const itemDesc = getTextMulti(nfe, ['Discriminacao', 'DescricaoServico']);
    const cnae = getText(nfe, 'CodigoCnae') || '';
    // SP usa "Cidade" do prestador como municipio de incidencia
    const cMunFG = emitCodMun;

    // ISS retido: SP usa string "true"/"false"
    const issRetidoRaw = getText(nfe, 'ISSRetido') || getText(nfe, 'IssRetido');
    const issRetido = issRetidoRaw === '1' || issRetidoRaw.toLowerCase() === 'true';

    // ── CFOP inferido ──
    const cfop = (emitUF && destUF && emitUF !== destUF) ? '6933' : '5933';

    // ── nfeKey ──
    const nfeKey = codVerif
      || deterministicHash(`${emitCNPJ}|${numero}|${serie}|${dhEmi}`);

    // ── Impostos ──
    // SP: campos flat diretamente no <NFe>
    const taxes = [];

    // ISS
    const issValor = parseFloat(getText(nfe, 'ValorISS')) || 0;
    const issAliqRaw = getTextMulti(nfe, ['AliquotaServicos', 'Aliquota']);
    const issAliq = normalizeIssAliq(issAliqRaw);
    const issBc = valorServicos; // SP usa ValorServicos como base

    if (issValor > 0 || issAliq > 0) {
      taxes.push({
        type: 'ISS', cst: '', aliq: issAliq, bc: issBc, valor: issValor,
        retention: issRetido, role: 'main',
        cListServ: cListServ || '', cMunFG: cMunFG || '',
      });
    }

    // Federais retidos (SP pode trazer esses campos)
    const federais = [
      { field: 'ValorPIS', alt: 'ValorPis', type: 'PIS' },
      { field: 'ValorCOFINS', alt: 'ValorCofins', type: 'COFINS' },
      { field: 'ValorIR', alt: 'ValorIr', type: 'IRRF' },
      { field: 'ValorCSLL', alt: 'ValorCsll', type: 'CSLL' },
      { field: 'ValorINSS', alt: 'ValorInss', type: 'INSS' },
    ];

    for (const { field, alt, type } of federais) {
      const valor = parseFloat(getText(nfe, field)) || parseFloat(getText(nfe, alt)) || 0;
      if (valor <= 0) continue;
      const bc = valorServicos;
      const aliq = bc > 0 ? parseFloat((valor / bc * 100).toFixed(4)) : 0;
      taxes.push({
        type, cst: '', aliq, bc, valor,
        retention: true, role: 'withholding',
      });
    }

    // ── _rawSnippet truncado ──
    let rawSnippet = '';
    try {
      const serialized = new XMLSerializer().serializeToString(nfe);
      rawSnippet = serialized.length > MAX_RAW_SNIPPET
        ? serialized.substring(0, MAX_RAW_SNIPPET) + '...[truncated]'
        : serialized;
    } catch (_) { /* ignore */ }

    items.push({
      sourceType: 'nfse',
      documentModel: 'NFSE',
      cfop,
      cfopSource: 'inferred',
      cListServ,
      cnae,
      cMunFG,
      issRetido,

      nfeKey,
      nfeNumber: numero,
      series: serie,
      dhEmi,
      emitCNPJ,
      emitUF,
      emitCodMun,
      emitName,
      emitCity: formatCity(emitCityName, emitUF),
      destCNPJ,
      destUF,
      destCodMun,
      destCity: formatCity(destCityName, destUF),
      nItem: '1',
      ncm: '',
      cest: '',
      cClassTrib: '',
      itemDesc,
      itemCode: '',
      vlItem: valorServicos,
      _rawSnippet: rawSnippet,
      taxes,
    });
  }

  return items;
}

/**
 * Extrai todos os itens de servico de um documento XML NFS-e.
 * @param {Document} xmlDoc - Documento XML parseado pelo DOMParser
 * @returns {Object[]} Array de itens com campos compativeis com nfe-parser
 */
export function extractNFSeItems(xmlDoc) {
  const items = [];

  // Encontrar blocos NFS-e — multiplos formatos
  // ABRASF: CompNfse > Nfse > InfNfse
  // Nacional: NFSe > infNfse
  // Avulso: InfNfse diretamente
  let nfseBlocks = findAllByLocalName(xmlDoc, 'CompNfse');

  if (nfseBlocks.length === 0) {
    // Tentar Nfse direto
    nfseBlocks = findAllByLocalName(xmlDoc, 'Nfse');
  }
  if (nfseBlocks.length === 0) {
    // Tentar NFSe (Nacional)
    nfseBlocks = findAllByLocalName(xmlDoc, 'NFSe');
  }
  if (nfseBlocks.length === 0) {
    // Tentar InfNfse direto (documento avulso)
    const infBlocks = findAllByLocalName(xmlDoc, 'InfNfse')
      .concat(findAllByLocalName(xmlDoc, 'infNfse'));
    if (infBlocks.length > 0) {
      nfseBlocks = infBlocks;
    }
  }

  // ── SP format: RetornoConsulta > NFe (flat structure) ──
  if (nfseBlocks.length === 0) {
    const spItems = extractSPNFSeItems(xmlDoc);
    if (spItems.length > 0) return spItems;
  }

  for (const block of nfseBlocks) {
    // Navegar ate InfNfse se nao estamos la
    const infNfse = findByLocalName(block, 'InfNfse')
      || findByLocalName(block, 'infNfse')
      || block;

    // ── Header ──
    const numero = getTextMulti(infNfse, ['Numero', 'numero', 'NumeroNfse']);
    const codVerif = getTextMulti(infNfse, [
      'CodigoVerificacao', 'codigoVerificacao', 'CodVerificacao',
    ]);
    const dhEmi = getTextMulti(infNfse, [
      'DataEmissao', 'dataEmissao', 'DhEmi', 'DataEmissaoNfse',
    ]);
    const serie = getTextMulti(infNfse, ['Serie', 'serie', 'SerieNfse']) || 'U';

    // ── Prestador e Tomador ──
    const prestador = extractPrestador(infNfse);
    const tomador = extractTomador(infNfse);

    // ── Servico ──
    const servicoEl = findByLocalName(infNfse, 'Servico')
      || findByLocalName(infNfse, 'DeclaracaoPrestacaoServico')
      || infNfse;

    const valoresEl = findByLocalName(servicoEl, 'Valores')
      || findByLocalName(infNfse, 'Valores')
      || servicoEl;

    const cListServ = getTextMulti(servicoEl, [
      'ItemListaServico', 'itemListaServico', 'CodigoItemListaServico',
    ]);
    const cnae = getTextMulti(servicoEl, [
      'CodigoCnae', 'codigoCnae', 'Cnae',
    ]);
    const cMunFG = getTextMulti(servicoEl, [
      'CodigoMunicipio', 'MunicipioPrestacaoServico', 'codigoMunicipio',
    ]) || prestador.codMun;
    const itemDesc = getTextMulti(servicoEl, [
      'Discriminacao', 'discriminacao', 'DescricaoServico',
    ]);
    const valorServicos = parseFloat(getTextMulti(valoresEl, [
      'ValorServicos', 'vServ', 'ValorServicosPrestados',
    ])) || 0;

    // ISS retido: 1 = retido, 2 = nao retido
    const issRetidoRaw = getTextMulti(valoresEl, [
      'IssRetido', 'issRetido', 'ISS_RETIDO',
    ]);
    const issRetido = issRetidoRaw === '1' || issRetidoRaw.toLowerCase() === 'true';

    // ── CFOP inferido ──
    const emitUF = prestador.uf;
    const destUF = tomador.uf;
    const cfop = (emitUF && destUF && emitUF !== destUF) ? '6933' : '5933';

    // ── nfeKey determinístico ──
    const nfeKey = codVerif
      || deterministicHash(`${prestador.cnpj}|${numero}|${serie}|${dhEmi}`);

    // ── Impostos ──
    const taxes = extractNFSeTaxes(servicoEl, valoresEl, issRetido, cListServ, cMunFG);

    // ── _rawSnippet truncado ──
    let rawSnippet = '';
    try {
      const serialized = new XMLSerializer().serializeToString(block);
      rawSnippet = serialized.length > MAX_RAW_SNIPPET
        ? serialized.substring(0, MAX_RAW_SNIPPET) + '...[truncated]'
        : serialized;
    } catch (_) { /* ignore serialization errors */ }

    items.push({
      // Identidade de servico
      sourceType: 'nfse',
      documentModel: 'NFSE',
      cfop,
      cfopSource: 'inferred',
      cListServ,
      cnae,
      cMunFG,
      issRetido,

      // Campos compativeis com nfe-parser
      nfeKey,
      nfeNumber: numero,
      series: serie,
      dhEmi,
      emitCNPJ: prestador.cnpj,
      emitUF,
      emitCodMun: prestador.codMun,
      emitName: prestador.name,
      emitCity: prestador.city,
      destCNPJ: tomador.cnpj,
      destUF,
      destCodMun: tomador.codMun,
      destCity: tomador.city,
      nItem: '1',
      ncm: '',
      cest: '',
      cClassTrib: '',
      itemDesc,
      itemCode: '',
      vlItem: valorServicos,
      _rawSnippet: rawSnippet,
      taxes,
    });
  }

  return items;
}

/**
 * Retorna mensagem de erro contextual quando extractNFSeItems retorna 0 items.
 * Detecta comprovantes de lote RPS (sem dados de NFS-e).
 * @param {Document} xmlDoc
 * @returns {string}
 */
export function getNFSeEmptyReason(xmlDoc) {
  const hasChaveNFeRPS = findAllByLocalName(xmlDoc, 'ChaveNFeRPS').length > 0;
  const hasRetornoEnvio = findByLocalName(xmlDoc, 'RetornoEnvioLoteRPS') !== null;
  if (hasChaveNFeRPS || hasRetornoEnvio) {
    return 'Este arquivo e um comprovante de envio de lote RPS (contem apenas chaves de verificacao). Para importar dados fiscais, utilize o XML da NFS-e completa (obtido via Consulta NFS-e).';
  }
  return 'Nenhum servico encontrado na NFS-e';
}

// ── API publica ─────────────────────────────────────────────────────────────

/**
 * Faz parse de um unico arquivo XML de NFS-e.
 * @param {File} file - Objeto File do browser
 * @returns {Promise<{ fileName: string, items: Object[], errors: string[] }>}
 */
export async function parseNFSeFile(file) {
  try {
    const text = await file.text();
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(text, 'application/xml');

    const parseError = xmlDoc.getElementsByTagName('parsererror')[0];
    if (parseError) {
      return {
        fileName: file.name,
        items: [],
        errors: [`XML invalido: ${parseError.textContent.substring(0, 200)}`],
      };
    }

    if (!isNFSe(xmlDoc)) {
      return {
        fileName: file.name,
        items: [],
        errors: ['Arquivo nao parece ser uma NFS-e valida'],
      };
    }

    const items = extractNFSeItems(xmlDoc);

    return {
      fileName: file.name,
      items,
      errors: items.length === 0 ? ['Nenhum servico encontrado na NFS-e'] : [],
    };
  } catch (e) {
    return {
      fileName: file.name,
      items: [],
      errors: [`Erro ao processar ${file.name}: ${e.message}`],
    };
  }
}
