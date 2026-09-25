import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

// §14 (V1-46): every text the bot or the worker shows lives in packages/shared/src/i18n/en.ts.
// Two rules on the source, run by `pnpm check:i18n` and by the test next to this file:
//   sent      a literal with letters handed to Telegram, to a screen or to a button;
//   sentence  a sentence written anywhere else than an error, a log, SQL or a zod issue.

export type Finding = { file: string; line: number; rule: "sent" | "sentence"; text: string };

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** Where texts for Telegram are built: the bot, the worker, and the screens of shared. */
export const SCANNED = ["apps/bot/src", "apps/worker/src", "packages/shared/src"];

const SKIPPED = [
  /\.test\.ts$/,
  /test-harness\.ts$/,
  /test-helpers?\//,
  // The texts themselves.
  /^packages\/shared\/src\/i18n\//,
  // Node side of shared: the env schema and the logger speak to the operator, not to users.
  /^packages\/shared\/src\/server\//,
  // The vocabulary of the token generator (V1-15) is the content it draws from, not a text.
  /^packages\/shared\/src\/token\/words\.ts$/,
  // The command line of the worker's manual jobs (V1-45): a terminal, not Telegram.
  /^apps\/worker\/src\/run-job\.ts$/,
];

const ALL = "all";

/**
 * Calls that put a text in front of a user, and which of their arguments hold it: every one
 * for the Bot API, the text alone for the helpers of the bot (a command name, an event name or
 * a callback beside it is not a text).
 */
const TEXT_CALLS = new Map<string, typeof ALL | number[]>([
  ["reply", ALL],
  ["replyWithPhoto", ALL],
  ["replyWithAnimation", ALL],
  ["replyWithDocument", ALL],
  ["sendMessage", ALL],
  ["sendPhoto", ALL],
  ["sendAnimation", ALL],
  ["sendDocument", ALL],
  ["editMessageText", ALL],
  ["editMessageCaption", ALL],
  ["editMessageMedia", ALL],
  ["answerCallbackQuery", ALL],
  ["setMyCommands", ALL],
  ["setMyDescription", ALL],
  ["setMyShortDescription", ALL],
  ["renderScreen", [0]],
  ["renderInputScreen", [0]],
  ["screenOf", [0]],
  ["tree", [0, 1]],
  ["cbBtn", [0]],
  ["urlBtn", [0]],
  ["webAppBtn", [0]],
  ["notify", [1]],
  ["acknowledge", [1]],
  ["tellUser", [2]],
  ["renderAdminNotice", [2]],
]);

/** In an object handed to one of these calls, the keys whose value a user reads. */
const TEXT_KEYS = new Set([
  "text",
  "caption",
  "header",
  "description",
  "info",
  "flags",
  "footer",
  "prompt",
  "rules",
  "current",
  "title",
  "alert",
  "flag",
]);

const LOG_METHODS = new Set(["trace", "debug", "info", "warn", "error", "fatal"]);
const HAS_LETTER = /\p{L}/u;
/** Two words at least: `X community`, `Pick one`. A URL, a tag or an event name has no space. */
const SENTENCE = /\p{L}+[^\p{L}\n]*\s[^\p{L}\n]*\p{L}{2,}/u;

type Literal = ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression;

const isLiteral = (node: ts.Node): node is Literal =>
  ts.isStringLiteral(node) ||
  ts.isNoSubstitutionTemplateLiteral(node) ||
  ts.isTemplateExpression(node);

