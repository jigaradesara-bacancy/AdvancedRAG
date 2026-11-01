import { NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard.jsx';
import DocumentDetail from './pages/DocumentDetail.jsx';
import Chat from './pages/Chat.jsx';
import Evaluation from './pages/Evaluation.jsx';

export default function App() {
  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">Advanced RAG</div>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/chat">Chat</NavLink>
          {/* <NavLink to="/evaluation">Evaluation</NavLink> */}
        </nav>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/documents/:id" element={<DocumentDetail />} />
          <Route path="/chat" element={<Chat />} />
          {/* <Route path="/evaluation" element={<Evaluation />} /> */}
        </Routes>
      </main>
    </div>
  );
}
