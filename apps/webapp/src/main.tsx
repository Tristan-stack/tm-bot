import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initTelegramWebApp } from "./telegram";
import "./styles.css";

const container = document.getElementById("root");
if (container === null) throw new Error("#root element is missing from index.html");

initTelegramWebApp();

createRoot(container).render(
  <StrictMode>
    <App path={window.location.pathname} />
  </StrictMode>,
);
