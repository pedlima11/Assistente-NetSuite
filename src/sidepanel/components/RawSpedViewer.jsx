/**
 * RawSpedViewer — exibe linha SPED com campos separados e highlight.
 *
 * Layout C170 (campos relevantes para regras fiscais):
 *   Campo 10 = CST_ICMS, 11 = CFOP, 12 = COD_NAT
 *   13 = VL_BC_ICMS, 14 = ALIQ_ICMS, 15 = VL_ICMS
 *   25 = CST_PIS, 30 = CST_COFINS
 */

const C170_FIELDS = {
  0: 'REG',
  1: 'NUM_ITEM',
  2: 'COD_ITEM',
  3: 'DESCR_COMPL',
  6: 'VL_ITEM',
  9: 'CST_ICMS',
  10: 'CFOP',
  12: 'VL_BC_ICMS',
  13: 'ALIQ_ICMS',
  14: 'VL_ICMS',
  19: 'CST_IPI',
  22: 'ALIQ_IPI',
  24: 'CST_PIS',
  26: 'ALIQ_PIS',
  29: 'CST_COFINS',
  31: 'ALIQ_COFINS',
};

const HIGHLIGHT_INDICES = new Set([6, 9, 10, 13, 14, 24, 29]);

export default function RawSpedViewer({ line }) {
  if (!line) {
    return <div className="text-xs text-ocean-60 p-2">Sem dados raw disponíveis</div>;
  }

  // Split por pipe, removendo primeiro e ultimo vazios
  const raw = line.startsWith('|') ? line.slice(1) : line;
  const fields = raw.split('|');

  return (
    <div className="bg-ocean-180 rounded-md p-3 overflow-auto max-h-80">
      {/* Linha original */}
      <div className="text-[10px] text-ocean-60 mb-2 font-mono break-all">{line}</div>

      {/* Tabela de campos */}
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="text-ocean-60 border-b border-ocean-150">
            <th className="text-left py-0.5 w-8">#</th>
            <th className="text-left py-0.5 w-24">Campo</th>
            <th className="text-left py-0.5">Valor</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((value, i) => {
            const trimmed = value.trim();
            if (!trimmed && !C170_FIELDS[i]) return null; // Pular campos vazios sem label
            const isHighlight = HIGHLIGHT_INDICES.has(i);
            const label = C170_FIELDS[i] || '';

            return (
              <tr
                key={i}
                className={isHighlight ? 'bg-golden/20' : ''}
              >
                <td className="text-ocean-60 py-0.5">{i}</td>
                <td className="text-ocean-60 py-0.5">{label}</td>
                <td className={`py-0.5 ${isHighlight ? 'text-white font-medium' : 'text-ocean-60'}`}>
                  {trimmed || '(vazio)'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