/** The written part of a literal: a template with `{}` where its `${…}` go. */
const writtenText = (node: Literal): string =>
  ts.isTemplateExpression(node)
    ? [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join("{}")
    : node.text;

const calleeName = (call: ts.CallExpression | ts.NewExpression): string | undefined => {
  const callee = call.expression;
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return undefined;
};

/** The literals of an argument that end up on the screen, as they are or through a branch. */
function shownLiterals(expr: ts.Expression): Literal[] {
  if (isLiteral(expr)) return [expr];
  if (
    ts.isParenthesizedExpression(expr) ||
    ts.isAsExpression(expr) ||
    ts.isSatisfiesExpression(expr) ||
    ts.isNonNullExpression(expr)
  ) {
    return shownLiterals(expr.expression);
  }
  if (ts.isConditionalExpression(expr)) {
    return [...shownLiterals(expr.whenTrue), ...shownLiterals(expr.whenFalse)];
  }
  if (ts.isBinaryExpression(expr)) {
    switch (expr.operatorToken.kind) {
      case ts.SyntaxKind.PlusToken:
      case ts.SyntaxKind.BarBarToken:
      case ts.SyntaxKind.QuestionQuestionToken:
        return [...shownLiterals(expr.left), ...shownLiterals(expr.right)];
      // `condition && text`: an optional line (`OptionalLine`), the condition is not shown.
      case ts.SyntaxKind.AmpersandAmpersandToken:
        return shownLiterals(expr.right);
      default:
        return [];
    }
  }
  if (ts.isArrayLiteralExpression(expr)) {
    return expr.elements.flatMap((element) =>
      shownLiterals(ts.isSpreadElement(element) ? element.expression : element),
    );
  }
  if (ts.isObjectLiteralExpression(expr)) {
    return expr.properties.flatMap((property) =>
      ts.isPropertyAssignment(property) &&
      (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
      TEXT_KEYS.has(property.name.text)
        ? shownLiterals(property.initializer)
        : [],
    );
  }
  return [];
}

/** An error, a log line, SQL, a zod issue: text for developers and operators only. */
function isTechnical(node: ts.Node): boolean {
  for (let parent = node.parent; !ts.isSourceFile(parent); parent = parent.parent) {
    if (ts.isNewExpression(parent) && /Error$/.test(calleeName(parent) ?? "")) return true;
    // The message of an error class: `super(…)` in `class …Error`.
    if (ts.isClassDeclaration(parent) && /Error$/.test(parent.name?.text ?? "")) return true;
    if (ts.isTaggedTemplateExpression(parent)) return true;
    if (!ts.isCallExpression(parent)) continue;
    const name = calleeName(parent) ?? "";
    const callee = parent.expression;
    if (
      LOG_METHODS.has(name) &&
      ts.isPropertyAccessExpression(callee) &&
      /log/i.test(callee.expression.getText())
    ) {
      return true;
    }
    if (["createLogger", "query", "addIssue", "refine", "superRefine"].includes(name)) return true;
  }
  return false;
}

/** The findings of one file. */
export function findTexts(fileName: string, source: string): Finding[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const findings: Finding[] = [];
  const sent = new Set<ts.Node>();
  const report = (node: Literal, rule: Finding["rule"]) =>
    findings.push({
      file: fileName,
      line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
      rule,
      text: writtenText(node),
    });

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node) || ts.isTypeNode(node)) {
      return;
    }
    const texts = ts.isCallExpression(node) ? TEXT_CALLS.get(calleeName(node) ?? "") : undefined;
    if (texts !== undefined && ts.isCallExpression(node)) {
      const args = node.arguments.filter((_, index) => texts === ALL || texts.includes(index));
      for (const literal of args.flatMap(shownLiterals)) {
        if (!HAS_LETTER.test(writtenText(literal))) continue;
        sent.add(literal);
        report(literal, "sent");
      }
    }
    if (
      isLiteral(node) &&
      !sent.has(node) &&
      // Markup is not a sentence: `<a href="…">` has a space, and no word of the user.
      SENTENCE.test(writtenText(node).replace(/<[^>]*>/g, "")) &&
      !isTechnical(node)
    ) {
      report(node, "sentence");
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return findings;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = `${dir}/${name}`;
    if (statSync(join(ROOT, path)).isDirectory()) return sourceFiles(path);
    return name.endsWith(".ts") && !SKIPPED.some((skip) => skip.test(path)) ? [path] : [];
  });
}

/** Every finding of the scanned folders: empty when the texts all come from en.ts. */
export function checkI18n(): Finding[] {
  return SCANNED.flatMap(sourceFiles).flatMap((path) =>
    findTexts(path, readFileSync(join(ROOT, path), "utf8")),
  );
}

// `pnpm check:i18n`
if (
  process.argv[1] !== undefined &&
  relative(process.argv[1], fileURLToPath(import.meta.url)) === ""
) {
  const findings = checkI18n();
  for (const { file, line, rule, text } of findings) {
    process.stderr.write(`${file}:${line}  ${rule}  ${JSON.stringify(text)}\n`);
  }
  process.stdout.write(
    findings.length === 0
      ? "check:i18n: every text comes from packages/shared/src/i18n/en.ts\n"
      : `check:i18n: ${findings.length} text(s) outside en.ts\n`,
  );
  process.exitCode = findings.length === 0 ? 0 : 1;
}
