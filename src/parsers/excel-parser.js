import * as XLSX from 'xlsx';

/**
 * @typedef {Object} ParsedData
 * @property {string} fileName
 * @property {string} fileType - 'balanco' | 'balancete' | 'unknown'
 * @property {string[][]} headers - Cabecalhos de cada sheet
 * @property {Object[]} rows - Dados de cada linha
 * @property {string[]} sheetNames
 */

/**
 * Detecta o tipo de arquivo financeiro pelo conteudo
 * @param {string[][]} rows
 * @returns {'balanco' | 'balancete' | 'unknown'}
 */
function detectFileType(rows) {
  const allText = rows
    .flat()
    .join(' ')
    .toLowerCase();

  if (allText.includes('balanço patrimonial') || allText.includes('balanco patrimonial')) {
    return 'balanco';
  }
  if (allText.includes('balancete') || allText.includes('saldo anterior') || allText.includes('débito') || allText.includes('crédito')) {
    return 'balancete';
  }
  return 'unknown';
}

/**
 * Detecta o delimitador de um CSV (virgula, ponto-e-virgula ou tab)
 * @param {string} text - Primeiras linhas do CSV
 * @returns {string} - Delimitador detectado
 */
function detectDelimiter(text) {
  const firstLines = text.split('\n').slice(0, 5).join('\n');
  const semicolons = (firstLines.match(/;/g) || []).length;
  const commas = (firstLines.match(/,/g) || []).length;
  const tabs = (firstLines.match(/\t/g) || []).length;

  if (tabs > semicolons && tabs > commas) return '\t';
  if (semicolons > commas) return ';';
  return ',';
}

/**
 * Faz parse de uma linha CSV respeitando campos entre aspas
 * @param {string} line
 * @param {string} delimiter
 * @returns {string[]}
 */
function parseCSVLine(line, delimiter) {
  const fields = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === delimiter) {
        fields.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
  }
  fields.push(current.trim());
  return fields;
}

/**
 * Faz parse de conteudo CSV
 * @param {string} text - Conteudo do arquivo CSV
 * @returns {{ rows: string[][], delimiter: string }}
 */
function parseCSVContent(text) {
  // Normalizar quebras de linha
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const delimiter = detectDelimiter(normalized);
  const lines = normalized.split('\n').filter((line) => line.trim().length > 0);

  const rows = lines.map((line) => parseCSVLine(line, delimiter));
  return { rows, delimiter };
}

/**
 * Le um arquivo como texto, tentando diferentes encodings
 * @param {File} file
 * @returns {Promise<string>}
 */
async function readFileAsText(file) {
  // Tentar UTF-8 primeiro
  try {
    const text = await file.text();
    // Verificar se tem caracteres de substituicao (encoding errado)
    if (!text.includes('\uFFFD')) return text;
  } catch (e) {
    // Fallback abaixo
  }

  // Fallback: tentar ISO-8859-1 (Windows Latin-1, comum em arquivos BR)
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file, 'ISO-8859-1');
  });
}

/**
 * Faz parse de arquivo CSV no contexto do Side Panel
 * @param {File} file
 * @returns {Promise<ParsedData>}
 */
async function parseCSVFile(file) {
  const text = await readFileAsText(file);
  const { rows } = parseCSVContent(text);

  const headers = rows.length > 0 ? [rows[0]] : [];
  const fileType = detectFileType(rows);

  return {
    fileName: file.name,
    fileType,
    headers,
    rows,
    sheetNames: ['CSV'],
  };
}

/**
 * Faz parse de arquivo Excel ou CSV no contexto do Side Panel
 * NUNCA executar no service worker — File/Blob nao sao JSON-serializaveis
 * @param {File} file
 * @returns {Promise<ParsedData>}
 */
export async function parseExcelFile(file) {
  const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));

  // CSV: parse proprio sem SheetJS
  if (ext === '.csv' || file.type === 'text/csv') {
    return parseCSVFile(file);
  }

  // Excel: parse via SheetJS
  const arrayBuffer = await file.arrayBuffer();
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });

  const sheetNames = workbook.SheetNames;
  const allRows = [];
  const headers = [];

  for (const sheetName of sheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (jsonData.length > 0) {
      headers.push(jsonData[0]);
      allRows.push(...jsonData);
    }
  }

  const fileType = detectFileType(allRows);

  return {
    fileName: file.name,
    fileType,
    headers,
    rows: allRows,
    sheetNames,
  };
}
