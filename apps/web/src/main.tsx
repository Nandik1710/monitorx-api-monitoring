import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App.js";
import "./styles.css";

const root = document.querySelector("#root");

if (!root) {
  throw new Error("Monitor-X web root was not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
