
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import App from "./App";
import SpotifyCallback from "./pages/SpotifyCallback";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        {/* Rota de retorno da autorização do Spotify */}
        <Route path="/callback" element={<SpotifyCallback />} />

        {/* Aplicativo Harmoody */}
        <Route path="*" element={<App />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
