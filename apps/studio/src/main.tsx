import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
// The kit's stylesheet first, and it is prebuilt — a Tailwind bundle carrying
// its own tokens and only the utilities it uses. Studio has no Tailwind build
// and does not need one; `styles.css` is hand-written on those tokens and comes
// second so it can override them.
import "@pipecat-ai/voice-ui-kit/styles";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
