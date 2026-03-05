import React from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Settings from './pages/Settings.jsx';
import Upload from './pages/Upload.jsx';
import Review from './pages/Review.jsx';
import Status from './pages/Status.jsx';
import TaxRules from './pages/TaxRules.jsx';
import BalanceUpload from './pages/BalanceUpload.jsx';
import BalanceStatus from './pages/BalanceStatus.jsx';
import CustomerImport from './pages/CustomerImport.jsx';
import VendorImport from './pages/VendorImport.jsx';
import ItemImport from './pages/ItemImport.jsx';

const NAV_LINKS = [
  { label: 'Inicio', path: '/', state: null },
  { label: 'Configuracao', path: '/settings', state: null },
  { label: 'Plano de Contas', path: '/upload', state: { importType: 'plano-de-contas' } },
  { label: 'DRE', path: '/upload', state: { importType: 'dre' } },
  { label: 'Balanco', path: '/upload', state: { importType: 'balanco' } },
  { label: 'Saldos', path: '/balance-upload', state: null },
  { label: 'Regras Fiscais', path: '/tax-rules', state: null },
  { label: 'Clientes', path: '/customer-import', state: null },
  { label: 'Fornecedores', path: '/vendor-import', state: null },
  { label: 'Itens', path: '/item-import', state: null },
];

function NavBar() {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <header className="hidden">
      <div className="bg-ocean-150 px-6 py-2">
        <div className="max-w-7xl mx-auto flex items-center gap-2">
          <button
            onClick={() => navigate('/')}
            className="text-white font-semibold text-sm mr-4 cursor-pointer hover:opacity-80 transition-opacity"
          >
            Assistente de Implantacao
          </button>
        </div>
      </div>
      <nav className="bg-ocean-120 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center overflow-x-auto">
          {NAV_LINKS.map((link) => {
            const isActive = location.pathname === link.path
              && (link.state === null || location.state?.importType === link.state?.importType);

            return (
              <button
                key={link.label}
                onClick={() => navigate(link.path, { state: link.state })}
                className={`
                  px-4 py-2.5 text-sm whitespace-nowrap cursor-pointer transition-all border-b-2
                  ${isActive
                    ? 'text-white font-medium border-white bg-ocean-150/30'
                    : 'text-white/75 border-transparent hover:text-white hover:bg-ocean-150/20'
                  }
                `}
              >
                {link.label}
              </button>
            );
          })}
        </div>
      </nav>
    </header>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <div className="h-1.5 bg-[#607B8B]" />
        <main className="px-6 py-6 max-w-7xl mx-auto">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/home" element={<Home />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/review" element={<Review />} />
            <Route path="/status" element={<Status />} />
            <Route path="/tax-rules" element={<TaxRules />} />
            <Route path="/balance-upload" element={<BalanceUpload />} />
            <Route path="/balance-status" element={<BalanceStatus />} />
            <Route path="/customer-import" element={<CustomerImport />} />
            <Route path="/vendor-import" element={<VendorImport />} />
            <Route path="/item-import" element={<ItemImport />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
