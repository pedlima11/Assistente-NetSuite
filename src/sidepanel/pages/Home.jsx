import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Settings, ListTree, Receipt,
  Users, Truck, Package, ChevronRight, MapPin, Building2
} from 'lucide-react';

const STEP_META = [
  { key: 'settings', icon: Settings, path: '/settings', state: null },
  {
    key: 'coa', icon: ListTree, path: '/upload', state: { importType: 'plano-de-contas' },
    secondaryButton: { icon: Building2, path: '/review', state: { subsidiaryOnly: true } },
  },
  { key: 'customers', icon: Users, path: '/customer-import', state: null },
  { key: 'vendors', icon: Truck, path: '/vendor-import', state: null },
  { key: 'items', icon: Package, path: '/item-import', state: null },
  { key: 'taxRules', icon: Receipt, path: '/tax-rules', state: null },
];


export default function Home() {
  const navigate = useNavigate();
  const { t } = useTranslation('home');
  const [activeStep, setActiveStep] = useState(0);

  const meta = STEP_META[activeStep];
  const StepIcon = meta.icon;

  return (
    <div className="relative min-h-screen -m-6 p-6">
      {/* Full-screen background */}
      <div
        className="fixed inset-0 bg-cover bg-center bg-no-repeat -z-10"
        style={{ backgroundImage: "url('/netsuite-bg.jpg')" }}
      />
      {/* Header */}
      <div className="flex flex-col items-center mb-6">
        <img src="./logo-netsuite.png" alt="Oracle NetSuite" className="h-16 mb-2" />
        <p className="text-sm text-ocean-60">{t('common:setupAssistant')}</p>
      </div>

      {/* Decorative bar */}
      <div className="mb-8">
        <img src="/netsuite-bar.jpg" alt="" className="w-full h-1.5 object-cover rounded-full" />
      </div>

      {/* Roadmap Section */}
      <div>
          <div className="flex items-center gap-2 mb-6">
            <MapPin className="w-5 h-5 text-ocean-120" />
            <h2 className="text-base font-semibold text-ocean-180">{t('roadmapTitle')}</h2>
          </div>

          {/* Stepper - Desktop (horizontal) */}
          <div className="hidden md:block">
            <div className="relative flex items-start justify-between px-4">
              {/* Connecting line */}
              <div className="absolute top-4 left-8 right-8 h-0.5 bg-ocean-30" />

              {STEP_META.map((step, index) => (
                <button
                  key={step.key}
                  onClick={() => setActiveStep(index)}
                  className="relative flex flex-col items-center cursor-pointer group"
                  style={{ width: `${100 / STEP_META.length}%` }}
                >
                  <div
                    className={`
                      relative z-10 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold
                      transition-all duration-200
                      ${index === activeStep
                        ? 'bg-ocean-120 text-white shadow-md shadow-ocean-120/30 scale-110'
                        : 'bg-white border-2 border-ocean-60 text-ocean-60 group-hover:border-ocean-120 group-hover:text-ocean-120'
                      }
                    `}
                  >
                    {index + 1}
                  </div>
                  <span
                    className={`
                      mt-2 text-xs text-center leading-tight transition-colors
                      ${index === activeStep ? 'text-ocean-180 font-semibold' : 'text-ocean-60 group-hover:text-ocean-120'}
                    `}
                  >
                    {t(`steps.${step.key}.title`)}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Stepper - Mobile (vertical) */}
          <div className="md:hidden flex flex-col gap-1 mb-2">
            {STEP_META.map((step, index) => (
              <button
                key={step.key}
                onClick={() => setActiveStep(index)}
                className={`
                  flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-all
                  ${index === activeStep ? 'bg-ocean-30' : 'hover:bg-gray-50'}
                `}
              >
                <div
                  className={`
                    w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0
                    ${index === activeStep
                      ? 'bg-ocean-120 text-white'
                      : 'bg-white border-2 border-ocean-60 text-ocean-60'
                    }
                  `}
                >
                  {index + 1}
                </div>
                <span className={`text-sm ${index === activeStep ? 'text-ocean-180 font-medium' : 'text-ocean-60'}`}>
                  {t(`steps.${step.key}.title`)}
                </span>
              </button>
            ))}
          </div>

          {/* Active Step Card */}
          <div className="mt-6 bg-white rounded-lg border border-ocean-30 p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-ocean-30 flex items-center justify-center flex-shrink-0">
                <StepIcon className="w-5 h-5 text-ocean-120" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-ocean-120 bg-ocean-30 px-2 py-0.5 rounded-full">
                  {t('stepOf', { current: activeStep + 1, total: STEP_META.length })}
                </span>
                <h3 className="text-base font-semibold text-ocean-180 mt-2 mb-1">{t(`steps.${meta.key}.title`)}</h3>
                <p className="text-sm text-ocean-60 leading-relaxed">{t(`steps.${meta.key}.description`)}</p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {meta.secondaryButton && (
                  <button
                    onClick={() => {
                      sessionStorage.setItem('subsidiaryOnly', 'true');
                      sessionStorage.removeItem('reviewData');
                      navigate(meta.secondaryButton.path, { state: meta.secondaryButton.state });
                    }}
                    className="flex items-center gap-1.5 bg-white border border-ocean-120 text-ocean-120 text-sm font-medium px-4 py-2 rounded-lg hover:bg-ocean-10 transition-colors cursor-pointer"
                  >
                    <Building2 className="w-4 h-4" />
                    {t(`steps.${meta.key}.secondaryButton`)}
                  </button>
                )}
                <button
                  onClick={() => navigate(meta.path, { state: meta.state })}
                  className="flex items-center gap-1.5 bg-ocean-120 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-ocean-150 transition-colors cursor-pointer"
                >
                  {t(`steps.${meta.key}.button`)}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
      </div>
    </div>
  );
}
