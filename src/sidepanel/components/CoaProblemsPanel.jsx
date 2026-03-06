import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation('coa');
  const [errorsExpanded, setErrorsExpanded] = useState(true);
  const [warningsExpanded, setWarningsExpanded] = useState(true);

  if (!validationResult) return null;

  const { errorBuckets, warningBuckets, hasBlockingErrors, errorCount, warningCount } = validationResult;

  const errorItems = [
    { key: 'orphans', label: t('errors.orphans'), icon: Link2Off, count: errorBuckets.orphans.length,
      desc: t('errors.orphansDesc'), fix: t('errors.orphansFix') },
    { key: 'duplicateCodes', label: t('errors.duplicateCodes'), icon: Copy, count: errorBuckets.duplicateCodes.length,
      desc: t('errors.duplicateCodesDesc'), fix: t('errors.duplicateCodesFix') },
    { key: 'cycles', label: t('errors.cycles'), icon: RotateCcw, count: errorBuckets.cycles.length,
      desc: t('errors.cyclesDesc'), fix: t('errors.cyclesFix') },
    { key: 'postingWithChildren', label: t('errors.postingWithChildren'), icon: Layers, count: errorBuckets.postingWithChildren.length, hasFix: true,
      desc: t('errors.postingWithChildrenDesc'), fix: t('errors.postingWithChildrenFix') },
    { key: 'missingFields', label: t('errors.missingFields'), icon: FileQuestion, count: errorBuckets.missingFields.length,
      desc: t('errors.missingFieldsDesc'), fix: t('errors.missingFieldsFix') },
    { key: 'nameTooLong', label: t('errors.nameTooLong'), icon: Type, count: errorBuckets.nameTooLong.length,
      desc: t('errors.nameTooLongDesc'), fix: t('errors.nameTooLongFix') },
  ].filter((item) => item.count > 0);

  const warningItems = [
    { key: 'duplicateNames', label: t('warnings.duplicateNames'), icon: Copy, count: warningBuckets.duplicateNames.length,
      desc: t('warnings.duplicateNamesDesc'), fix: t('warnings.duplicateNamesFix') },
    { key: 'typeSuspicious', label: t('warnings.typeSuspicious'), icon: AlertTriangle, count: warningBuckets.typeSuspicious.length,
      desc: t('warnings.typeSuspiciousDesc'), fix: t('warnings.typeSuspiciousFix') },
    { key: 'levelCodeMismatch', label: t('warnings.levelCodeMismatch'), icon: GitBranch, count: warningBuckets.levelCodeMismatch.length,
      desc: t('warnings.levelCodeMismatchDesc'), fix: t('warnings.levelCodeMismatchFix') },
    { key: 'codeFormat', label: t('warnings.codeFormat'), icon: Hash, count: warningBuckets.codeFormat.length,
      desc: t('warnings.codeFormatDesc'), fix: t('warnings.codeFormatFix') },
    { key: 'immutableChanged', label: t('warnings.immutableChanged'), icon: AlertCircle, count: warningBuckets.immutableChanged.length,
      desc: t('warnings.immutableChangedDesc'), fix: t('warnings.immutableChangedFix') },
  ].filter((item) => item.count > 0);

  if (warningBuckets.tooManyRoots) {
    warningItems.push({ key: 'tooManyRoots', label: t('warnings.tooManyRoots'), icon: AlertTriangle, count: 0,
      desc: t('warnings.tooManyRootsDesc'), fix: t('warnings.tooManyRootsFix') });
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
            <span className="text-xs font-medium text-rose flex-1">{t('errors.title', { count: errorCount })}</span>
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
                          title={t('errors.autoFixTitle')}
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
            <span className="text-xs font-medium text-golden flex-1">{t('warnings.title', { count: warningCount })}</span>
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
              {t('modified.label', { count: warningBuckets.modified.length })}
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
                {t('gate.blocking', { count: errorCount })}
              </span>
            </>
          ) : (
            <>
              <CheckCircle className="w-4 h-4 text-pine" />
              <span className="text-xs font-medium text-pine">{t('gate.ready')}</span>
            </>
          )}
        </div>
        {warningCount > 0 && !hasBlockingErrors && (
          <p className="text-[10px] text-golden mt-1 ml-6">{t('gate.warnings', { count: warningCount })}</p>
        )}
      </div>

      {/* No problems */}
      {errorItems.length === 0 && warningItems.length === 0 && (
        <div className="text-center py-4">
          <CheckCircle className="w-6 h-6 text-pine mx-auto mb-1" />
          <p className="text-xs text-pine">{t('noProblems')}</p>
        </div>
      )}
    </div>
  );
}
