import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { Ask } from "../components/Ask.tsx";

const ISSUE_ACCENT = "--issue-accent";

function takeIssueTheme(host: HTMLElement): void {
  const issue = document.querySelector<HTMLElement>("article[data-palette]");
  if (issue === null) return;
  const { palette, fonts } = issue.dataset;
  if (palette !== undefined) host.dataset["palette"] = palette;
  if (fonts !== undefined) host.dataset["fonts"] = fonts;
  const accent = issue.style.getPropertyValue(ISSUE_ACCENT);
  if (accent !== "") host.style.setProperty(ISSUE_ACCENT, accent);
}

export function startAsk(endpoint: string): void {
  const host = document.createElement("div");
  takeIssueTheme(host);
  document.body.append(host);
  createRoot(host).render(createElement(Ask, { endpoint }));
}
