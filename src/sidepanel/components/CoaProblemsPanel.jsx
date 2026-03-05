import React, { useState } from 'react';
import {
  AlertTriangle, AlertCircle, XCircle, CheckCircle,
  ChevronDown, ChevronRight, Wrench, Link2Off, Copy, RotateCcw,
  FileQuestion, Type, Hash, Layers, GitBranch, Pencil,
} from 'lucide-react';

/**
 * Painel esquerdo com buckets de problemas clicaveis.
 *
 * @param {{
 *   validationResult: Object,
 *   activeFilter: string|null,
 *   onFilterChange: (filter: string|null) => void,
 *   onAutoFixPostingParents: () => void,
 * }} props
 */
export default function CoaProblemsPanel({
  validationResult,
  activeFilter,
  onFilterChange,
  onAutoFixPostingParents,
}) {
  const [errorsExpanded, setErrorsExpanded] = useState(true);
  const [warningsExpanded, setWarningsExpanded] = useState(true);

  if (!validationResult) return null;

  const { errorBuckets, warningBuckets, hasBlockingErrors, errorCount, warningCount } = validationResult;

  const errorItems = [
    { key: 'orphans', label: 'Orfaos', icon: Link2Off, count: errorBuckets.orphans.length,
      desc: 'Conta referencia um pai que nao existe no plano.', fix: 'Arraste para um pai valido ou crie a conta pai.' },
    { key: 'duplicateCodes', label: 'Codigos duplicados', icon: Copy, count: errorBuckets.duplicateCodes.length,
      desc: 'Duas ou mais contas com o mesmo codigo.', fix: 'Edite um dos codigos para torna-lo unico.' },
    { key: 'cycles', label: 'Ciclos', icon: RotateCcw, count: errorBuckets.cycles.length,
      desc: 'Hierarquia circular: A pai de B que pai de A.', fix: 'Corrija o campo pai de uma das contas.' },
    { key: 'postingWithChildren', label: 'Analiticas com filhos', icon: Layers, count: errorBuckets.postingWithChildren.length, hasFix: true,
      desc: 'Conta analitica nao pode ter sub-contas no NetSuite.', fix: 'Converta em sintetica (botao chave) ou mova as filhas.' },
    { key: 'missingFields', label: 'Campos obrigatorios', icon: FileQuestion, count: errorBuckets.missingFields.length,
      desc: 'Codigo ou nome esta vazio.', fix: 'Preencha ambos — obrigatorios no NetSuite.' },
    { key: 'nameTooLong', label: 'Nome > 60 chars', icon: Type, count: errorBuckets.nameTooLong.length,
      desc: 'Nome excede 60 caracteres (limite NetSuite).', fix: 'Encurte o nome da conta.' },
  ].filter((item) => item.count > 0);

  const warningItems = [
    { key: 'duplicateNames', label: 'Nomes duplicados', icon: Copy, count: warningBuckets.duplicateNames.length,
      desc: 'Irmaos com nome identico sob mesmo pai.', fix: 'Renomeie um para evitar confusao.' },
    { key: 'typeSuspicious', label: 'Tipo suspeito', icon: AlertTriangle, count: warningBuckets.typeSuspicious.length,
      desc: 'Tipo nao corresponde ao prefixo brasileiro.', fix: 'Confira: 1=Ativo 2=Passivo 3=PL 4=Receita 5=Custo 6=Despesa.' },
    { key: 'levelCodeMismatch', label: 'Nivel inconsistente', icon: GitBranch, count: warningBuckets.levelCodeMismatch.length,
      desc: 'Profundidade na arvore diferente dos segmentos do codigo.', fix: 'Ajuste hierarquia ou reformate o codigo.' },
    { key: 'codeFormat', label: 'Formato de codigo', icon: Hash, count: warningBuckets.codeFormat.length,
      desc: 'Caracteres fora do padrao numerico pontilhado.', fix: 'Use Normalizar na barra ou edite manualmente.' },
    { key: 'immutableChanged', label: 'Campos imutaveis', icon: AlertCircle, count: warningBuckets.immutableChanged.length,
      desc: 'Codigo/tipo de contas existentes sao imutaveis.', fix: 'Reverta ou delete e recrie a conta.' },
  ].filter((item) => item.count > 0);

  if (warningBuckets.tooManyRoots) {
    warningItems.push({ key: 'tooManyRoots', label: 'Muitas raizes (>10)', icon: AlertTriangle, count: 0,
      desc: 'Mais de 10 raizes (incomum no plano brasileiro).', fix: 'Consolide em 6-7 grupos de primeiro nivel.' });
  }

  function handleClick(key) {
    onFilterChange(activeFilter === key ? null : key);
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      {/* Errors section */}
      {errorItems.length > 0 && (
        <div className="bg-red-50/50 border border-rose/20 rounded-lg overflow-hidden">
          <button
            onClick={() => setErrorsExpanded(!errorsExpanded)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-red-50"
          >
            {errorsExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-rose" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-rose" />
            )}
            <XCircle className="w-3.5 h-3.5 text-rose" />
            <span className="text-xs font-medium text-rose flex-1">Erros ({errorCount})</span>
          </button>

          {errorsExpanded && (
            <div className="px-2 pb-2 space-y-0.5">
              {errorItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeFilter === item.key;
                return (
                  <div key={item.key}>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleClick(item.key)}
                        className={`flex-1 flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                          isActive
                            ? 'bg-rose/10 text-rose font-medium'
                            : 'text-ocean-150 hover:bg-red-50'
                        }`}
                      >
                        <Icon className="w-3 h-3 flex-shrink-0" />
                        <span className="flex-1 text-left">{item.label}</span>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          isActive ? 'bg-rose text-white' : 'bg-rose/10 text-rose'
                        }`}>
                          {item.count}
                        </span>
                      </button>

                      {item.hasFix && item.count > 0 && (
                        <button
                          onClick={onAutoFixPostingParents}
                          title="Converter pais em sinteticas"
                          className="p-1 rounded hover:bg-rose/10 text-rose transition-colors"
                        >
                          <Wrench className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    {isActive && item.desc && (
                      <div className="ml-5 mt-1 mb-1 max-w-[220px] space-y-0.5">
                        <p className="text-[10px] text-ocean-120 leading-tight">{item.desc}</p>
                        <p className="text-[10px] text-ocean-60 leading-tight">{item.fix}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Warnings section */}
      {warningItems.length > 0 && (
        <div className="bg-yellow-50/50 border border-golden/20 rounded-lg overflow-hidden">
          <button
            onClick={() => setWarningsExpanded(!warningsExpanded)}
            className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-yellow-50"
          >
            {warningsExpanded ? (
              <ChevronDown className="w-3.5 h-3.5 text-golden" />
            ) : (
              <ChevronRight className="w-3.5 h-3.5 text-golden" />
            )}
            <AlertTriangle className="w-3.5 h-3.5 text-golden" />
            <span className="text-xs font-medium text-golden flex-1">Avisos ({warningCount})</span>
          </button>

          {warningsExpanded && (
            <div className="px-2 pb-2 space-y-0.5">
              {warningItems.map((item) => {
                const Icon = item.icon;
                const isActive = activeFilter === item.key;
                return (
                  <div key={item.key}>
                    <button
                      onClick={() => handleClick(item.key)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors ${
                        isActive
                          ? 'bg-golden/10 text-golden font-medium'
                          : 'text-ocean-150 hover:bg-yellow-50'
                      }`}
                    >
                      <Icon className="w-3 h-3 flex-shrink-0" />
                      <span className="flex-1 text-left">{item.label}</span>
                      {item.count > 0 && (
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                          isActive ? 'bg-golden text-white' : 'bg-golden/10 text-golden'
                        }`}>
                          {item.count}
                        </span>
                      )}
                    </button>
                    {isActive && item.desc && (
                      <div className="ml-5 mt-1 mb-1 max-w-[220px] space-y-0.5">
                        <p className="text-[10px] text-ocean-120 leading-tight">{item.desc}</p>
                        <p className="text-[10px] text-ocean-60 leading-tight">{item.fix}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modified accounts info */}
      {warningBuckets.modified.length > 0 && (
        <div className="bg-ocean-10/50 border border-ocean-30 rounded-lg overflow-hidden">
          <button
            onClick={() => handleClick('modified')}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
              activeFilter === 'modified' ? 'bg-ocean-30/50' : 'hover:bg-ocean-10'
            }`}
          >
            <Pencil className="w-3.5 h-3.5 text-ocean-120" />
            <span className="text-xs font-medium text-ocean-150 flex-1">
              {warningBuckets.modified.length} conta{warningBuckets.modified.length !== 1 ? 's' : ''} alterada{warningBuckets.modified.length !== 1 ? 's' : ''}
            </span>
          </button>
        </div>
      )}

      {/* Import gate summary */}
      <div className={`rounded-lg border p-3 ${
        hasBlockingErrors
          ? 'border-rose/30 bg-red-50/30'
          : 'border-pine/30 bg-green-50/30'
      }`}>
        <div className="flex items-center gap-2">
          {hasBlockingErrors ? (
            <>
              <XCircle className="w-4 h-4 text-rose" />
              <span className="text-xs font-medium text-rose">
                {errorCount} problema{errorCount !== 1 ? 's' : ''} bloqueante{errorCount !== 1 ? 's' : ''}
              </span>
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4 text-pine" />
              <span className="text-xs font-medium text-pine">Pronto para importar</span>
            </>
          )}
        </div>
        {warningCount > 0 && !hasBlockingErrors && (
          <p className="text-[10px] text-golden mt-1 ml-6">{warningCount} aviso{warningCount !== 1 ? 's' : ''}</p>
        )}
      </div>

      {/* No problems */}
      {errorItems.length === 0 && warningItems.length === 0 && (
        <div className="text-center py-4">
          <CheckCircle className="w-6 h-6 text-pine mx-auto mb-1" />
          <p className="text-xs text-pine">Nenhum problema encontrado</p>
        </div>
      )}
    </div>
  );
}
