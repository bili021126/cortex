/**
 * 聊天窗口入口
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { ChatView } from "./ChatView";
import "../ui/tokens.css";
import "../ui/fonts.css";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root not found");

createRoot(rootEl).render(<ChatView onClose={() => window.close()} />);
