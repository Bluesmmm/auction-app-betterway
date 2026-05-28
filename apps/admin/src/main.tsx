import React from "react";
import { createRoot } from "react-dom/client";
import { AdminApp } from "./App.js";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("admin root element is missing");
}

createRoot(rootElement).render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>
);
