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
   */
  function get(requestParams) {
    log.audit('GET Lookup Data', JSON.stringify(requestParams));

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
      const subs = runSuiteQL("SELECT id, name FROM subsidiary ORDER BY name");
      if (subs.length > 0) {
        result.subsidiaries = subs.map((r) => ({ id: String(r.id), name: r.name }));
      } else {
        // Fallback com search
        const s = searchRecords(search.Type.SUBSIDIARY, ['internalid', 'name']);
        result.subsidiaries = s.map((r) => ({ id: String(r.id), name: r.name }));
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
        try {
          const stateField = addr.getField({ fieldId: 'state' });
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
   * POST — Cria uma subsidiary
   */
  function post(requestBody) {
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

  return { get, post };
});
