import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { initApp } from "./state/store";
import "./styles.css";

void initApp().finally(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
