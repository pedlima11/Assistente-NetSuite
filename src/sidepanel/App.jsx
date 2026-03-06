import React from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
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

const NAV_LINK_KEYS = [
  { key: 'nav.home', path: '/', state: null },
  { key: 'nav.settings', path: '/settings', state: null },
  { key: 'nav.chartOfAccounts', path: '/upload', state: { importType: 'plano-de-contas' } },
  { key: 'nav.dre', path: '/upload', state: { importType: 'dre' } },
  { key: 'nav.balance', path: '/upload', state: { importType: 'balanco' } },
  { key: 'nav.openingBalances', path: '/balance-upload', state: null },
  { key: 'nav.taxRules', path: '/tax-rules', state: null },
  { key: 'nav.customers', path: '/customer-import', state: null },
  { key: 'nav.vendors', path: '/vendor-import', state: null },
  { key: 'nav.items', path: '/item-import', state: null },
];

const LANGUAGES = [
  { code: 'pt', label: 'PT' },
  { code: 'en', label: 'EN' },
  { code: 'es', label: 'ES' },
];

function LanguageSwitcher() {
  const { i18n } = useTranslation();

  return (
    <div className="fixed top-2 right-3 z-50 flex gap-0.5 bg-white/90 backdrop-blur rounded-md shadow-sm border border-ocean-30 p-0.5">
      {LANGUAGES.map(({ code, label }) => (
        <button
          key={code}
          onClick={() => i18n.changeLanguage(code)}
          className={`
            px-2 py-1 text-xs font-medium rounded transition-colors cursor-pointer
            ${i18n.language === code
              ? 'bg-ocean-120 text-white'
              : 'text-ocean-60 hover:text-ocean-120 hover:bg-ocean-10'
            }
          `}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function NavBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation();

  return (
    <header className="hidden">
      <div className="bg-ocean-150 px-6 py-2">
        <div className="max-w-7xl mx-auto flex items-center gap-2">
          <button
            onClick={() => navigate('/')}
            className="text-white font-semibold text-sm mr-4 cursor-pointer hover:opacity-80 transition-opacity"
          >
            {t('assistantTitle')}
          </button>
        </div>
      </div>
      <nav className="bg-ocean-120 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center overflow-x-auto">
          {NAV_LINK_KEYS.map((link) => {
            const isActive = location.pathname === link.path
              && (link.state === null || location.state?.importType === link.state?.importType);

            return (
              <button
                key={link.key}
                onClick={() => navigate(link.path, { state: link.state })}
                className={`
                  px-4 py-2.5 text-sm whitespace-nowrap cursor-pointer transition-all border-b-2
                  ${isActive
                    ? 'text-white font-medium border-white bg-ocean-150/30'
                    : 'text-white/75 border-transparent hover:text-white hover:bg-ocean-150/20'
                  }
                `}
              >
                {t(link.key)}
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
        <LanguageSwitcher />
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
