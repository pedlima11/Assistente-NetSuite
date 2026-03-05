/**
 * Mapeia externalId de regras para cores Tailwind em ciclo.
 * 12 cores com bom contraste para chips e borders.
 *
 * @module rule-colors
 */

const PALETTE = [
  { bg: 'bg-blue-100',    text: 'text-blue-800',    ring: 'ring-blue-400',    dot: 'bg-blue-500' },
  { bg: 'bg-emerald-100', text: 'text-emerald-800', ring: 'ring-emerald-400', dot: 'bg-emerald-500' },
  { bg: 'bg-purple-100',  text: 'text-purple-800',  ring: 'ring-purple-400',  dot: 'bg-purple-500' },
  { bg: 'bg-amber-100',   text: 'text-amber-800',   ring: 'ring-amber-400',   dot: 'bg-amber-500' },
  { bg: 'bg-rose-100',    text: 'text-rose-800',    ring: 'ring-rose-400',    dot: 'bg-rose-500' },
  { bg: 'bg-cyan-100',    text: 'text-cyan-800',    ring: 'ring-cyan-400',    dot: 'bg-cyan-500' },
  { bg: 'bg-orange-100',  text: 'text-orange-800',  ring: 'ring-orange-400',  dot: 'bg-orange-500' },
  { bg: 'bg-indigo-100',  text: 'text-indigo-800',  ring: 'ring-indigo-400',  dot: 'bg-indigo-500' },
  { bg: 'bg-lime-100',    text: 'text-lime-800',    ring: 'ring-lime-400',    dot: 'bg-lime-500' },
  { bg: 'bg-pink-100',    text: 'text-pink-800',    ring: 'ring-pink-400',    dot: 'bg-pink-500' },
  { bg: 'bg-teal-100',    text: 'text-teal-800',    ring: 'ring-teal-400',    dot: 'bg-teal-500' },
  { bg: 'bg-sky-100',     text: 'text-sky-800',     ring: 'ring-sky-400',     dot: 'bg-sky-500' },
];

const UNASSIGNED = { bg: 'bg-gray-100', text: 'text-gray-500', ring: 'ring-gray-300', dot: 'bg-gray-400' };

/**
 * Retorna cor para um externalId de regra.
 * Mesma ordem para mesmos IDs (baseado no index no array de rules).
 *
 * @param {string|null} externalId
 * @param {string[]} allRuleIds - lista ordenada de externalIds
 * @returns {{ bg: string, text: string, ring: string, dot: string }}
 */
export function getRuleColor(externalId, allRuleIds) {
  if (!externalId) return UNASSIGNED;
  const idx = allRuleIds.indexOf(externalId);
  if (idx < 0) return UNASSIGNED;
  return PALETTE[idx % PALETTE.length];
}

export { UNASSIGNED as UNASSIGNED_COLOR };
