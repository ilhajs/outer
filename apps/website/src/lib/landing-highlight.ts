import { createHighlighter, type Highlighter } from "shiki";

let highlighterPromise: Promise<Highlighter> | undefined;

function getHighlighter() {
  highlighterPromise ??= createHighlighter({
    themes: ["github-light", "github-dark"],
    langs: ["tsx", "ts", "typescript", "shell", "bash"],
  });
  return highlighterPromise;
}

export async function highlightLandingCode(
  code: string,
  lang: "tsx" | "ts" | "typescript" | "shell" | "bash" = "ts",
): Promise<string> {
  const highlighter = await getHighlighter();
  return highlighter.codeToHtml(code, {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
    transformers: [
      {
        pre(hast) {
          this.addClassToHast(hast, "astro-code");
        },
      },
    ],
  });
}
