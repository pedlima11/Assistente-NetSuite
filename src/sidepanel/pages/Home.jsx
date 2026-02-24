import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Settings, ListTree, TrendingUp, Scale } from 'lucide-react';

const NAV_ITEMS = [
  {
    label: 'Configuracao',
    description: 'Credenciais NetSuite e Claude API',
    icon: Settings,
    path: '/settings',
    state: null,
  },
  {
    label: 'Plano de Contas',
    description: 'Importar contas do Excel',
    icon: ListTree,
    path: '/upload',
    state: { importType: 'plano-de-contas' },
  },
  {
    label: 'DRE',
    description: 'Demonstracao do Resultado',
    icon: TrendingUp,
    path: '/upload',
    state: { importType: 'dre' },
  },
  {
    label: 'Balanco',
    description: 'Balanco Patrimonial',
    icon: Scale,
    path: '/upload',
    state: { importType: 'balanco' },
  },
];

export default function Home() {
  const navigate = useNavigate();

  return (
    <div className="max-w-md mx-auto">
      <div className="flex flex-col items-center mb-6">
        <img src="./logo-netsuite.png" alt="Oracle NetSuite" className="h-14 mb-2" />
        <p className="text-xs text-ocean-60">Setup Assistant</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.label}
            onClick={() => navigate(item.path, { state: item.state })}
            className="bg-white rounded-lg border border-ocean-30 p-5 text-left cursor-pointer transition-all hover:border-ocean-120 hover:shadow-md group"
          >
            <item.icon className="w-7 h-7 text-ocean-120 mb-3 group-hover:text-ocean-180 transition-colors" />
            <p className="text-sm font-medium text-ocean-180">{item.label}</p>
            <p className="text-xs text-ocean-60 mt-1">{item.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
