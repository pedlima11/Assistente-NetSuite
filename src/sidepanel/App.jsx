import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import Home from './pages/Home.jsx';
import Settings from './pages/Settings.jsx';
import Upload from './pages/Upload.jsx';
import Review from './pages/Review.jsx';
import Status from './pages/Status.jsx';

export default function App() {
  return (
    <MemoryRouter>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-ocean-120 px-4 py-3 shadow-sm">
          <h1 className="text-base font-semibold text-white tracking-wide">
            Assistente de Implantacao
          </h1>
        </header>
        <main className="p-4">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/home" element={<Home />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/upload" element={<Upload />} />
            <Route path="/review" element={<Review />} />
            <Route path="/status" element={<Status />} />
          </Routes>
        </main>
      </div>
    </MemoryRouter>
  );
}
