import * as readline from "node:readline";

export interface MultiSelectItem<T extends string = string> {
  id: T;
  name: string;
  description?: string;
  selected?: boolean;
}

export interface SelectItem<T extends string = string> {
  id: T;
  name: string;
  description?: string;
}

const HIDE_CURSOR = "\x1B[?25l";
const SHOW_CURSOR = "\x1B[?25h";
const COLOR_CYAN = "\x1B[36m";
const COLOR_GREEN = "\x1B[32m";
const COLOR_DIM = "\x1B[2m";
const COLOR_BOLD = "\x1B[1m";
const RESET = "\x1B[0m";

function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "");
}

function getVisualLineCount(lines: string[]): number {
  const cols = process.stdout.columns && process.stdout.columns > 0 ? process.stdout.columns : 80;
  let count = 0;
  for (const line of lines) {
    const stripped = stripAnsi(line);
    count += Math.max(1, Math.ceil(stripped.length / cols));
  }
  return count;
}

export async function multiSelectPrompt<T extends string>(options: {
  title: string;
  items: MultiSelectItem<T>[];
}): Promise<T[]> {
  const { title, items } = options;
  if (items.length === 0) return [];

  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  if (!isTTY) {
    console.log(`\n${COLOR_BOLD}${title}${RESET}`);
    items.forEach((item, index) => {
      const mark = item.selected ? "[*]" : "[ ]";
      console.log(`  ${index + 1}. ${mark} ${item.name}${item.description ? ` (${item.description})` : ""}`);
    });

    const defaultIndices = items
      .map((item, index) => (item.selected ? index + 1 : null))
      .filter((n): n is number => n !== null);

    const defaultStr = defaultIndices.length > 0 ? defaultIndices.join(",") : "1";

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question(`\nSelect agents to configure [${defaultStr}]: `, (ans) => {
        rl.close();
        resolve(ans.trim());
      });
    });

    const choiceStr = answer || defaultStr;
    const selectedIndices = choiceStr
      .split(",")
      .map((s) => parseInt(s.trim(), 10) - 1)
      .filter((n) => !Number.isNaN(n) && n >= 0 && n < items.length);

    return Array.from(new Set(selectedIndices))
      .map((i) => items[i]?.id)
      .filter((id): id is T => id !== undefined);
  }

  // Interactive Raw TTY Mode
  let cursor = 0;
  const selections = new Set<T>(
    items.filter((i) => i.selected).map((i) => i.id),
  );

  let renderedLines = 0;

  const render = () => {
    if (renderedLines > 0) {
      process.stdout.write(`\x1B[${renderedLines}A\x1B[0J`);
    }

    const lines: string[] = [];
    lines.push(`${COLOR_BOLD}${title}${RESET}`);
    lines.push(`${COLOR_DIM}  (Use arrow keys to navigate, Space to toggle, 'a' to toggle all, Enter to confirm)${RESET}`);

    items.forEach((item, index) => {
      const isCurrent = index === cursor;
      const isSelected = selections.has(item.id);
      const pointer = isCurrent ? `${COLOR_CYAN}❯${RESET}` : " ";
      const box = isSelected ? `${COLOR_GREEN}[✔]${RESET}` : `${COLOR_DIM}[ ]${RESET}`;
      const name = isCurrent ? `${COLOR_BOLD}${item.name}${RESET}` : item.name;
      const desc = item.description ? ` ${COLOR_DIM}— ${item.description}${RESET}` : "";

      lines.push(`  ${pointer} ${box} ${name}${desc}`);
    });

    renderedLines = getVisualLineCount(lines);
    process.stdout.write(lines.join("\n") + "\n");
  };

  process.stdout.write(HIDE_CURSOR);
  render();

  return new Promise<T[]>((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write(SHOW_CURSOR);
    };

    const onData = (key: string) => {
      if (key === "\u0003") {
        cleanup();
        process.exit(130);
      }

      if (key === "\r" || key === "\n") {
        cleanup();
        resolve(Array.from(selections));
        return;
      }

      if (key === "\u001B[A" || key === "k") {
        cursor = (cursor - 1 + items.length) % items.length;
        render();
        return;
      }

      if (key === "\u001B[B" || key === "j") {
        cursor = (cursor + 1) % items.length;
        render();
        return;
      }

      if (key === " ") {
        const item = items[cursor];
        if (item) {
          if (selections.has(item.id)) {
            selections.delete(item.id);
          } else {
            selections.add(item.id);
          }
          render();
        }
        return;
      }

      if (key === "a" || key === "A") {
        if (selections.size === items.length) {
          selections.clear();
        } else {
          items.forEach((i) => selections.add(i.id));
        }
        render();
      }
    };

    stdin.on("data", onData);
  });
}

