"use strict";

const sample = Object.freeze({
  query: "今年有哪些值得关注的开源浏览器项目",
  summary: "这份录制示例呈现了三个不同方向：Chromium 系 Agent 浏览器、面向 Agent 协作的浏览器，以及 Firefox 系极简浏览器。项目现状与许可请以打开后的原始仓库为准。",
  results: [
    { title: "BrowserOS", url: "https://github.com/browseros-ai/BrowserOS", site: "github.com", description: "开源浏览器项目仓库。打开原页查看目前的实现、许可和发布情况。" },
    { title: "ego lite", url: "https://github.com/citrolabs/ego-lite", site: "github.com", description: "面向人与 Agent 并行浏览的项目仓库。打开原页核对其工作方式。" },
    { title: "Zen Browser", url: "https://github.com/zen-browser/desktop", site: "github.com", description: "Firefox 系浏览器项目仓库。打开原页查看设计方向与当前版本。" },
  ],
});

const form = document.querySelector("#search-form");
const queryField = document.querySelector("#query");
const summaryText = document.querySelector("#summary-text");
const summaryFootnote = document.querySelector("#summary-footnote");
const contextLabel = document.querySelector("#context-label");
const resultCount = document.querySelector("#result-count");
const resultList = document.querySelector("#result-list");
const emptyState = document.querySelector("#empty-state");
const externalSearch = document.querySelector("#external-search");
let summaryTimer;

function safeURL(raw) {
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new TypeError("Expected an HTTPS result URL");
  return url.href;
}

function resultItem(hit) {
  const item = document.createElement("li");
  item.className = "result";
  const link = document.createElement("a");
  link.href = safeURL(hit.url);
  link.innerHTML = "<div class='result-top'><span class='result-icon' aria-hidden='true'>↗</span><span class='result-site'></span></div><div class='result-title'><strong></strong><span aria-hidden='true'>↗</span></div><p class='result-description'></p>";
  link.querySelector(".result-site").textContent = hit.site;
  link.querySelector("strong").textContent = hit.title;
  link.querySelector(".result-description").textContent = hit.description;
  link.setAttribute("aria-label", `${hit.title}，打开原始页面`);
  item.append(link);
  return item;
}

function showSample() {
  clearTimeout(summaryTimer);
  queryField.value = sample.query;
  contextLabel.textContent = "从你的问题开始";
  resultList.replaceChildren(...sample.results.map(resultItem));
  resultCount.textContent = String(sample.results.length).padStart(2, "0");
  emptyState.hidden = true;
  summaryText.textContent = "正在整理已有结果…";
  summaryFootnote.textContent = "仅基于搜索摘要，尚未核对原文";
  summaryTimer = setTimeout(() => { summaryText.textContent = sample.summary; }, 750);
}

function showEmpty(query) {
  clearTimeout(summaryTimer);
  contextLabel.textContent = `当前问题：${query || "空查询"}`;
  resultList.replaceChildren();
  resultCount.textContent = "00";
  emptyState.hidden = false;
  summaryText.textContent = "没有可用的录制结果；请直接查看原始网页或使用外部搜索。";
  summaryFootnote.textContent = "本页是交互原型，不执行在线检索";
  const searchURL = new URL("https://www.bing.com/search");
  searchURL.searchParams.set("q", query);
  externalSearch.href = searchURL.href;
}

form.addEventListener("submit", event => {
  event.preventDefault();
  const query = queryField.value.trim();
  if (query === sample.query) showSample();
  else showEmpty(query);
});
document.querySelector("#simulate-summary-failure").addEventListener("click", () => {
  clearTimeout(summaryTimer);
  summaryText.textContent = "总结暂不可用；下面的结果仍可直接打开。";
  summaryFootnote.textContent = "模型失败不会阻止浏览";
});
document.querySelector("#simulate-empty").addEventListener("click", () => showEmpty(queryField.value.trim()));
document.querySelector("#restore").addEventListener("click", showSample);
showSample();
