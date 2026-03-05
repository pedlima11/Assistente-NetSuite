/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 *
 * RESTlet para criar Subsidiary e buscar dados de referencia.
 *
 * GET — Retorna listas de: subsidiaries, moedas, calendarios fiscais, cidades BR, estados BR
 * POST — Cria uma nova subsidiary
 */
define(['N/record', 'N/search', 'N/query', 'N/log'], (record, search, query, log) => {

  /**
   * Executa SuiteQL e retorna resultados
   */
  function runSuiteQL(sql) {
    try {
      const results = [];
      const queryResults = query.runSuiteQL({ query: sql });
      const iterator = queryResults.asMappedResults();
      iterator.forEach((row) => {
        results.push(row);
      });
      return results;
    } catch (e) {
      log.error('SuiteQL Error', `SQL: ${sql} | Error: ${e.message}`);
      return [];
    }
  }

  /**
   * Busca usando search.create com fallback
   */
  function searchRecords(type, columns) {
    try {
      const results = [];
      const s = search.create({ type, columns });
      s.run().each((r) => {
        const row = {};
        columns.forEach((col) => {
          row[col] = r.getValue(col);
        });
        row.id = r.id;
        results.push(row);
        return results.length < 5000;
      });
      return results;
    } catch (e) {
      log.error('Search Error', `Type: ${type} | Error: ${e.message}`);
      return [];
    }
  }

  /**
   * GET — Busca dados de referencia para o formulario
   * Params: action=taxDiscovery para retornar dados fiscais
   */
  function get(requestParams) {
    log.audit('GET Lookup Data', JSON.stringify(requestParams));

    // --- Tax Discovery ---
    if (requestParams.action === 'taxDiscovery') {
      return getTaxDiscovery();
    }
    if (requestParams.action === 'taxDiscoveryFTE') {
      return getTaxDiscoveryFTE();
    }
    if (requestParams.action === 'customerLookup') {
      return getCustomerLookup();
    }
    if (requestParams.action === 'itemLookup') {
      return getItemLookup(requestParams.subsidiaryId || '', requestParams.itemType || '');
    }
    if (requestParams.action === 'searchNCM') {
      return searchNCM(requestParams.query || '');
    }
    if (requestParams.action === 'batchSearchNCM') {
      var codes = (requestParams.codes || '').split(',').filter(function(c) { return c.trim(); });
      return batchSearchNCM(codes);
    }

    const result = {
      subsidiaries: [],
      currencies: [],
      fiscalCalendars: [],
      taxFiscalCalendars: [],
      brCities: [],
      brStates: [],
    };

    // --- Subsidiaries ---
    try {
      const subs = runSuiteQL("SELECT s.id, s.name, s.federalidnumber, s.parent FROM subsidiary s WHERE s.isinactive = 'F' ORDER BY s.name");
      if (subs.length > 0) {
        log.debug('Subsidiary SuiteQL sample', JSON.stringify(subs[0]));
        result.subsidiaries = subs.map((r) => ({
          id: String(r.id),
          name: r.name,
          cnpj: r.federalidnumber || '',
          parent: r.parent ? String(r.parent) : null,
        }));
      } else {
        // Fallback com search
        const s = searchRecords(search.Type.SUBSIDIARY, ['internalid', 'name', 'federalidnumber', 'parent']);
        if (s.length > 0) log.debug('Subsidiary search sample', JSON.stringify(s[0]));
        result.subsidiaries = s.map((r) => ({
          id: String(r.id),
          name: r.name,
          cnpj: r.federalidnumber || '',
          parent: r.parent ? String(r.parent) : null,
        }));
      }

      // Fallback: se nenhum sub tem parent e ha mais de 1, buscar via record.load
      if (result.subsidiaries.length > 1) {
        const hasAnyParent = result.subsidiaries.some((s) => s.parent !== null);
        if (!hasAnyParent) {
          log.debug('Parent field missing from query/search, loading via N/record');
          for (let i = 0; i < result.subsidiaries.length; i++) {
            try {
              const rec = record.load({ type: record.Type.SUBSIDIARY, id: result.subsidiaries[i].id });
              const parentId = rec.getValue({ fieldId: 'parent' });
              result.subsidiaries[i].parent = parentId ? String(parentId) : null;
            } catch (loadErr) {
              log.error('Load subsidiary parent error', loadErr.message);
            }
          }
          log.debug('After record.load fallback sample', JSON.stringify(result.subsidiaries[0]));
        }
      }
    } catch (e) {
      log.error('Subsidiary Lookup Error', e.message);
    }

    // --- Moedas ---
    try {
      const currencies = runSuiteQL("SELECT id, name, symbol FROM currency ORDER BY name");
      if (currencies.length > 0) {
        result.currencies = currencies.map((r) => ({ id: String(r.id), name: r.name, symbol: r.symbol }));
      } else {
        const s = searchRecords('currency', ['internalid', 'name', 'symbol']);
        result.currencies = s.map((r) => ({ id: String(r.id), name: r.name, symbol: r.symbol }));
      }
    } catch (e) {
      log.error('Currency Lookup Error', e.message);
    }

    // --- Calendarios Fiscais ---
    try {
      // Tentar SuiteQL
      const cals = runSuiteQL("SELECT id, name FROM fiscalcalendar ORDER BY name");
      if (cals.length > 0) {
        result.fiscalCalendars = cals.map((r) => ({ id: String(r.id), name: r.name }));
        result.taxFiscalCalendars = cals.map((r) => ({ id: String(r.id), name: r.name }));
      }
    } catch (e) {
      log.error('Fiscal Calendar SuiteQL Error', e.message);
    }

    // Fallback: tentar search com tipos alternativos
    if (result.fiscalCalendars.length === 0) {
      const calTypes = ['fiscalcalendar', 'accountingperiod'];
      for (const calType of calTypes) {
        try {
          const s = searchRecords(calType, ['internalid', 'name']);
          if (s.length > 0) {
            result.fiscalCalendars = s.map((r) => ({ id: String(r.id), name: r.name }));
            result.taxFiscalCalendars = s.map((r) => ({ id: String(r.id), name: r.name }));
            log.audit('Fiscal Calendar Found', `Type: ${calType}, Count: ${s.length}`);
            break;
          }
        } catch (e) {
          // tentar proximo
        }
      }
    }

    // --- Cidades e Estados Brasileiros ---
    // Ler opcoes diretamente do campo custrecord_brl_addr_form_city no endereco de uma subsidiary existente
    if (result.subsidiaries.length > 0) {
      try {
        const existingSub = record.load({
          type: record.Type.SUBSIDIARY,
          id: parseInt(result.subsidiaries[0].id),
          isDynamic: true,
        });
        const addr = existingSub.getSubrecord({ fieldId: 'mainaddress' });

        // Cidades — ler opcoes do campo diretamente
        try {
          const cityField = addr.getField({ fieldId: 'custrecord_brl_addr_form_city' });
          const cityOptions = cityField.getSelectOptions({ filter: '', operator: 'contains' });
          result.brCities = cityOptions.map((opt) => ({
            id: String(opt.value),
            name: opt.text,
          }));
          log.audit('BR Cities', `Found ${result.brCities.length} from field options`);
        } catch (e) {
          log.error('BR Cities Error', e.message);
        }

        // Estados — ler opcoes do campo state diretamente
        // Nota: campo 'state' em subrecord de endereco pode ser texto livre
        // (nao suporta getSelectOptions). Tentar campo 'dropdownstate' ou fallback.
        try {
          // Tentar dropdownstate primeiro (campo select nativo em enderecos BR)
          let stateField = null;
          const stateFieldCandidates = ['dropdownstate', 'state'];
          for (const sfId of stateFieldCandidates) {
            try {
              const sf = addr.getField({ fieldId: sfId });
              if (sf && typeof sf.getSelectOptions === 'function') {
                stateField = sf;
                break;
              }
            } catch (e) { /* tentar proximo */ }
          }

          if (stateField) {
            const stateOptions = stateField.getSelectOptions({ filter: '', operator: 'contains' });
            if (stateOptions.length > 0) {
              result.brStates = stateOptions
                .filter((opt) => opt.value)
                .map((opt) => ({
                  id: String(opt.value),
                  name: opt.text,
                }));
              log.audit('BR States', `Found ${result.brStates.length} from field options`);
            }
          } else {
            log.audit('BR States', 'No select field found for states, using fallback');
          }
        } catch (e) {
          log.error('BR States Error', e.message);
        }
      } catch (e) {
        log.error('Address Field Lookup Error', e.message);
      }
    }

    // Fallback estados se nao conseguiu do campo
    if (result.brStates.length === 0) {
      result.brStates = [
        { id: 'AC', name: 'Acre' }, { id: 'AL', name: 'Alagoas' },
        { id: 'AP', name: 'Amapa' }, { id: 'AM', name: 'Amazonas' },
        { id: 'BA', name: 'Bahia' }, { id: 'CE', name: 'Ceara' },
        { id: 'DF', name: 'Distrito Federal' }, { id: 'ES', name: 'Espirito Santo' },
        { id: 'GO', name: 'Goias' }, { id: 'MA', name: 'Maranhao' },
        { id: 'MT', name: 'Mato Grosso' }, { id: 'MS', name: 'Mato Grosso do Sul' },
        { id: 'MG', name: 'Minas Gerais' }, { id: 'PA', name: 'Para' },
        { id: 'PB', name: 'Paraiba' }, { id: 'PR', name: 'Parana' },
        { id: 'PE', name: 'Pernambuco' }, { id: 'PI', name: 'Piaui' },
        { id: 'RJ', name: 'Rio de Janeiro' }, { id: 'RN', name: 'Rio Grande do Norte' },
        { id: 'RS', name: 'Rio Grande do Sul' }, { id: 'RO', name: 'Rondonia' },
        { id: 'RR', name: 'Roraima' }, { id: 'SC', name: 'Santa Catarina' },
        { id: 'SP', name: 'Sao Paulo' }, { id: 'SE', name: 'Sergipe' },
        { id: 'TO', name: 'Tocantins' },
      ];
    }

    log.audit('Lookup Result', `Subs: ${result.subsidiaries.length}, Curr: ${result.currencies.length}, Cals: ${result.fiscalCalendars.length}, Cities: ${result.brCities.length}`);

    return result;
  }

  /**
   * POST — Router
   */
  function post(requestBody) {
    if (requestBody.action === 'createFTERules') {
      return createFTERules(requestBody);
    }
    if (requestBody.action === 'createCustomers') {
      return createCustomers(requestBody);
    }
    if (requestBody.action === 'createVendors') {
      return createVendors(requestBody);
    }
    if (requestBody.action === 'createItems') {
      return createItems(requestBody);
    }
    if (requestBody.action === 'setOpeningBalances') {
      return setOpeningBalances(requestBody);
    }
    return createSubsidiary(requestBody);
  }

  // ── Criar registros FTE (Tax Rules + Determinations) ──────────────────────

  /**
   * Field IDs exatos dos registros FTE, extraidos do metadata-catalog do NetSuite.
   * Estes IDs sao padrao do bundle SuiteTax Brazil e nao mudam entre ambientes.
   *
   * Convencao de prefixos nos suffixos:
   *   _t_ = TEXT (string)
   *   _l_ = LIST/LOOKUP (referencia a record/list)
   *   _m_ = MULTI-SELECT (array de IDs)
   *   _d_ = DATE
   *   _p_ = PERCENT/NUMBER
   *   _n_ = NUMBER
   *   _f_ = FLAG/BOOLEAN
   */
  var RULE_FIELDS = {
    // TEXT fields (setValue com string direta)
    stateOri:     'custrecord_fte_taxrules_t_state_ori',
    stateDes:     'custrecord_fte_taxrules_t_state_des',
    cityOri:      'custrecord_fte_taxrules_t_city_ori',
    cityDes:      'custrecord_fte_taxrules_t_city_des',
    operationCode:'custrecord_fte_taxrules_t_operation_code',
    // ENUM fields (setValue com codigo string, ex: 'BR')
    countryOri:   'custrecord_fte_taxrules_l_country_ori',
    countryDes:   'custrecord_fte_taxrules_l_country_des',
    // LOOKUP fields (setValue com internalId numerico)
    regimeOri:    'custrecord_fte_taxrules_l_taxregime_orig',
    regimeDes:    'custrecord_fte_taxrules_l_taxregime_dest',
    lobOri:       'custrecord_fte_taxrules_l_lob_orig',
    lobDes:       'custrecord_fte_taxrules_l_lob_dest',
    itemCode:     'custrecord_fte_taxrules_l_itemcode',
    parent:       'custrecord_fte_taxrules_l_parent',
    // MULTI-SELECT (setValue com array de IDs)
    subsidiary:   'custrecord_fte_taxrules_m_subsidiary',
    // DATE fields
    effFrom:      'custrecord_fte_taxrules_d_eff_from',
    effUntil:     'custrecord_fte_taxrules_d_eff_until',
  };

  var DET_FIELDS = {
    // LOOKUP fields
    taxRule:      'custrecord_fte_taxrate_l_taxrule',
    taxCode:      'custrecord_fte_taxrate_l_taxcode',
    paramType:    'custrecord_fte_taxrate_l_paramtype',
    // NUMBER fields
    rate:         'custrecord_fte_taxrate_p_rate',
    deduction:    'custrecord_fte_taxrate_n_deduc_amount',
    // TEXT fields
    paramValue:   'custrecord_fte_taxrate_t_value',
    supplInfo:    'custrecord_fte_taxrate_t_suppl_info_code',
    // DATE fields
    effFrom:      'custrecord_fte_taxrate_d_effective_from',
    effUntil:     'custrecord_fte_taxrate_d_effective_until',
    // BOOLEAN fields
    allowOverride:'custrecord_fte_taxrate_f_allow_override',
  };

  /**
   * Constroi mapa nome→id para uma tabela de referencia via SuiteQL.
   * Usado apenas para records padrao (subsidiary, etc.) que existem com certeza.
   */
  function buildNameToIdMap(recordType) {
    const map = {};
    try {
      const rows = runSuiteQL('SELECT id, name FROM ' + recordType + ' ORDER BY name');
      for (var i = 0; i < rows.length; i++) {
        map[rows[i].name] = String(rows[i].id);
      }
    } catch (e) {
      log.error('Lookup Map Error', recordType + ': ' + e.message);
    }
    return map;
  }

  /**
   * Constroi mapa nome→id lendo as opcoes de um campo select diretamente do registro.
   * Esta eh a forma mais confiavel de obter valores validos para campos FTE,
   * pois funciona independente do nome do custom record/list.
   *
   * @param {string} recordType - Tipo do registro (ex: 'customrecord_fte_taxrate')
   * @param {string} fieldId - ID do campo (ex: 'custrecord_fte_taxrate_l_paramtype')
   * @returns {{ byName: Object, byText: Object }} Maps de texto→id
   */
  function buildFieldOptionsMap(recordType, fieldId) {
    var map = {};
    if (!recordType || !fieldId) return map;
    try {
      var rec = record.create({ type: recordType, isDynamic: true });
      var fld = rec.getField({ fieldId: fieldId });
      if (!fld || typeof fld.getSelectOptions !== 'function') {
        log.error('Field Options', fieldId + ': getSelectOptions not available');
        return map;
      }
      var options = fld.getSelectOptions({ filter: '', operator: 'contains' });
      for (var i = 0; i < options.length; i++) {
        var opt = options[i];
        if (opt.value) {
          map[opt.text] = String(opt.value);
          // Normalizar: sem acentos para matching flexivel
          var norm = opt.text.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ').trim();
          map[norm] = String(opt.value);
        }
      }
      log.audit('Field Options [' + fieldId + ']', 'Found ' + options.length + ' options');
    } catch (e) {
      log.error('Field Options Error', recordType + '.' + fieldId + ': ' + e.message);
    }
    return map;
  }

  /**
   * Busca um valor no mapa de opcoes com matching flexivel.
   * Tenta: exato, normalizado, por prefixo CST/CSOSN.
   */
  function findOptionValue(valueName, optionsMap) {
    if (!valueName || !optionsMap) return null;

    // 1. Match exato
    if (optionsMap[valueName]) return optionsMap[valueName];

    // 2. Match normalizado
    var norm = valueName.toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ').trim();
    if (optionsMap[norm]) return optionsMap[norm];

    // 3a. Match por codigo cClassTrib (ex: "cClassTrib 410014" ou "cClassTrib 410014 - Descricao")
    var cctMatch = valueName.match(/cClassTrib\s+(\d+)/i);
    if (cctMatch) {
      var cctCode = cctMatch[1];
      var cctPrefix = 'cclasstrib ' + cctCode;
      var cctCandidates = [];
      for (var ck in optionsMap) {
        if (ck.toLowerCase().indexOf(cctPrefix) >= 0) {
          cctCandidates.push({ key: ck, id: optionsMap[ck] });
        }
      }
      if (cctCandidates.length >= 1) return cctCandidates[0].id;
    }

    // 3b. Match por prefixo CST/CSOSN (ex: "CST 00")
    var cstMatch = valueName.match(/^(C(?:ST|SOSN)\s+\d+)/i);
    if (cstMatch) {
      var prefix = cstMatch[1].toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      var candidates = [];
      for (var key in optionsMap) {
        if (key.toLowerCase().indexOf(prefix) === 0) {
          candidates.push({ key: key, id: optionsMap[key] });
        }
      }
      if (candidates.length === 1) return candidates[0].id;
      if (candidates.length > 1) {
        // Tentar match mais preciso pela descricao
        var descPart = norm.replace(prefix, '').replace(/^\s*-\s*/, '').trim();
        for (var c = 0; c < candidates.length; c++) {
          var candDesc = candidates[c].key.toLowerCase().replace(prefix, '').replace(/^\s*-\s*/, '').trim();
          if (candDesc.indexOf(descPart.substring(0, 15)) >= 0 || descPart.indexOf(candDesc.substring(0, 15)) >= 0) {
            return candidates[c].id;
          }
        }
        return candidates[0].id;
      }
    }

    // 4. Match parcial (substring)
    for (var pKey in optionsMap) {
      var pNorm = pKey.toLowerCase();
      if (pNorm.indexOf(norm) >= 0 || norm.indexOf(pNorm) >= 0) {
        return optionsMap[pKey];
      }
    }

    return null;
  }

  /**
   * Seta campo de referencia (lookup) resolvendo nome → id.
   * Usa findOptionValue para matching flexivel quando optionsMap vem de getSelectOptions.
   * @param {boolean} [useFlexMatch=false] - Se true, usa findOptionValue em vez de lookup direto
   */
  function setLookupSafe(rec, fieldId, valueName, lookupMap, useFlexMatch) {
    if (!fieldId || !valueName) return;
    try {
      var internalId;
      if (useFlexMatch) {
        internalId = findOptionValue(valueName, lookupMap);
      } else {
        internalId = lookupMap[valueName];
      }
      if (internalId) {
        rec.setValue({ fieldId: fieldId, value: parseInt(internalId) });
      } else {
        // Tenta setar como texto (ultimo recurso)
        try { rec.setText({ fieldId: fieldId, text: valueName }); } catch (e2) {
          log.error('Set Lookup setText Failed', fieldId + ' = ' + valueName);
        }
      }
    } catch (e) {
      log.error('Set Lookup Error', fieldId + ' = ' + valueName + ': ' + e.message);
    }
  }

  /**
   * Seta campo de texto simples
   */
  function setTextSafe(rec, fieldId, value) {
    if (!fieldId || !value) return;
    try {
      rec.setValue({ fieldId: fieldId, value: value });
    } catch (e) {
      log.error('Set Text Error', fieldId + ' = ' + value + ': ' + e.message);
    }
  }

  /**
   * Seta campo numerico
   */
  function setNumericSafe(rec, fieldId, value) {
    if (!fieldId || value === null || value === undefined || value === '') return;
    try {
      rec.setValue({ fieldId: fieldId, value: parseFloat(value) });
    } catch (e) {
      log.error('Set Numeric Error', fieldId + ' = ' + value + ': ' + e.message);
    }
  }

  /**
   * Seta campo de data (aceita DD/MM/YYYY ou YYYY-MM-DD)
   */
  function setDateSafe(rec, fieldId, dateStr) {
    if (!fieldId || !dateStr) return;
    try {
      var year, month, day;
      if (dateStr.indexOf('/') >= 0) {
        // Formato DD/MM/YYYY
        var slashParts = dateStr.split('/');
        day = parseInt(slashParts[0], 10);
        month = parseInt(slashParts[1], 10);
        year = parseInt(slashParts[2], 10);
      } else {
        // Formato YYYY-MM-DD
        var dashParts = dateStr.split('-');
        year = parseInt(dashParts[0], 10);
        month = parseInt(dashParts[1], 10);
        day = parseInt(dashParts[2], 10);
      }
      if (!year || !month || !day) {
        log.error('Set Date Error', fieldId + ' = ' + dateStr + ': formato invalido');
        return;
      }
      var dateObj = new Date(year, month - 1, day);
      rec.setValue({ fieldId: fieldId, value: dateObj });
      log.audit('Set Date OK', fieldId + ' = ' + dateStr + ' → ' + dateObj.toISOString());
    } catch (e) {
      log.error('Set Date Error', fieldId + ' = ' + dateStr + ': ' + e.message);
    }
  }

  /**
   * Cria regras FTE e determinacoes no NetSuite.
   *
   * Usa field IDs hardcoded (RULE_FIELDS / DET_FIELDS) em vez de discovery
   * porque os nomes dos campos sao padrao do bundle SuiteTax e os tipos
   * (TEXT vs LOOKUP vs ENUM vs MULTI-SELECT) precisam de tratamento diferente.
   */
  function createFTERules(data) {
    log.audit('Create FTE Rules', 'Inicio');
    var results = {
      success: true,
      rulesCreated: 0,
      determinationsCreated: 0,
      errors: [],
      ruleIdMap: {},
      fieldMappings: { rules: RULE_FIELDS, dets: DET_FIELDS },
    };

    try {
      // 1. Construir caches de lookup lendo opcoes dos campos LOOKUP reais
      var lookups = {
        subsidiaries: buildNameToIdMap('subsidiary'),
        regimes:    buildFieldOptionsMap('customrecord_fte_taxrules', RULE_FIELDS.regimeOri),
        lobs:       buildFieldOptionsMap('customrecord_fte_taxrules', RULE_FIELDS.lobOri),
        itemCodes:  buildFieldOptionsMap('customrecord_fte_taxrules', RULE_FIELDS.itemCode),
        taxCodes:   buildFieldOptionsMap('customrecord_fte_taxrate',  DET_FIELDS.taxCode),
        paramTypes: buildFieldOptionsMap('customrecord_fte_taxrate',  DET_FIELDS.paramType),
      };

      log.audit('FTE Lookups (from field options)', JSON.stringify({
        subsidiaries: Object.keys(lookups.subsidiaries).length,
        regimes:      Object.keys(lookups.regimes).length,
        lobs:         Object.keys(lookups.lobs).length,
        itemCodes:    Object.keys(lookups.itemCodes).length,
        taxCodes:     Object.keys(lookups.taxCodes).length,
        paramTypes:   Object.keys(lookups.paramTypes).length,
      }));

      // Log amostras para debug
      log.audit('FTE Regimes', JSON.stringify(Object.keys(lookups.regimes).filter(function(k) { return k.indexOf('lucro') >= 0 || k.indexOf('Lucro') >= 0 || k.indexOf('Simples') >= 0; }).slice(0, 10)));
      log.audit('FTE LOBs', JSON.stringify(Object.keys(lookups.lobs).filter(function(k) { return k.indexOf('Venda') >= 0 || k.indexOf('Presta') >= 0 || k.indexOf('Fabric') >= 0; }).slice(0, 10)));
      log.audit('FTE ParamTypes (CST)', JSON.stringify(Object.keys(lookups.paramTypes).filter(function(k) { return k.indexOf('CST') >= 0; }).slice(0, 15)));
      log.audit('FTE TaxCodes', JSON.stringify(Object.keys(lookups.taxCodes).filter(function(k) { return k.indexOf('ICMS') >= 0 || k.indexOf('PIS') >= 0; }).slice(0, 15)));

      // 2. Criar regras
      var rules = data.rules || [];
      for (var r = 0; r < rules.length; r++) {
        var rule = rules[r];
        try {
          var ruleRec = record.create({ type: 'customrecord_fte_taxrules', isDynamic: true });

          ruleRec.setValue({ fieldId: 'name', value: rule.name });
          if (rule.externalId) {
            try { ruleRec.setValue({ fieldId: 'externalid', value: String(rule.externalId) }); } catch (e) { /* ignore */ }
          }

          // MULTI-SELECT: subsidiary (aceita array de IDs)
          if (rule.subsidiary) {
            var subId = lookups.subsidiaries[rule.subsidiary];
            if (subId) {
              try {
                ruleRec.setValue({ fieldId: RULE_FIELDS.subsidiary, value: [parseInt(subId)] });
              } catch (e) {
                log.error('Rule Subsidiary Error', e.message);
              }
            }
          }

          // TEXT: CFOP (operation code) — string direta
          setTextSafe(ruleRec, RULE_FIELDS.operationCode, rule.cfop);

          // LOOKUP: Item Code (NCM)
          if (rule.ncm) {
            setLookupSafe(ruleRec, RULE_FIELDS.itemCode, rule.ncm, lookups.itemCodes, true);
          }

          // TEXT: Estados — campos de texto livre
          setTextSafe(ruleRec, RULE_FIELDS.stateOri, rule.ufEmissor);
          setTextSafe(ruleRec, RULE_FIELDS.stateDes, rule.ufDestinatario);

          // TEXT: Cidades — campos de texto livre
          setTextSafe(ruleRec, RULE_FIELDS.cityOri, rule.cidadeEmissor);
          setTextSafe(ruleRec, RULE_FIELDS.cityDes, rule.cidadeDestinatario);

          // ENUM: Pais — aceita codigo do pais como string (ex: 'BR')
          setTextSafe(ruleRec, RULE_FIELDS.countryOri, rule.paisEmissor);
          setTextSafe(ruleRec, RULE_FIELDS.countryDes, rule.paisDestinatario);

          // LOOKUP: Regimes fiscais
          setLookupSafe(ruleRec, RULE_FIELDS.regimeOri, rule.regimeEmissor, lookups.regimes, true);
          setLookupSafe(ruleRec, RULE_FIELDS.regimeDes, rule.regimeDestinatario, lookups.regimes, true);

          // LOOKUP: LOBs
          setLookupSafe(ruleRec, RULE_FIELDS.lobOri, rule.lobEmissor, lookups.lobs, true);
          setLookupSafe(ruleRec, RULE_FIELDS.lobDes, rule.lobDestinatario, lookups.lobs, true);

          // DATE
          setDateSafe(ruleRec, RULE_FIELDS.effFrom, rule.validoAPartirDe);
          setDateSafe(ruleRec, RULE_FIELDS.effUntil, rule.validoAte);

          log.audit('FTE Rule Fields Set', JSON.stringify({
            ext: rule.externalId,
            cfop: rule.cfop || '(vazio)',
            regime: rule.regimeEmissor || '(vazio)',
            lob: rule.lobEmissor || '(vazio)',
            state: rule.ufEmissor + ' → ' + rule.ufDestinatario,
            country: rule.paisEmissor || '(vazio)',
          }));

          var ruleId = ruleRec.save({ enableSourcing: true, ignoreMandatoryFields: true });
          results.ruleIdMap[rule.externalId] = String(ruleId);
          results.rulesCreated++;
          log.audit('FTE Rule Created', rule.externalId + ' -> ' + ruleId);
        } catch (e) {
          results.errors.push({ type: 'rule', externalId: rule.externalId, error: e.message });
          log.error('FTE Rule Error', rule.externalId + ': ' + e.message);
        }
      }

      // 2b. PASS 2: Setar parent nas regras que tem vinculo hierarquico
      for (var rp = 0; rp < rules.length; rp++) {
        var parentRule = rules[rp];
        if (!parentRule.parent) continue;

        var childNsId = results.ruleIdMap[parentRule.externalId];
        var parentNsId = results.ruleIdMap[parentRule.parent];

        if (!childNsId || !parentNsId) {
          results.errors.push({
            type: 'rule_parent',
            externalId: parentRule.externalId,
            error: !parentNsId
              ? 'Parent externalId ' + parentRule.parent + ' nao encontrado em ruleIdMap'
              : 'Child externalId ' + parentRule.externalId + ' nao encontrado em ruleIdMap',
          });
          continue;
        }

        try {
          record.submitFields({
            type: 'customrecord_fte_taxrules',
            id: parseInt(childNsId),
            values: { [RULE_FIELDS.parent]: parseInt(parentNsId) },
          });
          log.audit('FTE Rule Parent Set', parentRule.externalId + ' -> parent ' + parentNsId);
        } catch (e) {
          results.errors.push({ type: 'rule_parent', externalId: parentRule.externalId, error: e.message });
          log.error('FTE Rule Parent Error', parentRule.externalId + ': ' + e.message);
        }
      }

      // 3. Criar determinacoes
      // ── Helpers reforma tributaria (CBS/IBS/IS) ──
      const REFORM_TAX_CODES = new Set(['CBS_2026_BR', 'IBS_2026_BR', 'IS_2026_BR']);

      function isReformTaxCode(code) {
        if (!code) return false;
        if (REFORM_TAX_CODES.has(code)) return true;
        // Defensivo: se versao mudar (CBS_2027_BR etc), tratar como dependente + WARNING
        if (/^(CBS|IBS|IS)_/.test(code)) {
          log.audit('Reform taxCode not in Set', code + ' — tratando como dependente');
          return true;
        }
        return false;
      }

      const ctxParamCache = {};

      function getCtxParamTypes(detRec, taxCode, subsidiaryKey) {
        const cacheKey = taxCode + '|' + (subsidiaryKey || '');
        if (ctxParamCache[cacheKey]) return ctxParamCache[cacheKey];

        const ptField = detRec.getField({ fieldId: DET_FIELDS.paramType });
        if (!ptField || typeof ptField.getSelectOptions !== 'function') return null;

        const options = ptField.getSelectOptions({ filter: '', operator: 'contains' });
        const result = { map: {}, optionsCount: options.length };

        for (let i = 0; i < options.length; i++) {
          const t = options[i].text || '';
          const v = options[i].value;
          if (!v) continue;
          result.map[t] = String(v);
          const norm = t.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/\s+/g, ' ').trim();
          result.map[norm] = String(v);
        }

        ctxParamCache[cacheKey] = result;
        log.audit('ParamType ctx cache [' + cacheKey + ']', options.length + ' options');
        return result;
      }

      // Subsidiary ID estavel para cache key (evitar '' quando _subsidiaryName nao existe)
      var subsidiaryIdForCache = '';
      if (data.rules && data.rules.length > 0 && data.rules[0].subsidiary) {
        var subId = findOptionValue(data.rules[0].subsidiary, lookups.subsidiaries);
        subsidiaryIdForCache = subId || data.rules[0].subsidiary || '';
      }

      // SuiteQL fallback: busca TODOS os param types da tabela (contorna dependencia UI)
      var sqlParamTypesCache = null;

      function getSqlParamTypes() {
        if (sqlParamTypesCache) return sqlParamTypesCache;
        try {
          var rows = runSuiteQL("SELECT id, name FROM CUSTOMRECORD_FTE_PARAMTYPE ORDER BY name");
          var map = {};
          for (var i = 0; i < rows.length; i++) {
            var n = rows[i].name || '';
            var v = String(rows[i].id);
            if (!v || v === 'null') continue;
            map[n] = v;
            var norm = n.toLowerCase()
              .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
              .replace(/\s+/g, ' ').trim();
            map[norm] = v;
          }
          sqlParamTypesCache = { map: map, count: rows.length };
          log.audit('ParamType SQL cache', rows.length + ' records from CUSTOMRECORD_FTE_PARAMTYPE');
          return sqlParamTypesCache;
        } catch (e) {
          log.error('ParamType SQL Error', e.message);
          return null;
        }
      }

      // Helpers seguros para leitura de campos (getText pode falhar em dynamic mode)
      function safeGetText(rec, fieldId) {
        try { return rec.getText({ fieldId: fieldId }); } catch (e) { return '[getText failed]'; }
      }
      function safeGetValue(rec, fieldId) {
        try { return rec.getValue({ fieldId: fieldId }); } catch (e) { return '[getValue failed]'; }
      }

      var dets = data.determinations || [];
      for (var d = 0; d < dets.length; d++) {
        var det = dets[d];
        try {
          // Centralizar cClassTrib: aceita campo novo e legacy (deploy compatibility)
          var cct = det.cClassTrib || det._cClassTrib || '';

          var parentId = results.ruleIdMap[det.ruleExternalId];
          if (!parentId) {
            results.errors.push({ type: 'det', externalId: det.externalId, error: 'Regra pai ' + det.ruleExternalId + ' nao foi criada' });
            continue;
          }

          var detRec = record.create({ type: 'customrecord_fte_taxrate', isDynamic: true });

          detRec.setValue({ fieldId: 'name', value: String(det.externalId) });
          if (det.externalId) {
            try { detRec.setValue({ fieldId: 'externalid', value: String(det.externalId) }); } catch (e) { /* ignore */ }
          }

          // LOOKUP: Link para regra pai
          try {
            detRec.setValue({ fieldId: DET_FIELDS.taxRule, value: parseInt(parentId) });
          } catch (e) {
            log.error('FTE Det Link Error', det.externalId + ': ' + e.message);
          }

          // LOOKUP: Tax Code — resolver com matching flexivel
          var taxCodeResolved = false;
          if (det.codigoImposto) {
            var taxCodeName = det.codigoImposto;
            var tcId = findOptionValue(taxCodeName, lookups.taxCodes)
                    || findOptionValue(taxCodeName.replace(/_/g, ' '), lookups.taxCodes)
                    || findOptionValue(taxCodeName.replace(/ /g, '_'), lookups.taxCodes);
            if (tcId) {
              try {
                detRec.setValue({ fieldId: DET_FIELDS.taxCode, value: parseInt(tcId) });
                taxCodeResolved = true;
                log.audit('TaxCode Resolved', taxCodeName + ' → id:' + tcId);
              } catch (e) { log.error('TaxCode setValue', e.message); }
            }
            if (!taxCodeResolved) {
              try {
                detRec.setText({ fieldId: DET_FIELDS.taxCode, text: taxCodeName });
                taxCodeResolved = true;
              } catch (e) {
                log.error('TaxCode setText Failed', taxCodeName + ': ' + e.message);
              }
            }
          }

          if (!taxCodeResolved) {
            results.errors.push({
              type: 'det', externalId: det.externalId,
              error: 'Tax code "' + det.codigoImposto + '" nao encontrado'
            });
            continue;
          }

          // NUMBER: Aliquota
          setNumericSafe(detRec, DET_FIELDS.rate, det.aliquota);

          // ── CAMPOS DE DADOS (setar ANTES do paramType para evitar dependency reset) ──

          // TEXT: Valor do parametro
          setTextSafe(detRec, DET_FIELDS.paramValue, det.valorParametro);

          // NUMBER: Abatimento
          setNumericSafe(detRec, DET_FIELDS.deduction, det.valorAbatimento);

          // DATE
          setDateSafe(detRec, DET_FIELDS.effFrom, det.validoAPartirDe);
          setDateSafe(detRec, DET_FIELDS.effUntil, det.validoAte);

          // ── LOOKUP: Param Type — OBRIGATORIO (setado por ultimo para evitar dependency clear) ──
          var paramTypeResolved = false;
          var resolvedParamId = null;

          if (det.tipoParametro) {
            // Step 1: Contextual — opcoes do campo paramType com taxCode JA setado
            //         Mais confiavel porque paramType depende de taxCode
            var ctxResult = getCtxParamTypes(detRec, det.codigoImposto, subsidiaryIdForCache);
            if (ctxResult && ctxResult.optionsCount > 0) {
              // 1a: match pelo texto completo
              var ctxId = findOptionValue(det.tipoParametro, ctxResult.map);

              // 1b: fallback por codigo numerico cClassTrib (CBS/IBS)
              if (!ctxId && cct) {
                var cctCode = String(cct).trim();
                for (var ctxKey in ctxResult.map) {
                  var k = String(ctxKey || '').toLowerCase();
                  if (k.indexOf(cctCode) >= 0) {
                    ctxId = ctxResult.map[ctxKey];
                    log.audit('ParamType cClassTrib code match', cctCode + ' -> key="' + ctxKey + '" id=' + ctxId);
                    break;
                  }
                }
              }

              if (ctxId) {
                try {
                  detRec.setValue({ fieldId: DET_FIELDS.paramType, value: parseInt(ctxId) });
                  // Verificar se o valor foi retido (field dependency pode limpar)
                  var ctxVerify = detRec.getValue({ fieldId: DET_FIELDS.paramType });
                  if (ctxVerify) {
                    paramTypeResolved = true;
                    resolvedParamId = parseInt(ctxId);
                    log.audit('ParamType Resolved (ctx)', det.tipoParametro + ' -> id:' + ctxId + ' (verified:' + ctxVerify + ') | taxCode=' + det.codigoImposto);
                  } else {
                    log.error('ParamType ctx cleared by dependency', det.tipoParametro + ' id:' + ctxId + ' — setValue aceito mas getValue vazio (field dependency invalida para ' + det.codigoImposto + ')');
                  }
                } catch (e) {
                  log.error('ParamType setValue (ctx)', det.tipoParametro + ' id:' + ctxId + ': ' + e.message);
                }
              }
            }

            // Step 2: SuiteQL fallback — busca TODOS os param types da tabela
            //         Cobre caso onde getSelectOptions nao propaga a dependencia
            if (!paramTypeResolved) {
              var sqlResult = getSqlParamTypes();
              if (sqlResult) {
                var sqlId = findOptionValue(det.tipoParametro, sqlResult.map);

                // Fallback cClassTrib por codigo numerico
                if (!sqlId && cct) {
                  var cctCode2 = String(cct).trim();
                  for (var sqlKey in sqlResult.map) {
                    var sk = String(sqlKey || '').toLowerCase();
                    if (sk.indexOf(cctCode2) >= 0) {
                      sqlId = sqlResult.map[sqlKey];
                      log.audit('ParamType SQL cClassTrib match', cctCode2 + ' -> key="' + sqlKey + '" id=' + sqlId);
                      break;
                    }
                  }
                }

                if (sqlId) {
                  try {
                    detRec.setValue({ fieldId: DET_FIELDS.paramType, value: parseInt(sqlId) });
                    // Verificar se o valor foi retido (SQL pode retornar ID invalido para este taxCode)
                    var sqlVerify = detRec.getValue({ fieldId: DET_FIELDS.paramType });
                    if (sqlVerify) {
                      paramTypeResolved = true;
                      resolvedParamId = parseInt(sqlId);
                      log.audit('ParamType Resolved (SQL)', det.tipoParametro + ' -> id:' + sqlId + ' (verified:' + sqlVerify + ')');
                    } else {
                      log.error('ParamType SQL cleared by dependency', det.tipoParametro + ' id:' + sqlId + ' — setValue aceito mas getValue vazio (ID invalido para ' + det.codigoImposto + ')');
                    }
                  } catch (e) {
                    log.error('ParamType setValue (SQL)', det.tipoParametro + ' id:' + sqlId + ': ' + e.message);
                  }
                }
              }
            }

            // Step 3: setText + getValue — ultimo recurso, so para nao-dependentes
            if (!paramTypeResolved && !isReformTaxCode(det.codigoImposto)) {
              try {
                detRec.setText({ fieldId: DET_FIELDS.paramType, text: det.tipoParametro });
                var ptCheck = detRec.getValue({ fieldId: DET_FIELDS.paramType });
                if (ptCheck) {
                  paramTypeResolved = true;
                  resolvedParamId = ptCheck;
                  log.audit('ParamType setText (fallback)', det.tipoParametro + ' -> val:' + ptCheck);
                } else {
                  log.error('ParamType setText empty', det.tipoParametro + ' — setText nao resolveu valor');
                }
              } catch (e) {
                log.error('ParamType setText Failed', det.tipoParametro + ': ' + e.message);
              }
            }

            // Diagnostico se nada resolveu
            if (!paramTypeResolved) {
              var ctxSample = [];
              if (ctxResult) {
                var seen = 0;
                for (var dsk in ctxResult.map) {
                  if (seen >= 5) break;
                  if (dsk === String(dsk).toLowerCase()) continue;
                  ctxSample.push(dsk);
                  seen++;
                }
              }
              log.error('ParamType ALL steps failed', JSON.stringify({
                externalId: det.externalId,
                taxCode: det.codigoImposto,
                tipoParametro: det.tipoParametro,
                cClassTrib: cct || '(sem)',
                ctxOptionsCount: ctxResult ? ctxResult.optionsCount : -1,
                ctxSample: ctxSample,
                sqlAvailable: !!getSqlParamTypes(),
              }));
            }
          }

          // ── Gate: verificar estado REAL do campo (nao flag boolean) ──
          var finalPtVal = detRec.getValue({ fieldId: DET_FIELDS.paramType });

          // Fallback: se dependency limpou apos resolve, tentar 1 re-set
          if (!finalPtVal && resolvedParamId) {
            log.audit('ParamType cleared after resolve', 'Attempting re-set id=' + resolvedParamId + ' for ' + det.codigoImposto);
            try {
              detRec.setValue({ fieldId: DET_FIELDS.paramType, value: resolvedParamId });
              finalPtVal = detRec.getValue({ fieldId: DET_FIELDS.paramType });
              if (finalPtVal) {
                log.audit('ParamType re-set OK', 'id=' + resolvedParamId + ' retained after re-set');
              }
            } catch (e) {
              log.error('ParamType re-set error', e.message);
            }
          }

          if (!finalPtVal) {
            var isReform = isReformTaxCode(det.codigoImposto);
            var gateMsg = '[GATE] Não foi possível salvar o registro de configurações de determinação de impostos porque nenhum tipo de parâmetro foi selecionado. Para o imposto ' +
                     (det.codigoImposto || '(vazio)') + ', selecione o tipo de parâmetro' +
                     (det.tipoParametro ? ' (sugestão: "' + det.tipoParametro + '")' : '') +
                     ', digite o valor do parâmetro e tente novamente.';
            if (isReform && cct) {
              gateMsg += ' Verifique se o param type "cClassTrib ' + cct +
                '" existe em CUSTOMRECORD_FTE_PARAMTYPE no ambiente NetSuite.';
            }
            results.errors.push({
              type: 'det',
              externalId: det.externalId,
              error: gateMsg,
            });
            log.error('ParamType Missing - skip', JSON.stringify({
              externalId: det.externalId,
              tipoParametro: det.tipoParametro,
              taxCode: det.codigoImposto,
              cClassTrib: cct || '(sem)',
              isReform: isReform,
              resolvedParamId: resolvedParamId || '(null)',
              finalPtVal: finalPtVal || '(vazio)',
            }));
            continue;
          }

          // Log pre-save diagnostico — sempre leitura fresca do record
          var ptValNow = detRec.getValue({ fieldId: DET_FIELDS.paramType });
          var ptTextNow = safeGetText(detRec, DET_FIELDS.paramType);
          log.audit('Pre-save state', JSON.stringify({
            externalId: det.externalId,
            paramTypeValue: ptValNow,
            paramTypeText: ptTextNow,
            taxCode: detRec.getValue({ fieldId: DET_FIELDS.taxCode }),
            taxCodeText: safeGetText(detRec, DET_FIELDS.taxCode),
            rate: safeGetValue(detRec, DET_FIELDS.rate),
            paramValue: safeGetValue(detRec, DET_FIELDS.paramValue),
            resolvedParamId: resolvedParamId,
            inputTipoParametro: det.tipoParametro,
            inputValorParametro: det.valorParametro,
            inputAliquota: det.aliquota,
          }));

          var detId = detRec.save({ enableSourcing: false, ignoreMandatoryFields: false });
          results.determinationsCreated++;
          log.audit('FTE Det Created', det.externalId + ' -> ' + detId);
        } catch (e) {
          log.error('Det save error', JSON.stringify({
            externalId: det.externalId,
            name: e.name || '(sem name)',
            message: e.message,
            stack: e.stack || '(sem stack)',
            paramTypeAtError: safeGetValue(detRec, DET_FIELDS.paramType),
            paramTypeTextAtError: safeGetText(detRec, DET_FIELDS.paramType),
            taxCodeAtError: safeGetValue(detRec, DET_FIELDS.taxCode),
            rateAtError: safeGetValue(detRec, DET_FIELDS.rate),
          }));
          results.errors.push({
            type: 'det',
            externalId: det.externalId,
            error: '[SAVE] ' + e.message,
          });
        }
      }

      results.success = results.errors.length === 0;
    } catch (e) {
      results.success = false;
      results.errors.push({ type: 'general', error: e.message });
      log.error('Create FTE Rules - General Error', e.message);
    }

    log.audit('Create FTE Rules - Done', JSON.stringify({
      rules: results.rulesCreated,
      dets: results.determinationsCreated,
      errors: results.errors.length,
    }));

    return results;
  }

  /**
   * POST — Cria uma subsidiary
   */
  function createSubsidiary(requestBody) {
    log.audit('Create Subsidiary - Input', JSON.stringify(requestBody));

    // Log detalhado dos campos de endereco recebidos
    log.audit('Address Fields Received', JSON.stringify({
      address: requestBody.address || '(vazio)',
      addressNumber: requestBody.addressNumber || '(vazio)',
      brCityId: requestBody.brCityId || '(vazio)',
      state: requestBody.state || '(vazio)',
      zipCode: requestBody.zipCode || '(vazio)',
    }));

    try {
      const subRecord = record.create({
        type: record.Type.SUBSIDIARY,
        isDynamic: true,
      });

      subRecord.setValue({ fieldId: 'name', value: requestBody.name });

      if (requestBody.parent) {
        subRecord.setValue({ fieldId: 'parent', value: parseInt(requestBody.parent) });
      }

      subRecord.setValue({ fieldId: 'country', value: requestBody.country || 'BR' });

      if (requestBody.currency) {
        subRecord.setValue({ fieldId: 'currency', value: parseInt(requestBody.currency) });
      }

      if (requestBody.taxfiscalcalendar) {
        subRecord.setValue({ fieldId: 'taxfiscalcalendar', value: parseInt(requestBody.taxfiscalcalendar) });
      }

      if (requestBody.fiscalcalendar) {
        subRecord.setValue({ fieldId: 'fiscalcalendar', value: parseInt(requestBody.fiscalcalendar) });
      }

      subRecord.setValue({ fieldId: 'languagelocale', value: requestBody.languagelocale || 'en_US' });

      if (requestBody.cnpj) {
        subRecord.setValue({ fieldId: 'federalIdNumber', value: requestBody.cnpj });
      }

      if (requestBody.ie) {
        subRecord.setValue({ fieldId: 'state1TaxNumber', value: requestBody.ie });
      }

      // Endereco — cada campo com seu proprio try/catch para nao perder os demais
      const mainAddr = subRecord.getSubrecord({ fieldId: 'mainaddress' });
      log.audit('Address Subrecord', 'Obtido com sucesso');

      mainAddr.setValue({ fieldId: 'country', value: requestBody.country || 'BR' });
      log.audit('Address - country', 'OK');

      // addr1 — Endereco (OBRIGATORIO)
      try {
        const addrValue = requestBody.address || 'A definir';
        mainAddr.setValue({ fieldId: 'addr1', value: addrValue });
        log.audit('Address - addr1', addrValue);
      } catch (e) {
        log.error('Address - addr1 ERRO', e.message);
      }

      // addr3 — Numero (OBRIGATORIO)
      try {
        const numValue = requestBody.addressNumber || 'S/N';
        mainAddr.setValue({ fieldId: 'addr3', value: numValue });
        log.audit('Address - addr3', numValue);
      } catch (e) {
        log.error('Address - addr3 ERRO', e.message);
      }

      // state — Estado (OBRIGATORIO)
      try {
        if (requestBody.state) {
          mainAddr.setValue({ fieldId: 'state', value: requestBody.state });
          log.audit('Address - state', requestBody.state);
        }
      } catch (e) {
        log.error('Address - state ERRO', e.message);
      }

      // zip — CEP
      try {
        if (requestBody.zipCode) {
          mainAddr.setValue({ fieldId: 'zip', value: requestBody.zipCode });
          log.audit('Address - zip', requestBody.zipCode);
        }
      } catch (e) {
        log.error('Address - zip ERRO', e.message);
      }

      // custrecord_brl_addr_form_city — Cidade do Brasil (OBRIGATORIO)
      try {
        if (requestBody.brCityId) {
          mainAddr.setValue({ fieldId: 'custrecord_brl_addr_form_city', value: parseInt(requestBody.brCityId) });
          log.audit('Address - city', requestBody.brCityId);
        } else {
          log.error('Address - city', 'brCityId NAO foi enviado no payload!');
        }
      } catch (e) {
        log.error('Address - custrecord_brl_addr_form_city ERRO', e.message);
      }

      // Campos extras
      if (requestBody.customFields && typeof requestBody.customFields === 'object') {
        for (const [fieldId, value] of Object.entries(requestBody.customFields)) {
          try {
            subRecord.setValue({ fieldId, value });
          } catch (e) {
            log.error('Custom Field Error', `${fieldId}: ${e.message}`);
          }
        }
      }

      const internalId = subRecord.save({
        enableSourcing: true,
        ignoreMandatoryFields: false,
      });

      log.audit('Subsidiary Created', `ID: ${internalId}`);

      return {
        success: true,
        internalId: String(internalId),
        name: requestBody.name,
      };
    } catch (e) {
      log.error('Create Subsidiary Error', e.message);
      return {
        success: false,
        error: e.message,
        errorCode: e.name,
      };
    }
  }

  /**
   * Tax Discovery — Retorna todos os registros fiscais do ambiente
   */
  function getTaxDiscovery() {
    log.audit('Tax Discovery', 'Iniciando discovery fiscal');
    const discovery = {};

    // 1. Custom records fiscais instalados
    try {
      discovery.customRecordTypes = runSuiteQL(
        "SELECT scriptid, name FROM customrecordtype WHERE LOWER(scriptid) LIKE '%br%' OR LOWER(scriptid) LIKE '%tax%' OR LOWER(scriptid) LIKE '%fiscal%' OR LOWER(scriptid) LIKE '%brl%' OR LOWER(scriptid) LIKE '%fte%' OR LOWER(scriptid) LIKE '%cfop%' OR LOWER(scriptid) LIKE '%icms%' OR LOWER(scriptid) LIKE '%pis%' OR LOWER(scriptid) LIKE '%cofins%' OR LOWER(scriptid) LIKE '%ipi%' OR LOWER(scriptid) LIKE '%ncm%' OR LOWER(scriptid) LIKE '%cst%' ORDER BY name"
      );
      log.audit('Tax Discovery - Custom Records', `Found: ${discovery.customRecordTypes.length}`);
    } catch (e) {
      discovery.customRecordTypes = [];
      log.error('Tax Discovery - Custom Records Error', e.message);
    }

    // 2. Tax codes (salestaxitem)
    // Nota: 'rate' NAO existe em SuiteQL. Usar search.create para obter rate.
    try {
      discovery.taxCodes = [];
      var taxSearch = search.create({
        type: search.Type.SALES_TAX_ITEM,
        filters: [['isinactive', 'is', 'F']],
        columns: [
          search.createColumn({ name: 'name', sort: search.Sort.ASC }),
          search.createColumn({ name: 'rate' }),
          search.createColumn({ name: 'description' }),
        ],
      });
      taxSearch.run().each(function (r) {
        discovery.taxCodes.push({
          id: r.id,
          name: r.getValue('name') || '',
          rate: r.getValue('rate') || '',
          description: r.getValue('description') || '',
        });
        return true;
      });
      log.audit('Tax Discovery - Tax Codes', 'Found: ' + discovery.taxCodes.length);
    } catch (e) {
      discovery.taxCodes = [];
      log.error('Tax Discovery - Tax Codes Error', e.message);
    }

    // 3. Tax groups
    try {
      discovery.taxGroups = runSuiteQL(
        "SELECT id, name, description FROM taxgroup ORDER BY name"
      );
      log.audit('Tax Discovery - Tax Groups', `Found: ${discovery.taxGroups.length}`);
    } catch (e) {
      try {
        discovery.taxGroups = runSuiteQL(
          "SELECT id, name FROM taxgroup ORDER BY name"
        );
      } catch (e2) {
        discovery.taxGroups = [];
        log.error('Tax Discovery - Tax Groups Error', e2.message);
      }
    }

    // 4. Tax types
    try {
      discovery.taxTypes = runSuiteQL(
        "SELECT id, name, description FROM taxtypedef ORDER BY name"
      );
      log.audit('Tax Discovery - Tax Types', `Found: ${discovery.taxTypes.length}`);
    } catch (e) {
      // Fallback — tabela pode ter nome diferente
      try {
        discovery.taxTypes = runSuiteQL(
          "SELECT id, name FROM taxtype ORDER BY name"
        );
      } catch (e2) {
        discovery.taxTypes = [];
        log.error('Tax Discovery - Tax Types Error', e2.message);
      }
    }

    // 5. Nexus configurados
    try {
      discovery.nexus = runSuiteQL(
        "SELECT id, description, country, state FROM nexus ORDER BY country, description"
      );
      log.audit('Tax Discovery - Nexus', `Found: ${discovery.nexus.length}`);
    } catch (e) {
      discovery.nexus = [];
      log.error('Tax Discovery - Nexus Error', e.message);
    }

    // 6. Tax schedules
    try {
      discovery.taxSchedules = runSuiteQL(
        "SELECT id, name FROM taxschedule ORDER BY name"
      );
      log.audit('Tax Discovery - Tax Schedules', `Found: ${discovery.taxSchedules.length}`);
    } catch (e) {
      discovery.taxSchedules = [];
      log.error('Tax Discovery - Tax Schedules Error', e.message);
    }

    // 7. Custom fields fiscais (em itens, transacoes, entidades)
    try {
      discovery.customFields = runSuiteQL(
        "SELECT scriptid, fieldtype, label, recordtype FROM customfield WHERE LOWER(scriptid) LIKE '%br%' OR LOWER(scriptid) LIKE '%tax%' OR LOWER(scriptid) LIKE '%fiscal%' OR LOWER(scriptid) LIKE '%brl%' OR LOWER(scriptid) LIKE '%cfop%' OR LOWER(scriptid) LIKE '%icms%' OR LOWER(scriptid) LIKE '%ncm%' ORDER BY label"
      );
      log.audit('Tax Discovery - Custom Fields', `Found: ${discovery.customFields.length}`);
    } catch (e) {
      discovery.customFields = [];
      log.error('Tax Discovery - Custom Fields Error', e.message);
    }

    // 8. Subsidiaries (referencia)
    try {
      discovery.subsidiaries = runSuiteQL(
        "SELECT id, name, country FROM subsidiary WHERE isinactive = 'F' ORDER BY name"
      );
    } catch (e) {
      discovery.subsidiaries = [];
    }

    // Resumo
    discovery._summary = {
      customRecordTypes: discovery.customRecordTypes.length,
      taxCodes: discovery.taxCodes.length,
      taxGroups: discovery.taxGroups.length,
      taxTypes: discovery.taxTypes.length,
      nexus: discovery.nexus.length,
      taxSchedules: discovery.taxSchedules.length,
      customFields: discovery.customFields.length,
      subsidiaries: discovery.subsidiaries.length,
    };

    log.audit('Tax Discovery - Summary', JSON.stringify(discovery._summary));

    return discovery;
  }

  /**
   * Tax Discovery FTE — Conteudo dos registros do Fiscal Tax Engine
   */
  function getTaxDiscoveryFTE() {
    log.audit('Tax Discovery FTE', 'Consultando registros FTE');
    const fte = {};

    // 1. Regras de determinacao de impostos
    try {
      fte.taxRules = runSuiteQL(
        "SELECT id, name FROM CUSTOMRECORD_FTE_TAXRULES ORDER BY name"
      );
    } catch (e) {
      fte.taxRules = [];
      log.error('FTE taxRules', e.message);
    }

    // 2. Config de aliquotas (tax rates)
    try {
      fte.taxRates = runSuiteQL(
        "SELECT id, name FROM CUSTOMRECORD_FTE_TAXRATE ORDER BY name"
      );
    } catch (e) {
      fte.taxRates = [];
      log.error('FTE taxRates', e.message);
    }

    // 3. Regimes fiscais
    try {
      fte.taxRegimes = runSuiteQL(
        "SELECT id, name FROM CUSTOMRECORD_FTE_TAXREGIME ORDER BY name"
      );
    } catch (e) {
      fte.taxRegimes = [];
      log.error('FTE taxRegimes', e.message);
    }

    // 4. Parametros de impostos
    try {
      fte.taxParameters = runSuiteQL(
        "SELECT id, name FROM CUSTOMRECORD_FTE_TAXPARAMETER ORDER BY name"
      );
    } catch (e) {
      fte.taxParameters = [];
      log.error('FTE taxParameters', e.message);
    }

    // 5. Tipos de parametro
    try {
      fte.paramTypes = runSuiteQL(
        "SELECT id, name FROM CUSTOMRECORD_FTE_PARAMTYPE ORDER BY name"
      );
    } catch (e) {
      fte.paramTypes = [];
      log.error('FTE paramTypes', e.message);
    }

    // 6. Mapeamento fiscal
    try {
      fte.taxMappings = runSuiteQL(
        "SELECT id, name FROM CUSTOMRECORD_FTE_TAXMAPPING ORDER BY name"
      );
    } catch (e) {
      fte.taxMappings = [];
      log.error('FTE taxMappings', e.message);
    }

    // 7. Linhas de negocio
    try {
      fte.linesOfBusiness = runSuiteQL(
        "SELECT id, name FROM CUSTOMRECORD_FTE_LOB ORDER BY name"
      );
    } catch (e) {
      fte.linesOfBusiness = [];
      log.error('FTE LOB', e.message);
    }

    // 8. Codigos de item
    try {
      fte.itemCodes = runSuiteQL(
        "SELECT id, name FROM CUSTOMRECORD_FTE_ITEMCODE ORDER BY name"
      );
    } catch (e) {
      fte.itemCodes = [];
      log.error('FTE itemCodes', e.message);
    }

    // 9. CFOPs cadastrados
    try {
      fte.cfops = runSuiteQL(
        "SELECT id, name FROM CUSTOMRECORD_FTEBR_CFOP ORDER BY name"
      );
    } catch (e) {
      fte.cfops = [];
      log.error('FTE CFOPs', e.message);
    }

    // 10. Regras de determinacao de CFOP
    try {
      fte.cfopRules = runSuiteQL(
        "SELECT id, name FROM CUSTOMRECORD_BRL_CFOP_DET_RULE ORDER BY name"
      );
    } catch (e) {
      // Record pode nao existir neste ambiente, tentar variacao
      try {
        fte.cfopRules = runSuiteQL(
          "SELECT id, name FROM customrecord_ftebr_cfop_det_rule ORDER BY name"
        );
      } catch (e2) {
        fte.cfopRules = [];
      }
    }

    // 11. Naturezas de operacao
    try {
      fte.transactionNatures = runSuiteQL(
        "SELECT id, name FROM CUSTOMRECORD_BRL_TRAN_NATURE ORDER BY name"
      );
    } catch (e) {
      fte.transactionNatures = [];
      log.error('FTE Tran Natures', e.message);
    }

    // 12. CRT (Codigo Regime Tributario)
    try {
      fte.crtCodes = runSuiteQL(
        "SELECT id, name FROM CUSTOMRECORD_FTEBR_CRT ORDER BY name"
      );
    } catch (e) {
      fte.crtCodes = [];
      log.error('FTE CRT', e.message);
    }

    // 13. CEST
    try {
      fte.cestCodes = runSuiteQL(
        "SELECT id, name FROM CUSTOMRECORD_BRL_CEST ORDER BY name"
      );
    } catch (e) {
      fte.cestCodes = [];
      log.error('FTE CEST', e.message);
    }

    // 14. CNAE
    try {
      fte.cnaeCodes = runSuiteQL(
        "SELECT id, name FROM CUSTOMRECORD_BRL_CNAE ORDER BY name"
      );
    } catch (e) {
      fte.cnaeCodes = [];
      log.error('FTE CNAE', e.message);
    }

    // 15. Conta complementar
    try {
      fte.taxExpAccounts = runSuiteQL(
        "SELECT id, name FROM CUSTOMRECORD_FTEBR_TAX_EXP_ACCT ORDER BY name"
      );
    } catch (e) {
      fte.taxExpAccounts = [];
      log.error('FTE Tax Exp Accounts', e.message);
    }

    // 16. Regime fiscal especial Simples Nacional
    try {
      fte.specialTaxRegimes = runSuiteQL(
        "SELECT id, name FROM CUSTOMRECORD_FTEBR_SPECIAL_TAXREGIME ORDER BY name"
      );
    } catch (e) {
      // Record pode nao existir neste ambiente
      try {
        fte.specialTaxRegimes = runSuiteQL(
          "SELECT id, name FROM customrecord_fte_special_taxregime ORDER BY name"
        );
      } catch (e2) {
        fte.specialTaxRegimes = [];
      }
    }

    // 17. Enquadramento legal IPI
    try {
      fte.ipiLegalFraming = runSuiteQL(
        "SELECT id, name FROM CUSTOMRECORD_BRL_IPI_LEGAL_FRAMING_CODE ORDER BY name"
      );
    } catch (e) {
      fte.ipiLegalFraming = [];
      log.error('FTE IPI Legal Framing', e.message);
    }

    // 18. Mapeamento alias fiscal
    try {
      fte.taxAliasMap = runSuiteQL(
        "SELECT id, name FROM CUSTOMRECORD_BRL_TAX_ALIAS_MAP ORDER BY name"
      );
    } catch (e) {
      fte.taxAliasMap = [];
      log.error('FTE Tax Alias Map', e.message);
    }

    // 19. Reform Readiness — verifica tax codes + param types no contexto correto
    try {
      var reformTaxCodeOptions = buildFieldOptionsMap('customrecord_fte_taxrate', DET_FIELDS.taxCode);

      var missingCodes = [];

      var cbsReady = !!findOptionValue('CBS_2026_BR', reformTaxCodeOptions);
      var ibsReady = !!findOptionValue('IBS_2026_BR', reformTaxCodeOptions);
      var isReady = !!findOptionValue('IS_2026_BR', reformTaxCodeOptions);

      if (!cbsReady) missingCodes.push('CBS_2026_BR');
      if (!ibsReady) missingCodes.push('IBS_2026_BR');
      if (!isReady) missingCodes.push('IS_2026_BR');

      // Verificar param types no contexto do taxCode (campo dependente)
      var cClassTribParams = [];
      var reformParamCheck = {};

      ['CBS_2026_BR', 'IBS_2026_BR', 'IS_2026_BR'].forEach(function(tc) {
        try {
          var tcId = findOptionValue(tc, reformTaxCodeOptions);
          if (!tcId) return;

          var tmpRec = record.create({ type: 'customrecord_fte_taxrate', isDynamic: true });
          tmpRec.setValue({ fieldId: DET_FIELDS.taxCode, value: parseInt(tcId) });
          var ptField = tmpRec.getField({ fieldId: DET_FIELDS.paramType });
          if (ptField && typeof ptField.getSelectOptions === 'function') {
            var opts = ptField.getSelectOptions({ filter: '', operator: 'contains' });
            reformParamCheck[tc] = opts.length;
            for (var oi = 0; oi < opts.length && cClassTribParams.length < 20; oi++) {
              var txt = opts[oi].text || '';
              if (txt.toLowerCase().indexOf('cclasstrib') >= 0) {
                cClassTribParams.push(txt);
              }
            }
          }
        } catch (e) {
          log.error('Reform param check ' + tc, e.message);
          reformParamCheck[tc] = -1;
        }
      });

      fte.reformReadiness = {
        cbsReady: cbsReady,
        ibsReady: ibsReady,
        isReady: isReady,
        missingCodes: missingCodes,
        cClassTribParamTypes: cClassTribParams,
        reformParamCheck: reformParamCheck,
      };

      log.audit('Reform Readiness', JSON.stringify(fte.reformReadiness));
    } catch (e) {
      fte.reformReadiness = {
        cbsReady: false, ibsReady: false, isReady: false,
        missingCodes: ['CBS_2026_BR', 'IBS_2026_BR', 'IS_2026_BR'],
        error: e.message,
      };
      log.error('Reform Readiness Error', e.message);
    }

    // Resumo
    fte._summary = {};
    for (const [key, val] of Object.entries(fte)) {
      if (key !== '_summary' && key !== 'reformReadiness' && Array.isArray(val)) {
        fte._summary[key] = val.length;
      }
    }

    log.audit('Tax Discovery FTE - Summary', JSON.stringify(fte._summary));
    return fte;
  }

  // ── Customer Lookup ─────────────────────────────────────────────────────────

  function getCustomerLookup() {
    log.audit('Customer Lookup', 'Start');
    var result = {
      entityStatuses: [],
    };

    try {
      var statuses = runSuiteQL(
        "SELECT key AS id, name FROM entitystatus WHERE key > 0 ORDER BY name"
      );
      result.entityStatuses = statuses.map(function (r) {
        return { id: String(r.id), name: r.name };
      });
    } catch (e) {
      log.error('Customer Lookup - Entity Status', e.message);
    }

    log.audit('Customer Lookup Result', 'Statuses: ' + result.entityStatuses.length);
    return result;
  }

  // ── Criar Clientes ─────────────────────────────────────────────────────────

  function createCustomers(data) {
    log.audit('Create Customers', 'Start - ' + (data.customers || []).length + ' customers');

    var results = {
      success: true,
      customersCreated: 0,
      errors: [],
    };

    var customers = data.customers || [];
    var subsidiaryId = data.subsidiaryId;

    for (var i = 0; i < customers.length; i++) {
      var cust = customers[i];
      try {
        var custRec = record.create({
          type: record.Type.CUSTOMER,
          isDynamic: true,
        });

        // isPerson
        var isPerson = cust.isPerson === true || cust.isPerson === 'true';
        custRec.setValue({ fieldId: 'isperson', value: isPerson ? 'T' : 'F' });

        // Nome
        if (isPerson) {
          custRec.setValue({ fieldId: 'firstname', value: cust.firstName || '' });
          custRec.setValue({ fieldId: 'lastname', value: cust.lastName || '' });
        } else {
          custRec.setValue({ fieldId: 'companyname', value: cust.companyName || '' });
        }

        // Subsidiaria
        if (subsidiaryId) {
          custRec.setValue({ fieldId: 'subsidiary', value: parseInt(subsidiaryId) });
        }

        // Status
        if (cust.entityStatusId) {
          custRec.setValue({ fieldId: 'entitystatus', value: parseInt(cust.entityStatusId) });
        }

        // Moeda
        if (cust.currencyId) {
          custRec.setValue({ fieldId: 'currency', value: parseInt(cust.currencyId) });
        }

        // Campos opcionais
        if (cust.entityId) {
          try { custRec.setValue({ fieldId: 'entityid', value: cust.entityId }); } catch (e2) { /* auto-generated */ }
        }
        if (cust.email) {
          custRec.setValue({ fieldId: 'email', value: cust.email });
        }
        if (cust.phone) {
          custRec.setValue({ fieldId: 'phone', value: cust.phone });
        }

        // Campos fiscais Brasil
        if (cust.custentity_brl_entity_t_fed_tax_reg) {
          try {
            custRec.setValue({ fieldId: 'custentity_brl_entity_t_fed_tax_reg', value: cust.custentity_brl_entity_t_fed_tax_reg });
          } catch (e3) { log.error('Cust Field', 'fed_tax_reg: ' + e3.message); }
        }
        if (cust.custentity_brl_entity_t_state_tx_reg) {
          try {
            custRec.setValue({ fieldId: 'custentity_brl_entity_t_state_tx_reg', value: cust.custentity_brl_entity_t_state_tx_reg });
          } catch (e4) { log.error('Cust Field', 'state_tx_reg: ' + e4.message); }
        }
        if (cust.custentity_brl_entity_t_municip_tx_reg) {
          try {
            custRec.setValue({ fieldId: 'custentity_brl_entity_t_municip_tx_reg', value: cust.custentity_brl_entity_t_municip_tx_reg });
          } catch (e5) { log.error('Cust Field', 'municip_tx_reg: ' + e5.message); }
        }

        // Endereco
        if (cust.addr1 || cust.city || cust.state || cust.zip) {
          try {
            custRec.selectNewLine({ sublistId: 'addressbook' });
            custRec.setCurrentSublistValue({ sublistId: 'addressbook', fieldId: 'defaultbilling', value: true });
            custRec.setCurrentSublistValue({ sublistId: 'addressbook', fieldId: 'defaultshipping', value: true });
            custRec.setCurrentSublistValue({ sublistId: 'addressbook', fieldId: 'label', value: 'Principal' });

            var addrSubrecord = custRec.getCurrentSublistSubrecord({
              sublistId: 'addressbook',
              fieldId: 'addressbookaddress',
            });

            addrSubrecord.setValue({ fieldId: 'country', value: 'BR' });
            if (cust.addr1) addrSubrecord.setValue({ fieldId: 'addr1', value: cust.addr1 });
            if (cust.city) addrSubrecord.setValue({ fieldId: 'city', value: cust.city });
            if (cust.state) addrSubrecord.setValue({ fieldId: 'state', value: cust.state });
            if (cust.zip) addrSubrecord.setValue({ fieldId: 'zip', value: cust.zip });

            custRec.commitLine({ sublistId: 'addressbook' });
          } catch (e6) {
            log.error('Customer Address Error', (cust.companyName || 'Row ' + i) + ': ' + e6.message);
          }
        }

        var custId;
        try {
          custId = custRec.save({ enableSourcing: true, ignoreMandatoryFields: true });
        } catch (saveErr) {
          // Se falhou por validacao de cadastro federal, tenta sem o campo
          if (saveErr.message && saveErr.message.indexOf('cadastro federal') > -1) {
            log.audit('Customer Retry', 'Removendo fed_tax_reg e tentando novamente: ' + (cust.companyName || cust.firstName));
            custRec.setValue({ fieldId: 'custentity_brl_entity_t_fed_tax_reg', value: '' });
            custId = custRec.save({ enableSourcing: true, ignoreMandatoryFields: true });
            results.errors.push({
              rowIndex: cust._rowIndex || i,
              name: cust.companyName || cust.firstName || 'Row ' + i,
              error: 'Criado sem CNPJ/CPF (numero invalido): ' + (cust.custentity_brl_entity_t_fed_tax_reg || ''),
            });
          } else {
            throw saveErr;
          }
        }
        results.customersCreated++;
        log.audit('Customer Created', (cust.companyName || cust.firstName) + ' -> ' + custId);

      } catch (e) {
        results.errors.push({
          rowIndex: cust._rowIndex || i,
          name: cust.companyName || cust.firstName || 'Row ' + i,
          error: e.message,
        });
        log.error('Customer Error', (cust.companyName || 'Row ' + i) + ': ' + e.message);
      }
    }

    results.success = results.errors.length === 0;

    log.audit('Create Customers - Done', JSON.stringify({
      created: results.customersCreated,
      errors: results.errors.length,
    }));

    return results;
  }

  // ── Criar Fornecedores (Vendors) ──────────────────────────────────────────

  function createVendors(data) {
    log.audit('Create Vendors', 'Start - ' + (data.vendors || []).length + ' vendors');

    var results = {
      success: true,
      vendorsCreated: 0,
      errors: [],
    };

    var vendors = data.vendors || [];
    var subsidiaryId = data.subsidiaryId;

    for (var i = 0; i < vendors.length; i++) {
      var vend = vendors[i];
      try {
        var vendRec = record.create({
          type: record.Type.VENDOR,
          isDynamic: true,
        });

        // isPerson
        var isPerson = vend.isPerson === true || vend.isPerson === 'true';
        vendRec.setValue({ fieldId: 'isperson', value: isPerson ? 'T' : 'F' });

        // Nome
        if (isPerson) {
          vendRec.setValue({ fieldId: 'firstname', value: vend.firstName || '' });
          vendRec.setValue({ fieldId: 'lastname', value: vend.lastName || '' });
        } else {
          vendRec.setValue({ fieldId: 'companyname', value: vend.companyName || '' });
        }

        // Razao social
        if (vend.companyName) {
          try { vendRec.setValue({ fieldId: 'legalname', value: vend.companyName }); } catch (e2) { /* campo pode nao existir */ }
        }

        // Subsidiaria
        if (subsidiaryId) {
          vendRec.setValue({ fieldId: 'subsidiary', value: parseInt(subsidiaryId) });
        }

        // Moeda
        if (vend.currencyId) {
          vendRec.setValue({ fieldId: 'currency', value: parseInt(vend.currencyId) });
        }

        // Campos opcionais
        if (vend.entityId) {
          try { vendRec.setValue({ fieldId: 'entityid', value: vend.entityId }); } catch (e3) { /* auto-generated */ }
        }
        if (vend.email) {
          vendRec.setValue({ fieldId: 'email', value: vend.email });
        }
        if (vend.phone) {
          vendRec.setValue({ fieldId: 'phone', value: vend.phone });
        }

        // Campos fiscais Brasil
        if (vend.custentity_brl_entity_t_fed_tax_reg) {
          try {
            vendRec.setValue({ fieldId: 'custentity_brl_entity_t_fed_tax_reg', value: vend.custentity_brl_entity_t_fed_tax_reg });
          } catch (e4) { log.error('Vendor Field', 'fed_tax_reg: ' + e4.message); }
        }
        if (vend.custentity_brl_entity_t_state_tx_reg) {
          try {
            vendRec.setValue({ fieldId: 'custentity_brl_entity_t_state_tx_reg', value: vend.custentity_brl_entity_t_state_tx_reg });
          } catch (e5) { log.error('Vendor Field', 'state_tx_reg: ' + e5.message); }
        }
        if (vend.custentity_brl_entity_t_municip_tx_reg) {
          try {
            vendRec.setValue({ fieldId: 'custentity_brl_entity_t_municip_tx_reg', value: vend.custentity_brl_entity_t_municip_tx_reg });
          } catch (e6) { log.error('Vendor Field', 'municip_tx_reg: ' + e6.message); }
        }

        // Endereco
        if (vend.addr1 || vend.city || vend.state || vend.zip) {
          try {
            vendRec.selectNewLine({ sublistId: 'addressbook' });
            vendRec.setCurrentSublistValue({ sublistId: 'addressbook', fieldId: 'defaultbilling', value: true });
            vendRec.setCurrentSublistValue({ sublistId: 'addressbook', fieldId: 'defaultshipping', value: true });
            vendRec.setCurrentSublistValue({ sublistId: 'addressbook', fieldId: 'label', value: 'Principal' });

            var addrSubrecord = vendRec.getCurrentSublistSubrecord({
              sublistId: 'addressbook',
              fieldId: 'addressbookaddress',
            });

            addrSubrecord.setValue({ fieldId: 'country', value: 'BR' });
            if (vend.addr1) addrSubrecord.setValue({ fieldId: 'addr1', value: vend.addr1 });
            if (vend.city) addrSubrecord.setValue({ fieldId: 'city', value: vend.city });
            if (vend.state) addrSubrecord.setValue({ fieldId: 'state', value: vend.state });
            if (vend.zip) addrSubrecord.setValue({ fieldId: 'zip', value: vend.zip });

            vendRec.commitLine({ sublistId: 'addressbook' });
          } catch (e7) {
            log.error('Vendor Address Error', (vend.companyName || 'Row ' + i) + ': ' + e7.message);
          }
        }

        var vendId;
        try {
          vendId = vendRec.save({ enableSourcing: true, ignoreMandatoryFields: true });
        } catch (saveErr) {
          // Se falhou por validacao de cadastro federal, tenta sem o campo
          if (saveErr.message && saveErr.message.indexOf('cadastro federal') > -1) {
            log.audit('Vendor Retry', 'Removendo fed_tax_reg e tentando novamente: ' + (vend.companyName || vend.firstName));
            vendRec.setValue({ fieldId: 'custentity_brl_entity_t_fed_tax_reg', value: '' });
            vendId = vendRec.save({ enableSourcing: true, ignoreMandatoryFields: true });
            results.errors.push({
              rowIndex: vend._rowIndex || i,
              name: vend.companyName || vend.firstName || 'Row ' + i,
              error: 'Criado sem CNPJ/CPF (numero invalido): ' + (vend.custentity_brl_entity_t_fed_tax_reg || ''),
            });
          } else {
            throw saveErr;
          }
        }
        results.vendorsCreated++;
        log.audit('Vendor Created', (vend.companyName || vend.firstName) + ' -> ' + vendId);

      } catch (e) {
        results.errors.push({
          rowIndex: vend._rowIndex || i,
          name: vend.companyName || vend.firstName || 'Row ' + i,
          error: e.message,
        });
        log.error('Vendor Error', (vend.companyName || 'Row ' + i) + ': ' + e.message);
      }
    }

    results.success = results.errors.length === 0;

    log.audit('Create Vendors - Done', JSON.stringify({
      created: results.vendorsCreated,
      errors: results.errors.length,
    }));

    return results;
  }

  // ── Item Lookup ──────────────────────────────────────────────────────────

  function getItemLookup(subsidiaryId, itemType) {
    log.audit('Item Lookup', 'Start - subsidiaryId: ' + (subsidiaryId || 'all') + ' - itemType: ' + (itemType || 'none'));
    var result = {
      itemOrigins: [],
      ipiFramingCodes: [],
      unitsTypes: [],
      accounts: [],
      efdNatureIncomes: [],
    };

    // Origens do item
    try {
      var origins = runSuiteQL("SELECT id, name FROM customlist_brl_item_origin ORDER BY id");
      result.itemOrigins = origins.map(function (r) { return { id: String(r.id), name: r.name }; });
    } catch (e) {
      log.error('Item Origins Error', e.message);
    }

    // Enquadramento legal IPI
    try {
      var ipi = runSuiteQL("SELECT id, name FROM customrecord_brl_ipi_legal_framing_code ORDER BY name");
      result.ipiFramingCodes = ipi.map(function (r) { return { id: String(r.id), name: r.name }; });
    } catch (e) {
      log.error('IPI Framing Error', e.message);
    }

    // Unidades de estoque (com referencia ao tipo pai)
    // NOTA: runSuiteQL engole erros e retorna [] — nao lanca excecao.
    // Por isso o fallback verifica .length === 0 em vez de try/catch.
    try {
      var units = runSuiteQL("SELECT internalid, unitname, abbreviation, conversionrate, unitstype FROM unitsTypeUom ORDER BY unitname");
      log.debug('Units with unitstype column', 'Found: ' + units.length);

      // Se a query com unitstype retornou vazio, tentar sem essa coluna
      if (units.length === 0) {
        log.debug('Units with unitstype vazio, tentando sem coluna unitstype');
        units = runSuiteQL("SELECT internalid, unitname, abbreviation, conversionrate FROM unitsTypeUom ORDER BY unitname");
        log.debug('Units without unitstype column', 'Found: ' + units.length);
      }

      result.unitsTypes = units.map(function (r) {
        return {
          id: String(r.internalid),
          unitname: r.unitname,
          abbreviation: r.abbreviation || '',
          conversionrate: r.conversionrate,
          typeId: r.unitstype ? String(r.unitstype) : '',
        };
      });
    } catch (e) {
      log.error('Units Error', e.message);
    }

    // Contas contabeis (filtradas por subsidiaria quando informada)
    // NOTA: runSuiteQL engole erros e retorna [] — nao lanca excecao.
    // Por isso o fallback verifica accounts.length === 0 em vez de try/catch.
    // IMPORTANTE: O campo 'acctname' NAO existe em SuiteQL. Usar 'fullName' para o nome da conta.
    try {
      var accounts = [];

      if (subsidiaryId) {
        // Tentativa 1: filtrar via accountSubsidiaryMap
        accounts = runSuiteQL(
          "SELECT DISTINCT a.id, a.acctNumber, a.fullName, a.acctType " +
          "FROM account a " +
          "INNER JOIN accountSubsidiaryMap asm ON asm.account = a.id " +
          "WHERE a.isInactive = 'F' " +
          "AND asm.subsidiary = " + parseInt(subsidiaryId) + " " +
          "ORDER BY a.acctNumber"
        );
        log.debug('Accounts via accountSubsidiaryMap', 'Found: ' + accounts.length);

        // Tentativa 2: filtrar pelo campo subsidiary direto na account
        if (accounts.length === 0) {
          log.debug('accountSubsidiaryMap vazio, tentando campo subsidiary direto');
          accounts = runSuiteQL(
            "SELECT id, acctNumber, fullName, acctType FROM account " +
            "WHERE isInactive = 'F' AND subsidiary = " + parseInt(subsidiaryId) + " " +
            "ORDER BY acctNumber"
          );
          log.debug('Accounts via subsidiary field', 'Found: ' + accounts.length);
        }
      }

      // SEM fallback para todas as contas — so retornar contas da subsidiary.
      // Usar contas de outras subsidiarias causa erro no NetSuite.
      // Se nenhuma conta for encontrada, suggestedAccounts cobre o fallback.
      if (accounts.length === 0 && subsidiaryId) {
        log.audit('Accounts Warning', 'Nenhuma conta encontrada para subsidiary ' + subsidiaryId + '. suggestedAccounts sera usado como fallback.');
      }

      result.accounts = accounts.map(function (r) {
        return {
          id: String(r.id),
          acctNumber: r.acctnumber || '',
          acctName: r.fullname || '',
          acctType: r.accttype || '',
        };
      });
    } catch (e) {
      log.error('Accounts Error', e.message);
    }

    // NCM — custitem_fte_item_l_itemcode (FTE Item Codes)
    try {
      var ncmItems = runSuiteQL("SELECT id, name FROM customrecord_fte_itemcode ORDER BY name");
      result.ncmCodes = ncmItems.map(function (r) { return { id: String(r.id), name: r.name || '' }; });
    } catch (e) {
      log.error('NCM Codes Error', e.message);
      result.ncmCodes = [];
    }

    // CEST — custitem_brl_l_cest_code
    try {
      var cestItems = runSuiteQL("SELECT id, name FROM customrecord_brl_cest ORDER BY name");
      result.cestCodes = cestItems.map(function (r) { return { id: String(r.id), name: r.name || '' }; });
    } catch (e) {
      log.error('CEST Codes Error', e.message);
      result.cestCodes = [];
    }

    // SPED EFD Type — custitem_brr_l_sped_efd_type
    try {
      var spedItems = runSuiteQL("SELECT id, name FROM customrecord_brr_spedefd_item_type ORDER BY name");
      result.spedEfdTypes = spedItems.map(function (r) { return { id: String(r.id), name: r.name || '' }; });
    } catch (e) {
      log.error('SPED EFD Types Error', e.message);
      result.spedEfdTypes = [];
    }

    // ── Contas padrao da subsidiary (campos de preferencia) ──────────────
    // Os campos ASSETACCOUNT, COGSACCOUNT, INCOMEACCOUNT, etc. existem no
    // registro da subsidiary como preferencias contabeis. Nao sao expostos
    // via SuiteQL/REST, mas sao acessiveis via N/record getValue().
    result.suggestedAccounts = {};
    if (subsidiaryId) {
      try {
        var subRec = record.load({
          type: record.Type.SUBSIDIARY,
          id: parseInt(subsidiaryId),
          isDynamic: false,
        });

        // Tentar lowercase primeiro (padrao SS2.x), depois UPPERCASE como fallback
        var defaultAcctFields = {
          incomeAccountId: 'incomeaccount',
          expenseAccountId: 'expenseaccount',
          assetAccountId: 'assetaccount',
          cogsAccountId: 'cogsaccount',
          gainLossAccountId: 'gainlossaccount',
          cancelSalesAccountId: 'salesdiscacct',
          purchaseDiscountAccountId: 'purchdiscacct',
          vendorReturnVarianceAccountId: 'vendreturnvarianceaccount',
          invCostRevalAdjustmentAccountId: 'invcostrevaladjustmentacct',
          invCountAccountId: 'invcountaccount',
        };

        for (var key in defaultAcctFields) {
          if (defaultAcctFields.hasOwnProperty(key)) {
            var val = null;
            // Tentar lowercase
            try {
              val = subRec.getValue({ fieldId: defaultAcctFields[key] });
            } catch (fieldErr) {
              // Ignorar — tentar uppercase
            }
            // Fallback: tentar UPPERCASE
            if (!val) {
              try {
                val = subRec.getValue({ fieldId: defaultAcctFields[key].toUpperCase() });
              } catch (fieldErr2) {
                // Campo nao existe neste ambiente
              }
            }
            if (val) {
              result.suggestedAccounts[key] = String(val);
              log.debug('Default Account', defaultAcctFields[key] + ' = ' + val);
            }
          }
        }

        log.audit('Suggested Accounts from Subsidiary', JSON.stringify(result.suggestedAccounts));
      } catch (e) {
        log.error('Suggested Accounts Error', e.message);
      }
    }

    // Se nao conseguiu da subsidiary, tentar via itemAccountMapping (search)
    if (Object.keys(result.suggestedAccounts).length === 0 && subsidiaryId) {
      try {
        var iamSearch = search.create({
          type: 'itemaccountmapping',
          filters: [
            ['subsidiary', 'anyof', parseInt(subsidiaryId)]
          ],
          columns: [
            search.createColumn({ name: 'itemaccount' }),
            search.createColumn({ name: 'destinationaccount' })
          ]
        });

        var iamFieldMap = {
          'INCOME': 'incomeAccountId',
          'EXPENSE': 'expenseAccountId',
          'ASSET': 'assetAccountId',
          'COGS': 'cogsAccountId',
          'GAINLOSS': 'gainLossAccountId',
          'DISCOUNT': 'cancelSalesAccountId',
        };

        iamSearch.run().each(function (r) {
          var itemAcct = r.getValue('itemaccount');
          var destAcct = r.getValue('destinationaccount');
          if (itemAcct && destAcct && iamFieldMap[itemAcct]) {
            result.suggestedAccounts[iamFieldMap[itemAcct]] = String(destAcct);
          }
          return true; // continuar iterando
        });

        log.audit('Suggested Accounts from ItemAccountMapping', JSON.stringify(result.suggestedAccounts));
      } catch (e) {
        log.debug('ItemAccountMapping Search', 'Not available: ' + e.message);
      }
    }

    log.audit('Item Lookup Result', 'Origins: ' + result.itemOrigins.length +
      ', IPI: ' + result.ipiFramingCodes.length +
      ', Units: ' + result.unitsTypes.length +
      ', Accounts: ' + result.accounts.length +
      ', Employees: ' + (result.employees || []).length +
      ', SuggestedAccts: ' + Object.keys(result.suggestedAccounts).length);

    // Costing Methods — ler opcoes reais do campo costingmethod via getSelectOptions
    result.costingMethods = [];
    try {
      var tmpRec = record.create({ type: 'inventoryitem', isDynamic: true });
      var cmField = tmpRec.getField({ fieldId: 'costingmethod' });
      if (cmField && typeof cmField.getSelectOptions === 'function') {
        var cmOptions = cmField.getSelectOptions({ filter: '', operator: 'contains' });
        result.costingMethods = cmOptions
          .filter(function (opt) { return opt.value; })
          .map(function (opt) { return { id: String(opt.value), name: opt.text }; });
      }
      log.audit('Costing Methods', 'Found ' + result.costingMethods.length + ' options: ' +
        result.costingMethods.map(function (m) { return m.id + '=' + m.name; }).join(', '));
    } catch (e) {
      log.error('Costing Methods Error', e.message);
    }

    // EFD REINF — Natureza do Rendimento (so para tipos de servico)
    var SERVICE_ITEM_TYPES = {
      'serviceitem': true, 'servicepurchaseitem': true, 'serviceresaleitem': true
    };
    if (itemType && SERVICE_ITEM_TYPES[itemType]) {
      try {
        var tmpReinfRec = record.create({ type: itemType, isDynamic: true });
        var reinfField = tmpReinfRec.getField({ fieldId: 'custitem_brr_l_efd_nature_income' });
        if (reinfField && typeof reinfField.getSelectOptions === 'function') {
          var reinfOpts = reinfField.getSelectOptions({ filter: '', operator: 'contains' });
          result.efdNatureIncomes = reinfOpts
            .filter(function (opt) { return opt.value; })
            .map(function (opt) { return { id: String(opt.value), name: opt.text }; });
        }
        log.audit('EFD Nature Incomes', 'Found: ' + result.efdNatureIncomes.length);
      } catch (e) {
        log.error('EFD Nature Income Lookup Error', e.message);
      }
    }

    return result;
  }

  // ── NCM Search ──────────────────────────────────────────────────────────

  function searchNCM(queryText) {
    try {
      var escaped = queryText.replace(/'/g, "''");
      var sql = "SELECT id, name FROM customrecord_fte_itemcode WHERE LOWER(name) LIKE '%" +
        escaped.toLowerCase() + "%' AND ROWNUM <= 20 ORDER BY name";
      var results = runSuiteQL(sql);
      return {
        results: results.map(function (r) { return { id: String(r.id), name: r.name }; }),
      };
    } catch (e) {
      log.error('NCM Search Error', e.message);
      return { results: [] };
    }
  }

  // ── Batch NCM Search ────────────────────────────────────────────────────

  function batchSearchNCM(codes) {
    log.audit('Batch NCM Search', 'Codes: ' + codes.length);
    var resultMap = {};

    // Processar em batches de 20 para evitar queries muito longas
    var batchSize = 20;
    for (var b = 0; b < codes.length; b += batchSize) {
      var batch = codes.slice(b, b + batchSize);
      var conditions = batch.map(function (code) {
        var escaped = code.replace(/'/g, "''").replace(/\./g, '');
        var formatted = escaped;
        // Tentar formato XX.XX.XX.XX se o codigo vier sem pontos
        if (escaped.length >= 8 && escaped.indexOf('.') === -1) {
          formatted = escaped.substring(0, 4) + '.' + escaped.substring(4, 6) + '.' + escaped.substring(6, 8);
        }
        return "LOWER(name) LIKE '%" + escaped.toLowerCase() + "%' OR LOWER(name) LIKE '%" + formatted.toLowerCase() + "%'";
      });

      try {
        var sql = "SELECT id, name FROM customrecord_fte_itemcode WHERE (" +
          conditions.join(' OR ') + ") AND ROWNUM <= " + (batch.length * 2);
        var results = runSuiteQL(sql);

        // Mapear resultados para cada codigo do batch
        for (var c = 0; c < batch.length; c++) {
          var code = batch[c];
          var codeDigits = code.replace(/\./g, '');
          var match = null;

          for (var r = 0; r < results.length; r++) {
            var recName = (results[r].name || '').toLowerCase();
            var recCode = recName.split(' - ')[0].replace(/\./g, '').trim();
            if (recCode === codeDigits || recName.indexOf(code.toLowerCase()) > -1) {
              match = { id: String(results[r].id), name: results[r].name };
              break;
            }
          }

          if (match) {
            resultMap[code] = match;
            resultMap[codeDigits] = match;
          }
        }
      } catch (e) {
        log.error('Batch NCM Search Error', 'Batch ' + b + ': ' + e.message);
      }
    }

    log.audit('Batch NCM Search Done', 'Found: ' + Object.keys(resultMap).length + ' matches');
    return { results: resultMap };
  }

  // ── Criar Itens ─────────────────────────────────────────────────────────

  function createItems(data) {
    // Fix 1: Proteger contra data null/undefined
    data = data || {};

    var VALID_ITEM_TYPES = {
      'inventoryitem': true,
      'noninventorysaleitem': true,
      'noninventorypurchaseitem': true,
      'noninventoryresaleitem': true,
      'serviceitem': true,
      'servicepurchaseitem': true,
      'serviceresaleitem': true,
    };

    var results = {
      success: false,
      itemsCreated: 0,
      created: [],
      errors: [],
      scriptVersion: 'v17-service-items-reinf-2026-03-01',
    };

    var items = data.items || [];
    var itemType = data.itemType;
    var subsidiaryId = data.subsidiaryId;
    var globalConfig = data.globalConfig || {};

    // Validacoes de entrada
    if (!items.length) {
      results.errors.push({ name: 'Validacao', error: 'Nenhum item recebido' });
      return results;
    }
    if (!itemType || !VALID_ITEM_TYPES[itemType]) {
      results.errors.push({ name: 'Validacao', error: 'Tipo de item invalido: ' + (itemType || 'vazio') + '. Validos: ' + Object.keys(VALID_ITEM_TYPES).join(', ') });
      return results;
    }

    // Fix: Validar subsidiaryId como numero
    var subIdNum = parseInt(subsidiaryId, 10);
    if (!subsidiaryId || isNaN(subIdNum) || subIdNum <= 0) {
      results.errors.push({ name: 'Validacao', error: 'Subsidiary invalida: ' + subsidiaryId });
      return results;
    }

    // Type flags — determinam quais campos se aplicam
    var isInventory = itemType === 'inventoryitem';
    var isSaleOnly = ['noninventorysaleitem', 'serviceitem'].indexOf(itemType) > -1;
    var isPurchaseOnly = ['noninventorypurchaseitem', 'servicepurchaseitem'].indexOf(itemType) > -1;
    var isResale = ['noninventoryresaleitem', 'serviceresaleitem'].indexOf(itemType) > -1;
    var isService = ['serviceitem', 'servicepurchaseitem', 'serviceresaleitem'].indexOf(itemType) > -1;

    // Ler opcoes validas de costingmethod (so para inventoryitem)
    var validCostingMap = {};
    var costingOptionsList = [];
    if (isInventory) {
      try {
        var tmpRec = record.create({ type: 'inventoryitem', isDynamic: true });
        var cmField = tmpRec.getField({ fieldId: 'costingmethod' });
        if (cmField && typeof cmField.getSelectOptions === 'function') {
          var cmOpts = cmField.getSelectOptions({ filter: '', operator: 'contains' });
          for (var ci = 0; ci < cmOpts.length; ci++) {
            var optVal = cmOpts[ci].value;
            var optText = cmOpts[ci].text;
            if (!optVal) continue;
            costingOptionsList.push({ value: optVal, text: optText || '' });
            validCostingMap[optVal] = optVal;
            validCostingMap[optVal.toUpperCase()] = optVal;
            validCostingMap[optVal.toLowerCase()] = optVal;
            if (optText) {
              validCostingMap[optText.toUpperCase()] = optVal;
              validCostingMap[optText.toLowerCase()] = optVal;
            }
          }
          log.audit('Costing Options', cmOpts.length + ' opcoes: ' +
            cmOpts.map(function(o) { return o.value + '=' + o.text; }).join(', '));
        } else {
          log.audit('Costing Options', 'Campo costingmethod nao tem getSelectOptions');
        }
      } catch (cmErr) {
        log.error('Costing Discovery Error', cmErr.message);
      }
    }

    var COSTING_KEYWORDS = {
      'AVG': ['media', 'média', 'average', 'avg'],
      'MEDIA': ['media', 'média', 'average', 'avg'],
      'AVERAGE': ['media', 'média', 'average', 'avg'],
      'FIFO': ['peps', 'fifo', 'primeiro'],
      'PEPS': ['peps', 'fifo', 'primeiro'],
      'LIFO': ['ueps', 'lifo', 'ultimo', 'último'],
      'UEPS': ['ueps', 'lifo', 'ultimo', 'último'],
      'STANDARD': ['padrao', 'padrão', 'standard', 'padr'],
      'PADRAO': ['padrao', 'padrão', 'standard', 'padr'],
      'GROUPAVG': ['grupo', 'group'],
    };

    /**
     * Resolve costingmethod. Nunca retorna null — se nao achar match,
     * retorna o input original e deixa rec.setValue decidir.
     */
    function resolveCostingMethod(input) {
      if (!input) return null;
      var val = String(input).trim();
      var upper = val.toUpperCase();
      var lower = val.toLowerCase();

      // 1. Match direto no validCostingMap
      if (validCostingMap[val]) return validCostingMap[val];
      if (validCostingMap[upper]) return validCostingMap[upper];
      if (validCostingMap[lower]) return validCostingMap[lower];
      if (validCostingMap['_' + lower]) return validCostingMap['_' + lower];

      // 2. Match por keyword no texto das opcoes reais
      var keywords = COSTING_KEYWORDS[upper];
      if (keywords && costingOptionsList.length > 0) {
        for (var oi = 0; oi < costingOptionsList.length; oi++) {
          var optText = (costingOptionsList[oi].text || '').toLowerCase();
          var optVal = (costingOptionsList[oi].value || '').toLowerCase();
          for (var ki = 0; ki < keywords.length; ki++) {
            if (optText.indexOf(keywords[ki]) > -1 || optVal.indexOf(keywords[ki]) > -1) {
              log.debug('Costing Resolved', input + ' -> ' + costingOptionsList[oi].value + ' (keyword "' + keywords[ki] + '" in "' + costingOptionsList[oi].text + '")');
              return costingOptionsList[oi].value;
            }
          }
        }
      }

      // 3. Fallback: retornar input original — rec.setValue decide se aceita
      log.audit('Costing Passthrough', '"' + input + '" sem match, tentando direto. Options: ' +
        costingOptionsList.map(function(o) { return o.value + '=' + o.text; }).join(', '));
      return val;
    }

    log.audit('createItems Start', 'Type: ' + itemType + ' | Subsidiary: ' + subIdNum + ' | Items: ' + items.length +
      ' | ValidCostingKeys: ' + Object.keys(validCostingMap).join(','));

    // --- Batch query para duplicidade ---
    var allItemBaseIds = [];
    var seenBase = {};
    for (var pi = 0; pi < items.length; pi++) {
      if (items[pi].itemId) {
        var pBaseId = String(items[pi].itemId).substring(0, 50).toLowerCase();
        if (!seenBase[pBaseId]) {
          seenBase[pBaseId] = true;
          allItemBaseIds.push(String(items[pi].itemId).substring(0, 50));
        }
      }
    }

    var existingItemsCache = {};
    if (allItemBaseIds.length > 0) {
      for (var chunk = 0; chunk < allItemBaseIds.length; chunk += 20) {
        var batch = allItemBaseIds.slice(chunk, chunk + 20);
        // Fix: Sanitizar para SuiteQL — escapar aspas simples
        var conditions = batch.map(function(b) {
          var safe = b.replace(/'/g, "''");
          return "LOWER(itemid) LIKE '" + safe.toLowerCase() + "%'";
        }).join(' OR ');
        try {
          var batchResults = runSuiteQL("SELECT itemid FROM item WHERE " + conditions);
          for (var bi = 0; bi < batchResults.length; bi++) {
            var eid = (batchResults[bi].itemid || '').toLowerCase();
            existingItemsCache[eid] = true;
          }
        } catch (bqErr) {
          log.error('Batch duplicate query error', bqErr.message);
        }
      }
      log.debug('Duplicate Cache', 'Loaded ' + Object.keys(existingItemsCache).length + ' existing item names');
    }

    // Helper para validar parseInt de IDs de conta
    function safeParseInt(val, fieldName) {
      if (!val) return null;
      var n = parseInt(val, 10);
      if (isNaN(n) || n <= 0) {
        log.error('Invalid ID', fieldName + ': "' + val + '" nao e um ID numerico valido');
        return null;
      }
      return n;
    }

    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      try {
        var savedName = item.itemId ? String(item.itemId).substring(0, 60) : 'Item ' + (i + 1);

        // Dedup
        if (existingItemsCache[savedName.toLowerCase()]) {
          var maxSuffix = 1;
          for (var cachedId in existingItemsCache) {
            if (existingItemsCache.hasOwnProperty(cachedId) && cachedId.indexOf(savedName.toLowerCase()) === 0) {
              var suffixPart = cachedId.substring(savedName.length).trim();
              var num = parseInt(suffixPart, 10);
              if (!isNaN(num) && num >= maxSuffix) { maxSuffix = num + 1; }
            }
          }
          var suffixText = ' ' + maxSuffix;
          savedName = savedName.substring(0, 60 - suffixText.length) + suffixText;
        }
        existingItemsCache[savedName.toLowerCase()] = true;

        var rec = record.create({ type: itemType, isDynamic: true });

        // 1. itemid
        rec.setValue({ fieldId: 'itemid', value: savedName });

        // 2. subsidiary + includechildren (visivel em todas as filhas)
        rec.setValue({ fieldId: 'subsidiary', value: [subIdNum] });
        rec.setValue({ fieldId: 'includechildren', value: true });

        // 3. Contas contabeis — condicionadas pelo tipo de item
        var acctWarnings = [];

        // incomeaccount — quem vende (inventory, sale, resale)
        if (isInventory || isSaleOnly || isResale) {
          var incomeAcctId = safeParseInt(item.incomeAccountId || globalConfig.incomeAccountId, 'incomeaccount');
          if (incomeAcctId) {
            try { rec.setValue({ fieldId: 'incomeaccount', value: incomeAcctId }); }
            catch (ae) { acctWarnings.push('income(' + incomeAcctId + '): ' + ae.message); }
          }
        }

        // assetaccount — so estoque
        if (isInventory) {
          var assetAcctId = safeParseInt(item.assetAccountId || globalConfig.assetAccountId, 'assetaccount');
          if (assetAcctId) {
            try { rec.setValue({ fieldId: 'assetaccount', value: assetAcctId }); }
            catch (ae) { acctWarnings.push('asset(' + assetAcctId + '): ' + ae.message); }
          }
        }

        // cogsaccount — so estoque
        if (isInventory) {
          var cogsAcctId = safeParseInt(item.cogsAccountId || globalConfig.cogsAccountId, 'cogsaccount');
          if (cogsAcctId) {
            try { rec.setValue({ fieldId: 'cogsaccount', value: cogsAcctId }); }
            catch (ae) { acctWarnings.push('cogs(' + cogsAcctId + '): ' + ae.message); }
          }
        }

        // expenseaccount — quem compra (purchase, resale)
        if (isPurchaseOnly || isResale) {
          var expenseAcctId = safeParseInt(item.expenseAccountId || globalConfig.expenseAccountId, 'expenseaccount');
          if (expenseAcctId) {
            try { rec.setValue({ fieldId: 'expenseaccount', value: expenseAcctId }); }
            catch (ae) { acctWarnings.push('expense(' + expenseAcctId + '): ' + ae.message); }
          }
        }

        // 4. displayname (pode repetir, diferente do itemid que e unico)
        if (item.displayName) {
          try { rec.setValue({ fieldId: 'displayname', value: String(item.displayName).substring(0, 200) }); }
          catch (ae) { acctWarnings.push('displayname: ' + ae.message); }
        }

        // 5. costingMethod — so estoque
        if (isInventory) {
          var costingInput = item.costingMethod || globalConfig.costingMethod;
          if (costingInput) {
            var resolvedCM = resolveCostingMethod(costingInput);
            if (resolvedCM) {
              try { rec.setValue({ fieldId: 'costingmethod', value: resolvedCM }); }
              catch (ae) { acctWarnings.push('costing(' + resolvedCM + ' from ' + costingInput + '): ' + ae.message); }
            }
          }
        }

        // 6. Campos fiscais por item
        var ncmId = safeParseInt(item.ncmCodeId, 'custitem_fte_item_l_itemcode');
        var cestId = safeParseInt(item.cestCodeId, 'custitem_brl_l_cest_code');
        var originId = safeParseInt(item.itemOriginId, 'custitem_brl_l_item_origin');
        var ipiId = safeParseInt(item.ipiFramingCodeId, 'custitem_brl_l_ipi_legal_framing_code');

        if (ncmId) {
          try { rec.setValue({ fieldId: 'custitem_fte_item_l_itemcode', value: ncmId }); }
          catch (ae) { acctWarnings.push('ncm(' + ncmId + '): ' + ae.message); }
        }
        if (cestId) {
          try { rec.setValue({ fieldId: 'custitem_brl_l_cest_code', value: cestId }); }
          catch (ae) { acctWarnings.push('cest(' + cestId + '): ' + ae.message); }
        }
        if (originId) {
          try { rec.setValue({ fieldId: 'custitem_brl_l_item_origin', value: originId }); }
          catch (ae) { acctWarnings.push('origem(' + originId + '): ' + ae.message); }
        }
        if (ipiId) {
          try { rec.setValue({ fieldId: 'custitem_brl_l_ipi_legal_framing_code', value: ipiId }); }
          catch (ae) { acctWarnings.push('ipi(' + ipiId + '): ' + ae.message); }
        }
        var spedEfdTypeId = safeParseInt(item.spedEfdTypeId, 'custitem_brr_l_sped_efd_type');
        if (spedEfdTypeId) {
          try { rec.setValue({ fieldId: 'custitem_brr_l_sped_efd_type', value: spedEfdTypeId }); }
          catch (ae) { acctWarnings.push('spedEfd(' + spedEfdTypeId + '): ' + ae.message); }
        }

        // EFD REINF — Natureza do Rendimento (so servico)
        if (isService) {
          var efdNatureIncomeId = safeParseInt(
            item.efdNatureIncomeId || globalConfig.efdNatureIncomeId,
            'custitem_brr_l_efd_nature_income'
          );
          if (efdNatureIncomeId) {
            try { rec.setValue({ fieldId: 'custitem_brr_l_efd_nature_income', value: efdNatureIncomeId }); }
            catch (ae) { acctWarnings.push('reinfNature(' + efdNatureIncomeId + '): ' + ae.message); }
          }
        }

        if (acctWarnings.length > 0) {
          log.error('Account warnings for ' + savedName, acctWarnings.join(' | '));
        }

        var internalId = rec.save({ enableSourcing: true, ignoreMandatoryFields: true });
        log.audit('Item Created', 'ID: ' + internalId + ' | ' + savedName);

        results.itemsCreated++;
        results.created.push({
          id: String(internalId),
          name: savedName,
          type: itemType,
          subsidiaryId: String(subIdNum),
          warnings: acctWarnings.length > 0 ? acctWarnings : undefined,
        });

      } catch (e) {
        log.error('Create Item Error', 'Item ' + (i + 1) + ' (' + (item.itemId || '?') + '): ' + e.message);
        results.errors.push({
          name: item.itemId || 'Item ' + (i + 1),
          error: (e.name ? '[' + e.name + '] ' : '') + e.message,
        });
      }
    }

    // Fix 4: success = true SOMENTE se zero erros
    results.success = results.errors.length === 0 && results.itemsCreated > 0;

    log.audit('Create Items - Done', 'Created: ' + results.itemsCreated + ' | Errors: ' + results.errors.length + ' | Success: ' + results.success);

    return results;
  }

  // ── Definir Saldos Iniciais via Journal Entry ──────────────────────────────

  /**
   * Cria um Journal Entry para definir saldos iniciais em contas existentes.
   *
   * O campo openingBalance no registro account e somente-leitura apos criacao
   * (tanto REST API quanto SuiteScript sao bloqueados). A forma correta para
   * contas ja existentes e criar um Journal Entry contra a conta "Saldo Inicial"
   * (Opening Balance Equity).
   *
   * Logica de debito/credito:
   * - Cada balance tem debit OU credit (nunca ambos)
   * - A contrapartida vai para a conta Opening Balance Equity
   * - Se a conta tem debit, a linha do JE e debit; contrapartida e credit
   * - Se a conta tem credit, a linha do JE e credit; contrapartida e debit
   *
   * @param {Object} requestBody
   * @param {Array<{accountId: string, debit: number, credit: number}>} requestBody.balances
   * @param {string} requestBody.tranDate - Data do saldo inicial (YYYY-MM-DD)
   * @param {string} requestBody.subsidiaryId - ID da subsidiary
   * @param {string} [requestBody.openingBalanceEquityAccountId] - ID da conta de contrapartida
   * @returns {Object} { success, journalEntryId, linesCreated, errors }
   */
  function setOpeningBalances(requestBody) {
    var balances = requestBody.balances || [];
    var tranDateStr = requestBody.tranDate;
    var subsidiaryId = requestBody.subsidiaryId;
    var equityAccountId = requestBody.openingBalanceEquityAccountId;

    log.audit('Set Opening Balances', 'Accounts: ' + balances.length +
      ' | Date: ' + tranDateStr + ' | Subsidiary: ' + subsidiaryId +
      ' | EquityAcct: ' + (equityAccountId || 'auto-detect'));

    var results = {
      success: false,
      journalEntryId: null,
      linesCreated: 0,
      errors: [],
    };

    // Validacoes
    if (balances.length === 0) {
      results.errors.push({ error: 'Nenhum saldo recebido' });
      return results;
    }
    if (!subsidiaryId) {
      results.errors.push({ error: 'subsidiaryId obrigatorio' });
      return results;
    }
    if (!tranDateStr) {
      results.errors.push({ error: 'tranDate obrigatorio' });
      return results;
    }

    // Auto-detectar conta Opening Balance Equity se nao informada
    if (!equityAccountId) {
      try {
        var equityRows = runSuiteQL(
          "SELECT a.id FROM account a " +
          "INNER JOIN accountSubsidiaryMap asm ON asm.account = a.id " +
          "WHERE asm.subsidiary = " + parseInt(subsidiaryId, 10) + " " +
          "AND a.accttype = 'Equity' " +
          "AND (LOWER(a.accountsearchdisplayname) LIKE '%saldo inicial%' " +
          "  OR LOWER(a.accountsearchdisplayname) LIKE '%opening balance%' " +
          "  OR LOWER(a.fullname) LIKE '%saldo inicial%') " +
          "AND a.issummary = 'F' " +
          "ORDER BY a.acctnumber"
        );
        if (equityRows.length > 0) {
          equityAccountId = String(equityRows[0].id);
          log.audit('Opening Balance Equity Auto-detected', 'Account ID: ' + equityAccountId);
        }
      } catch (e) {
        log.error('Equity Account Search Error', e.message);
      }

      if (!equityAccountId) {
        results.errors.push({ error: 'Conta "Saldo Inicial" (Opening Balance Equity) nao encontrada na subsidiary ' + subsidiaryId + '. Crie uma conta Equity com nome contendo "Saldo Inicial".' });
        return results;
      }
    }

    // Parsear data
    var tranDate;
    try {
      var parts = tranDateStr.split('-');
      tranDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    } catch (e) {
      results.errors.push({ error: 'Data invalida: ' + tranDateStr });
      return results;
    }

    try {
      // Criar Journal Entry
      var je = record.create({
        type: record.Type.JOURNAL_ENTRY,
        isDynamic: true,
      });

      je.setValue({ fieldId: 'subsidiary', value: parseInt(subsidiaryId, 10) });
      je.setValue({ fieldId: 'trandate', value: tranDate });
      je.setValue({ fieldId: 'memo', value: 'Saldos Iniciais - Importacao automatica' });
      je.setValue({ fieldId: 'approved', value: true });

      var lineIndex = 0;
      var equityDebitTotal = 0;
      var equityCreditTotal = 0;

      for (var i = 0; i < balances.length; i++) {
        var entry = balances[i];
        if (!entry.accountId) {
          results.errors.push({ index: i, accountId: 'N/A', error: 'accountId ausente' });
          continue;
        }

        var debit = parseFloat(entry.debit) || 0;
        var credit = parseFloat(entry.credit) || 0;
        if (debit === 0 && credit === 0) continue;

        try {
          // Linha da conta
          je.selectNewLine({ sublistId: 'line' });
          je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: parseInt(entry.accountId, 10) });
          if (debit > 0) {
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: debit });
            equityCreditTotal += debit;
          } else {
            je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: credit });
            equityDebitTotal += credit;
          }
          je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: 'Saldo Inicial' });
          je.commitLine({ sublistId: 'line' });
          lineIndex++;
          results.linesCreated++;
        } catch (e) {
          results.errors.push({ index: i, accountId: entry.accountId, error: e.message });
          log.error('JE Line Error', 'Account ' + entry.accountId + ': ' + e.message);
        }
      }

      // Linha(s) de contrapartida — Opening Balance Equity
      if (equityCreditTotal > 0) {
        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: parseInt(equityAccountId, 10) });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'credit', value: Math.round(equityCreditTotal * 100) / 100 });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: 'Contrapartida Saldo Inicial (Debitos)' });
        je.commitLine({ sublistId: 'line' });
      }
      if (equityDebitTotal > 0) {
        je.selectNewLine({ sublistId: 'line' });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'account', value: parseInt(equityAccountId, 10) });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'debit', value: Math.round(equityDebitTotal * 100) / 100 });
        je.setCurrentSublistValue({ sublistId: 'line', fieldId: 'memo', value: 'Contrapartida Saldo Inicial (Creditos)' });
        je.commitLine({ sublistId: 'line' });
      }

      var jeId = je.save({ enableSourcing: true, ignoreMandatoryFields: true });
      results.journalEntryId = String(jeId);
      results.success = true;
      results.updated = results.linesCreated;

      log.audit('Opening Balance JE Created', 'ID: ' + jeId + ' | Lines: ' + results.linesCreated +
        ' | EquityDebit: ' + equityDebitTotal + ' | EquityCredit: ' + equityCreditTotal);

    } catch (e) {
      log.error('Opening Balance JE Error', e.message);
      results.errors.push({ error: 'Erro ao criar Journal Entry: ' + e.message });
    }

    return results;
  }

  return { get, post };
});
