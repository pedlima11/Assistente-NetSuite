import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import ptCommon from './locales/pt/common.json';
import ptHome from './locales/pt/home.json';
import ptSettings from './locales/pt/settings.json';
import ptUpload from './locales/pt/upload.json';
import ptReview from './locales/pt/review.json';
import ptStatus from './locales/pt/status.json';
import enCommon from './locales/en/common.json';
import enHome from './locales/en/home.json';
import enSettings from './locales/en/settings.json';
import enUpload from './locales/en/upload.json';
import enReview from './locales/en/review.json';
import enStatus from './locales/en/status.json';
import esCommon from './locales/es/common.json';
import esHome from './locales/es/home.json';
import esSettings from './locales/es/settings.json';
import esUpload from './locales/es/upload.json';
import esReview from './locales/es/review.json';
import esStatus from './locales/es/status.json';
import ptBalance from './locales/pt/balance.json';
import ptCustomer from './locales/pt/customer.json';
import ptVendor from './locales/pt/vendor.json';
import ptItem from './locales/pt/item.json';
import enBalance from './locales/en/balance.json';
import enCustomer from './locales/en/customer.json';
import enVendor from './locales/en/vendor.json';
import enItem from './locales/en/item.json';
import esBalance from './locales/es/balance.json';
import esCustomer from './locales/es/customer.json';
import esVendor from './locales/es/vendor.json';
import esItem from './locales/es/item.json';
import ptTax from './locales/pt/tax.json';
import enTax from './locales/en/tax.json';
import esTax from './locales/es/tax.json';

i18n.use(initReactI18next).init({
  resources: {
    pt: { common: ptCommon, home: ptHome, settings: ptSettings, upload: ptUpload, review: ptReview, status: ptStatus, balance: ptBalance, customer: ptCustomer, vendor: ptVendor, item: ptItem, tax: ptTax },
    en: { common: enCommon, home: enHome, settings: enSettings, upload: enUpload, review: enReview, status: enStatus, balance: enBalance, customer: enCustomer, vendor: enVendor, item: enItem, tax: enTax },
    es: { common: esCommon, home: esHome, settings: esSettings, upload: esUpload, review: esReview, status: esStatus, balance: esBalance, customer: esCustomer, vendor: esVendor, item: esItem, tax: esTax },
  },
  lng: localStorage.getItem('i18n-lang') || 'pt',
  fallbackLng: 'pt',
  ns: ['common', 'home', 'settings', 'upload', 'review', 'status', 'balance', 'customer', 'vendor', 'item', 'tax'],
  defaultNS: 'common',
  interpolation: { escapeValue: false },
});

i18n.on('languageChanged', (lng) => {
  localStorage.setItem('i18n-lang', lng);
});

export default i18n;
