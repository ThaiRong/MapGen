import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import PlayerApp from "./components/PlayerApp";
import { initApp } from "./state/store";
import "./styles.css";

// Окно игрока (итерация 8) — тот же фронтенд в режиме ?player=1:
// только просмотр проекции, без инструментов, дерева и заметок.
const isPlayerWindow = new URLSearchParams(window.location.search).get("player") === "1";

if (isPlayerWindow) {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <PlayerApp />
    </React.StrictMode>,
  );
} else {
  void initApp().finally(() => {
    ReactDOM.createRoot(document.getElementById("root")!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  });
}
