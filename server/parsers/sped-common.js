/**
 * Helpers compartilhados entre parsers SPED (Fiscal e Contribuicoes).
 *
 * Funcoes puras de parsing de linhas SPED, deteccao de encoding
 * e conversao de codigos IBGE.
 */

import { createReadStream, statSync } from 'fs';
import { createInterface } from 'readline';

// ── COD_MUN (IBGE) → UF ─────────────────────────────────────────────────────

export const IBGE_TO_UF = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA',
  '16': 'AP', '17': 'TO', '21': 'MA', '22': 'PI', '23': 'CE',
  '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE',
  '29': 'BA', '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS', '50': 'MS', '51': 'MT',
  '52': 'GO', '53': 'DF',
};

/**
 * Converte COD_MUN (IBGE) para UF.
 * @param {string} codMun - Codigo IBGE do municipio (7 digitos)
 * @returns {string} UF (2 letras) ou ''
 */
export function codMunToUF(codMun) {
  if (!codMun || codMun.length < 2) return '';
  return IBGE_TO_UF[codMun.substring(0, 2)] || '';
}

// ── UFs validas ──────────────────────────────────────────────────────────────

const VALID_UFS = new Set(Object.values(IBGE_TO_UF));

// ── Validacao do 0000 (companyInfo) ──────────────────────────────────────────

/**
 * Valida campos extraidos do registro 0000 e tenta corrigir UF invalida.
 *
 * @param {Object} companyInfo - { cnpj, uf, nome, codMun, dtIni, dtFin }
 * @returns {{ warnings: string[], fixedUf?: string }}
 */
export function validateCompanyInfo(companyInfo) {
  const warnings = [];
  const result = {};

  // CNPJ: 14 digitos numericos
  const cnpjClean = (companyInfo.cnpj || '').replace(/\D/g, '');
  if (!cnpjClean || cnpjClean.length !== 14) {
    warnings.push(`CNPJ invalido no 0000: "${companyInfo.cnpj}" (esperado 14 digitos).`);
  }

  // UF: 2 letras maiusculas + estar na lista
  const uf = (companyInfo.uf || '').toUpperCase().trim();
  if (!uf || !VALID_UFS.has(uf)) {
    // Tentar fallback via codMun
    const fallbackUf = codMunToUF(companyInfo.codMun);
    if (fallbackUf) {
      result.fixedUf = fallbackUf;
      warnings.push(`UF invalida no 0000: "${companyInfo.uf}". Corrigida para "${fallbackUf}" via COD_MUN ${companyInfo.codMun}.`);
    } else {
      warnings.push(`UF invalida no 0000: "${companyInfo.uf}" e COD_MUN "${companyInfo.codMun}" nao permitiu fallback. destUF sera vazio.`);
    }
  }

  // DT_INI / DT_FIN: 8 digitos DDMMAAAA
  for (const [field, label] of [['dtIni', 'DT_INI'], ['dtFin', 'DT_FIN']]) {
    const val = (companyInfo[field] || '').trim();
    if (val && !/^\d{8}$/.test(val)) {
      warnings.push(`${label} invalida no 0000: "${val}" (esperado 8 digitos DDMMAAAA).`);
    }
  }

  return { warnings, ...result };
}

// ── Parsing de linhas SPED ───────────────────────────────────────────────────

/**
 * Extrai o tipo de registro de uma linha SPED sem fazer split completo.
 * Linhas SPED: |TIPO|campo1|campo2|...|
 * @param {string} line
 * @returns {string} Tipo do registro ou ''
 */
export function extractRegisterType(line) {
  const start = line.charAt(0) === '|' ? 1 : 0;
  const end = line.indexOf('|', start);
  if (end === -1) return '';
  return line.substring(start, end);
}

/**
 * Faz split de uma linha SPED em campos.
 * Remove pipes iniciais e finais vazios.
 * @param {string} line
 * @returns {string[]}
 */
export function splitLine(line) {
  const fields = line.split('|');
  if (fields.length > 0 && fields[0] === '') fields.shift();
  if (fields.length > 0 && fields[fields.length - 1] === '') fields.pop();
  return fields;
}

// ── Deteccao de encoding ─────────────────────────────────────────────────────

/**
 * Detecta encoding do arquivo.
 * Le os primeiros bytes e verifica se UTF-8 decodifica corretamente.
 * @param {string} filePath
 * @returns {Promise<'utf-8'|'latin1'>}
 */
export async function detectEncoding(filePath) {
  const buffer = Buffer.alloc(4096);
  const fileHandle = await (await import('fs/promises')).open(filePath, 'r');
  try {
    await fileHandle.read(buffer, 0, 4096, 0);
  } finally {
    await fileHandle.close();
  }

  const utf8Text = buffer.toString('utf-8');
  if (utf8Text.includes('\uFFFD')) {
    return 'latin1';
  }
  return 'utf-8';
}

// ── COD_SIT constants ────────────────────────────────────────────────────────

/** COD_SIT que sao sempre rejeitados */
export const REJECTED_COD_SIT = new Set(['02', '03', '04', '05']);

/** COD_SIT aceitos por default (regulares + extemporaneos) */
export const DEFAULT_ACCEPTED_COD_SIT = new Set(['00', '01']);

/** COD_SIT opcionais (complementares + regime especial) */
export const OPTIONAL_COD_SIT = {
  complementary: new Set(['06', '07']),
  specialRegime: new Set(['08']),
};

/**
 * Monta set de COD_SIT aceitos com base nas opcoes.
 * @param {Object} [options]
 * @param {boolean} [options.includeComplementary=false]
 * @param {boolean} [options.includeSpecialRegime=false]
 * @returns {Set<string>}
 */
export function buildAcceptedCodSit(options = {}) {
  const accepted = new Set(DEFAULT_ACCEPTED_COD_SIT);
  if (options.includeComplementary) {
    for (const sit of OPTIONAL_COD_SIT.complementary) accepted.add(sit);
  }
  if (options.includeSpecialRegime) {
    for (const sit of OPTIONAL_COD_SIT.specialRegime) accepted.add(sit);
  }
  return accepted;
}

// ── Streaming helpers ────────────────────────────────────────────────────────

/**
 * Cria readline interface para arquivo SPED com encoding auto-detectado.
 *
 * @param {string} filePath
 * @returns {Promise<{ rl: readline.Interface, encoding: string, totalBytes: number }>}
 */
export async function createSpedReader(filePath) {
  const encoding = await detectEncoding(filePath);
  let totalBytes = 0;
  try {
    totalBytes = statSync(filePath).size;
  } catch { /* ignore */ }

  const rl = createInterface({
    input: createReadStream(filePath, { encoding }),
    crlfDelay: Infinity,
  });

  return { rl, encoding, totalBytes };
}
