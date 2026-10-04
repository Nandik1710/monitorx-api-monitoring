import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app/App.js";
import "./styles.css";
import "@fontsource-variable/source-code-pro";
import "@fontsource-variable/source-serif-4";

try {
  document.documentElement.classList.toggle(
    "dark",
    localStorage.getItem("monitorx.theme.v1") !== "light",
  );
} catch {
  document.documentElement.classList.add("dark");
}

const root = document.querySelector("#root");

if (!root) {
  throw new Error("Monitor-X web root was not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
