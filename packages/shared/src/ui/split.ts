import { TG } from "../constants.js";
import { en } from "../i18n/en.js";

export type SplitOptions = {
  /** Repeated at the top of every part, before its `Part 2/3`. */
  header?: string;
  /** Repeated at the end of every part: the warning of the keys message (V1-43). */
  footer?: string;
  /** Characters of one message: Telegram's 4096 by default. */
  limit?: number;
};

const BLOCKS = "\n\n";
const LINES = "\n";
const ELLIPSIS = "…";

const joined = (parts: (string | undefined)[]): string =>
  parts.filter((part): part is string => part !== undefined && part !== "").join(BLOCKS);

/**
 * A line longer than a whole message (it never happens with the screens of the bot): its tags
 * are dropped, so nothing is left open, and it is cut before an entity it would split.
 */
function truncateLine(line: string, room: number): string {
  const text = line.replace(/<[^>]*>/g, "");
  if (text.length <= room) return text;
  let cut = text.slice(0, room - ELLIPSIS.length);
  const entity = cut.lastIndexOf("&");
  if (entity !== -1 && !cut.slice(entity).includes(";")) cut = cut.slice(0, entity);
  return `${cut}${ELLIPSIS}`;
}

/** A block too long for one part: cut between its lines. */
function splitBlock(block: string, room: number): string[] {
  const pieces: string[] = [];
  let current = "";
  for (const raw of block.split(LINES)) {
    const line = raw.length <= room ? raw : truncateLine(raw, room);
    const next = current === "" ? line : `${current}${LINES}${line}`;
    if (next.length <= room) {
      current = next;
    } else {
      pieces.push(current);
      current = line;
    }
  }
  if (current !== "") pieces.push(current);
  return pieces;
}

/**
 * A message of HTML blocks (a screen of /getall, the wallet keys of V1-43) as one or more
 * Telegram messages. The raw HTML is measured, a safe upper bound of what Telegram counts. The
 * cuts fall between blocks, then between the lines of a block too long, never inside a tag:
 * every block closes its own tags. When there are several parts, each one repeats the header,
 * says `Part 2/3`, and ends with the footer.
 */
export function splitHtmlMessage(blocks: readonly string[], options: SplitOptions = {}): string[] {
  const { header, footer, limit = TG.MESSAGE_MAX_CHARS } = options;
  const whole = joined([header, ...blocks, footer]);
  if (whole.length <= limit) return [whole];

  // Room for the body of a part: the frame is measured with the widest part label.
  const frame = joined([header, en.common.part(99, 99), footer]);
  const room = limit - frame.length - BLOCKS.length;
  if (room <= 0) throw new RangeError("The header and the footer leave no room for a message");

  const pieces = blocks.flatMap((block) =>
    block.length <= room ? [block] : splitBlock(block, room),
  );
  const bodies: string[] = [];
  let current = "";
  for (const piece of pieces) {
    if (piece === "") continue;
    const next = current === "" ? piece : `${current}${BLOCKS}${piece}`;
    if (next.length <= room) {
      current = next;
    } else {
      bodies.push(current);
      current = piece;
    }
  }
  if (current !== "") bodies.push(current);
  return bodies.map((body, index) =>
    joined([header, en.common.part(index + 1, bodies.length), body, footer]),
  );
}
