import { readFile } from "node:fs/promises";
import {
  buildSignalQualityMarkdownReport,
  evaluateDefaultSignalQualityFixtures,
  evaluateSignalQualityBatch,
} from "../modules/ai/signal-quality-evaluator.js";
import type { SignalQualityReportItemInput } from "../modules/ai/signal-quality-evaluator.js";

type SignalQualityCliArgs =
  | {
      type: "default";
    }
  | {
      text: string;
      type: "text";
    }
  | {
      filePath: string;
      type: "file";
    }
  | {
      type: "help";
    };

const usage = `Usage:
  npm --workspace @unfreq/api run ai:signals:evaluate
  npm --workspace @unfreq/api run ai:signals:evaluate -- --text <signal-text>
  npm --workspace @unfreq/api run ai:signals:evaluate -- --file <path>

File input accepts:
  - a JSON array of strings
  - a JSON array of { "fixtureName": "...", "seedText": "...", "text": "..." }
  - plain text blocks separated by blank lines`;

function parseArgs(argv: string[]): SignalQualityCliArgs {
  if (argv.length === 0) {
    return { type: "default" };
  }

  if (argv.includes("--help") || argv.includes("-h")) {
    return { type: "help" };
  }

  const textIndex = argv.indexOf("--text");
  if (textIndex >= 0) {
    const text = argv[textIndex + 1];

    if (text === undefined || text.trim().length === 0) {
      throw new Error("--text requires a non-empty value.");
    }

    return {
      text,
      type: "text",
    };
  }

  const fileIndex = argv.indexOf("--file");
  if (fileIndex >= 0) {
    const filePath = argv[fileIndex + 1];

    if (filePath === undefined || filePath.trim().length === 0) {
      throw new Error("--file requires a path.");
    }

    return {
      filePath,
      type: "file",
    };
  }

  throw new Error(usage);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonItems(value: unknown): SignalQualityReportItemInput[] {
  if (!Array.isArray(value)) {
    throw new Error("JSON file must contain an array.");
  }

  return value.map((item, index) => {
    if (typeof item === "string") {
      return {
        fixtureName: `supplied-${index + 1}`,
        text: item,
      };
    }

    if (
      isRecord(item) &&
      typeof item.text === "string" &&
      (item.fixtureName === undefined || typeof item.fixtureName === "string") &&
      (item.seedText === undefined || typeof item.seedText === "string")
    ) {
      return {
        fixtureName: item.fixtureName ?? `supplied-${index + 1}`,
        seedText: item.seedText,
        text: item.text,
      };
    }

    throw new Error("JSON items must be strings or objects with a text field.");
  });
}

async function readFileItems(filePath: string): Promise<SignalQualityReportItemInput[]> {
  const content = await readFile(filePath, "utf8");
  const trimmed = content.trim();

  if (trimmed.length === 0) {
    return [];
  }

  if (trimmed.startsWith("[")) {
    return parseJsonItems(JSON.parse(trimmed) as unknown);
  }

  return trimmed
    .split(/\n\s*\n/u)
    .map((text) => text.trim())
    .filter((text) => text.length > 0)
    .map((text, index) => {
      return {
        fixtureName: `supplied-${index + 1}`,
        text,
      };
    });
}

function printReport(report: string): void {
  process.stdout.write(`${report}\n`);
}

try {
  const args = parseArgs(process.argv.slice(2));

  if (args.type === "help") {
    printReport(usage);
  } else if (args.type === "default") {
    printReport(buildSignalQualityMarkdownReport(evaluateDefaultSignalQualityFixtures()));
  } else if (args.type === "text") {
    printReport(
      buildSignalQualityMarkdownReport(
        evaluateSignalQualityBatch([
          {
            fixtureName: "supplied-text",
            text: args.text,
          },
        ]),
      ),
    );
  } else {
    printReport(
      buildSignalQualityMarkdownReport(
        evaluateSignalQualityBatch(await readFileItems(args.filePath)),
      ),
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error.";

  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
