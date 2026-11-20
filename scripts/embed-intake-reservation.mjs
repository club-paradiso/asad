import { readFileSync, writeFileSync } from "node:fs";

const htmlFile = new URL("../apps/visitor-intake/index.html", import.meta.url);
const js = readFileSync(new URL("../public/compat/reservation.js", import.meta.url), "utf8");
const style = readFileSync(new URL("../public/compat/style.css", import.meta.url), "utf8");
const css = style.split("/* BEGIN RESERVATION STYLES */\n")[1].split("/* END RESERVATION STYLES */")[0];
let html = readFileSync(htmlFile, "utf8");

for (const [kind, source] of [["JS", js], ["CSS", css]]) {
  const start = "/* BEGIN EMBEDDED RESERVATION " + kind + " */\n";
  const end = "/* END EMBEDDED RESERVATION " + kind + " */";
  const from = html.indexOf(start);
  const to = html.indexOf(end, from + start.length);
  if (from < 0 || to < 0) throw new Error("Missing embedded reservation " + kind + " markers");
  html = html.slice(0, from + start.length) + source + html.slice(to);
}

if (process.argv.includes("--check")) {
  if (readFileSync(htmlFile, "utf8") !== html) {
    throw new Error("Regenerate the embedded keypad with node scripts/embed-intake-reservation.mjs");
  }
} else {
  writeFileSync(htmlFile, html);
}