export async function selectPrompt<T extends string>(options: {
  title: string;
  items: SelectItem<T>[];
  defaultIndex?: number;
}): Promise<T> {
  const { title, items, defaultIndex = 0 } = options;
  if (items.length === 0) throw new Error("No items in selectPrompt");

  const firstItem = items[0];
  if (!firstItem) throw new Error("No items in selectPrompt");

  const isTTY = Boolean(process.stdin.isTTY && process.stdout.isTTY);

  if (!isTTY) {
    console.log(`\n${COLOR_BOLD}${title}${RESET}`);
    items.forEach((item, index) => {
      console.log(`  ${index + 1}. ${item.name}${item.description ? ` (${item.description})` : ""}`);
    });

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise<string>((resolve) => {
      rl.question(`\nSelect an option [${defaultIndex + 1}]: `, (ans) => {
        rl.close();
        resolve(ans.trim());
      });
    });

    const choice = answer ? parseInt(answer, 10) - 1 : defaultIndex;
    const validChoice = choice >= 0 && choice < items.length ? choice : defaultIndex;
    const chosen = items[validChoice];
    return chosen ? chosen.id : firstItem.id;
  }

  let cursor = Math.max(0, Math.min(defaultIndex, items.length - 1));
  let renderedLines = 0;

  const render = () => {
    if (renderedLines > 0) {
      process.stdout.write(`\x1B[${renderedLines}A\x1B[0J`);
    }

    const lines: string[] = [];
    lines.push(`${COLOR_BOLD}${title}${RESET}`);
    lines.push(`${COLOR_DIM}  (Use arrow keys to navigate, Enter to confirm)${RESET}`);

    items.forEach((item, index) => {
      const isCurrent = index === cursor;
      const pointer = isCurrent ? `${COLOR_CYAN}❯${RESET}` : " ";
      const mark = isCurrent ? `${COLOR_GREEN}(●)${RESET}` : `${COLOR_DIM}( )${RESET}`;
      const name = isCurrent ? `${COLOR_BOLD}${item.name}${RESET}` : item.name;
      const desc = item.description ? ` ${COLOR_DIM}— ${item.description}${RESET}` : "";

      lines.push(`  ${pointer} ${mark} ${name}${desc}`);
    });

    renderedLines = getVisualLineCount(lines);
    process.stdout.write(lines.join("\n") + "\n");
  };

  process.stdout.write(HIDE_CURSOR);
  render();

  return new Promise<T>((resolve) => {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write(SHOW_CURSOR);
    };

    const onData = (key: string) => {
      if (key === "\u0003") {
        cleanup();
        process.exit(130);
      }

      if (key === "\r" || key === "\n") {
        cleanup();
        const chosen = items[cursor];
        resolve(chosen ? chosen.id : firstItem.id);
        return;
      }

      if (key === "\u001B[A" || key === "k") {
        cursor = (cursor - 1 + items.length) % items.length;
        render();
        return;
      }

      if (key === "\u001B[B" || key === "j") {
        cursor = (cursor + 1) % items.length;
        render();
      }
    };

    stdin.on("data", onData);
  });
}

