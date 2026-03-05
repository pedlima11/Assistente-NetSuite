import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Settings, ListTree, Receipt,
  Users, Truck, Package, ChevronRight, MapPin, Building2
} from 'lucide-react';

const ROADMAP_STEPS = [
  {
    title: 'Configuracao',
    description: 'Cadastre as credenciais OAuth do NetSuite e a chave da Claude API para conectar o assistente.',
    buttonLabel: 'Configurar',
    icon: Settings,
    path: '/settings',
    state: null,
  },
  {
    title: 'Filial & Plano de Contas',
    description: 'Crie a filial no NetSuite e/ou importe o plano de contas a partir de uma planilha.',
    buttonLabel: 'Importar Planilha',
    icon: ListTree,
    path: '/upload',
    state: { importType: 'plano-de-contas' },
    secondaryButton: {
      label: 'Criar Filial',
      icon: Building2,
      path: '/review',
      state: { subsidiaryOnly: true },
    },
  },
  {
    title: 'Clientes',
    description: 'Importe o cadastro de clientes da empresa a partir de planilhas.',
    buttonLabel: 'Importar',
    icon: Users,
    path: '/customer-import',
    state: null,
  },
  {
    title: 'Fornecedores',
    description: 'Importe o cadastro de fornecedores da empresa a partir de planilhas.',
    buttonLabel: 'Importar',
    icon: Truck,
    path: '/vendor-import',
    state: null,
  },
  {
    title: 'Itens',
    description: 'Importe o cadastro de produtos e servicos da empresa.',
    buttonLabel: 'Importar',
    icon: Package,
    path: '/item-import',
    state: null,
  },
  {
    title: 'Regras Fiscais',
    description: 'Importe XMLs de NF-e para regras de saida e arquivos SPED para regras de entrada.',
    buttonLabel: 'Gerar Regras',
    icon: Receipt,
    path: '/tax-rules',
    state: null,
  },
];


export default function Home() {
  const navigate = useNavigate();
  const [activeStep, setActiveStep] = useState(0);

  const currentStep = ROADMAP_STEPS[activeStep];

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
        <p className="text-sm text-ocean-60">Setup Assistant</p>
      </div>

      {/* Decorative bar */}
      <div className="mb-8">
        <img src="/netsuite-bar.jpg" alt="" className="w-full h-1.5 object-cover rounded-full" />
      </div>

      {/* Roadmap Section */}
      <div>
          <div className="flex items-center gap-2 mb-6">
            <MapPin className="w-5 h-5 text-ocean-120" />
            <h2 className="text-base font-semibold text-ocean-180">Roteiro de Implantacao</h2>
          </div>

          {/* Stepper - Desktop (horizontal) */}
          <div className="hidden md:block">
            <div className="relative flex items-start justify-between px-4">
              {/* Connecting line */}
              <div className="absolute top-4 left-8 right-8 h-0.5 bg-ocean-30" />

              {ROADMAP_STEPS.map((step, index) => (
                <button
                  key={step.title}
                  onClick={() => setActiveStep(index)}
                  className="relative flex flex-col items-center cursor-pointer group"
                  style={{ width: `${100 / ROADMAP_STEPS.length}%` }}
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
                    {step.title}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Stepper - Mobile (vertical) */}
          <div className="md:hidden flex flex-col gap-1 mb-2">
            {ROADMAP_STEPS.map((step, index) => (
              <button
                key={step.title}
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
                  {step.title}
                </span>
              </button>
            ))}
          </div>

          {/* Active Step Card */}
          <div className="mt-6 bg-white rounded-lg border border-ocean-30 p-6 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-lg bg-ocean-30 flex items-center justify-center flex-shrink-0">
                <currentStep.icon className="w-5 h-5 text-ocean-120" />
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-xs font-medium text-ocean-120 bg-ocean-30 px-2 py-0.5 rounded-full">
                  Passo {activeStep + 1} de {ROADMAP_STEPS.length}
                </span>
                <h3 className="text-base font-semibold text-ocean-180 mt-2 mb-1">{currentStep.title}</h3>
                <p className="text-sm text-ocean-60 leading-relaxed">{currentStep.description}</p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                {currentStep.secondaryButton && (
                  <button
                    onClick={() => {
                      sessionStorage.setItem('subsidiaryOnly', 'true');
                      sessionStorage.removeItem('reviewData');
                      navigate(currentStep.secondaryButton.path, { state: currentStep.secondaryButton.state });
                    }}
                    className="flex items-center gap-1.5 bg-white border border-ocean-120 text-ocean-120 text-sm font-medium px-4 py-2 rounded-lg hover:bg-ocean-10 transition-colors cursor-pointer"
                  >
                    <Building2 className="w-4 h-4" />
                    {currentStep.secondaryButton.label}
                  </button>
                )}
                <button
                  onClick={() => navigate(currentStep.path, { state: currentStep.state })}
                  className="flex items-center gap-1.5 bg-ocean-120 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-ocean-150 transition-colors cursor-pointer"
                >
                  {currentStep.buttonLabel}
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
      </div>
    </div>
  );
}
