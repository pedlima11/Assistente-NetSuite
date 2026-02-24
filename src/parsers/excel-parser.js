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
 * Faz parse de arquivo Excel no contexto do Side Panel
 * NUNCA executar no service worker — File/Blob nao sao JSON-serializaveis
 * @param {File} file
 * @returns {Promise<ParsedData>}
 */
export async function parseExcelFile(file) {
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
