import { stableId, type EpgChannel, type EpgProgramme } from '@orivue/core';

export interface XmltvParseOptions {
  readonly maxElementLength?: number;
  readonly maxChannels?: number;
  readonly maxProgrammes?: number;
}

export type XmltvWarningCode =
  | 'malformed-element'
  | 'missing-attribute'
  | 'invalid-date'
  | 'missing-title'
  | 'element-too-large'
  | 'limit-reached';

export interface XmltvWarning {
  readonly code: XmltvWarningCode;
  readonly element: 'document' | 'channel' | 'programme';
  readonly message: string;
}

export interface XmltvParseResult {
  readonly channels: EpgChannel[];
  readonly programmes: EpgProgramme[];
  readonly warnings: XmltvWarning[];
}

const DEFAULT_MAX_ELEMENT_LENGTH = 2 * 1024 * 1024;
const DEFAULT_MAX_CHANNELS = 250_000;
const DEFAULT_MAX_PROGRAMMES = 2_000_000;

/**
 * Incremental, bounded-memory XMLTV parser. It deliberately recognises only
 * channel/programme records and never expands DTD entities.
 */
export class XmltvIncrementalParser {
  readonly #channels: EpgChannel[] = [];
  readonly #programmes: EpgProgramme[] = [];
  readonly #warnings: XmltvWarning[] = [];
  readonly #options: Required<XmltvParseOptions>;
  #buffer = '';
  #finished = false;
  #channelLimitWarned = false;
  #programmeLimitWarned = false;

  constructor(options: XmltvParseOptions = {}) {
    this.#options = {
      maxElementLength: options.maxElementLength ?? DEFAULT_MAX_ELEMENT_LENGTH,
      maxChannels: options.maxChannels ?? DEFAULT_MAX_CHANNELS,
      maxProgrammes: options.maxProgrammes ?? DEFAULT_MAX_PROGRAMMES,
    };
  }

  write(chunk: string): void {
    if (this.#finished) throw new Error('Cannot write after the XMLTV parser has finished.');
    this.#buffer += chunk;
    this.#process(false);
  }

  finish(): XmltvParseResult {
    if (!this.#finished) {
      this.#process(true);
      this.#finished = true;
    }
    return { channels: this.#channels, programmes: this.#programmes, warnings: this.#warnings };
  }

  #process(final: boolean): void {
    while (this.#buffer) {
      const start = findRecordStart(this.#buffer);
      if (!start) {
        this.#buffer = final ? '' : this.#buffer.slice(-32);
        return;
      }
      if (start.index > 0) this.#buffer = this.#buffer.slice(start.index);

      const openingEnd = findTagEnd(this.#buffer);
      if (openingEnd < 0) {
        if (this.#buffer.length > this.#options.maxElementLength)
          this.#discardOversized(start.kind);
        else if (final) this.#discardMalformed(start.kind);
        return;
      }
      const closingExpression = new RegExp(`<\\/${start.kind}\\s*>`, 'i');
      const closing = closingExpression.exec(this.#buffer.slice(openingEnd + 1));
      if (!closing || closing.index === undefined) {
        if (this.#buffer.length > this.#options.maxElementLength)
          this.#discardOversized(start.kind);
        else if (final) this.#discardMalformed(start.kind);
        return;
      }
      const end = openingEnd + 1 + closing.index + closing[0].length;
      if (end > this.#options.maxElementLength) {
        this.#warnings.push(
          warning(
            'element-too-large',
            start.kind,
            'An XMLTV element exceeded the configured safety limit and was skipped.',
          ),
        );
        this.#buffer = this.#buffer.slice(end);
        continue;
      }
      const record = this.#buffer.slice(0, end);
      this.#buffer = this.#buffer.slice(end);
      if (start.kind === 'channel') this.#consumeChannel(record);
      else this.#consumeProgramme(record);
    }
  }

  #discardOversized(kind: RecordKind): void {
    this.#warnings.push(
      warning(
        'element-too-large',
        kind,
        'An XMLTV element exceeded the configured safety limit and was skipped.',
      ),
    );
    this.#buffer = this.#buffer.slice(1);
  }

  #discardMalformed(kind: RecordKind): void {
    this.#warnings.push(
      warning('malformed-element', kind, 'An incomplete XMLTV element was skipped.'),
    );
    this.#buffer = '';
  }

  #consumeChannel(record: string): void {
    if (this.#channels.length >= this.#options.maxChannels) {
      if (!this.#channelLimitWarned) {
        this.#warnings.push(
          warning('limit-reached', 'channel', 'The configured channel limit was reached.'),
        );
        this.#channelLimitWarned = true;
      }
      return;
    }
    const opening = record.slice(0, findTagEnd(record) + 1);
    const attributes = parseAttributes(opening);
    const id = clean(attributes.id);
    if (!id) {
      this.#warnings.push(
        warning('missing-attribute', 'channel', 'A channel without an id attribute was skipped.'),
      );
      return;
    }
    const displayNames = childTexts(record, 'display-name');
    if (displayNames.length === 0) displayNames.push(id);
    const icon = childAttribute(record, 'icon', 'src');
    this.#channels.push({ id, displayNames, ...(icon ? { icon } : {}) });
  }

  #consumeProgramme(record: string): void {
    if (this.#programmes.length >= this.#options.maxProgrammes) {
      if (!this.#programmeLimitWarned) {
        this.#warnings.push(
          warning('limit-reached', 'programme', 'The configured programme limit was reached.'),
        );
        this.#programmeLimitWarned = true;
      }
      return;
    }
    const opening = record.slice(0, findTagEnd(record) + 1);
    const attributes = parseAttributes(opening);
    const channelId = clean(attributes.channel);
    const startValue = clean(attributes.start);
    if (!channelId || !startValue) {
      this.#warnings.push(
        warning(
          'missing-attribute',
          'programme',
          'A programme without channel or start was skipped.',
        ),
      );
      return;
    }
    const start = parseXmltvDate(startValue);
    if (!start) {
      this.#warnings.push(
        warning('invalid-date', 'programme', 'A programme with an invalid start date was skipped.'),
      );
      return;
    }
    const title = childTexts(record, 'title')[0];
    if (!title) {
      this.#warnings.push(
        warning('missing-title', 'programme', 'A programme without a title was skipped.'),
      );
      return;
    }
    const stopValue = clean(attributes.stop);
    const stop = stopValue ? parseXmltvDate(stopValue) : undefined;
    if (stopValue && !stop)
      this.#warnings.push(
        warning('invalid-date', 'programme', 'An invalid stop date was ignored.'),
      );
    const description = childTexts(record, 'desc')[0];
    const category = childTexts(record, 'category')[0];
    const icon = childAttribute(record, 'icon', 'src');
    this.#programmes.push({
      id: stableId('programme', channelId, start.toISOString(), title),
      channelId,
      start,
      ...(stop ? { stop } : {}),
      title,
      ...(description ? { description } : {}),
      ...(category ? { category } : {}),
      ...(icon ? { icon } : {}),
    });
  }
}

export function parseXmltv(input: string, options?: XmltvParseOptions): XmltvParseResult;
export function parseXmltv(
  input: AsyncIterable<string | Uint8Array>,
  options?: XmltvParseOptions,
): Promise<XmltvParseResult>;
export function parseXmltv(
  input: string | AsyncIterable<string | Uint8Array>,
  options: XmltvParseOptions = {},
): XmltvParseResult | Promise<XmltvParseResult> {
  if (typeof input === 'string') {
    const parser = new XmltvIncrementalParser(options);
    parser.write(input.replace(/^\uFEFF/, ''));
    return parser.finish();
  }
  return parseXmltvStream(input, options);
}

export async function parseXmltvStream(
  input: AsyncIterable<string | Uint8Array>,
  options: XmltvParseOptions = {},
): Promise<XmltvParseResult> {
  const parser = new XmltvIncrementalParser(options);
  const decoder = new TextDecoder('utf-8', { fatal: false });
  for await (const chunk of input) {
    parser.write(typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true }));
  }
  const remainder = decoder.decode();
  if (remainder) parser.write(remainder);
  return parser.finish();
}

/** Parses an XMLTV timestamp into an absolute instant. Missing offsets are treated as UTC. */
export function parseXmltvDate(value: string): Date | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?(?:\s*(Z|[+-]\d{4}))?$/.exec(
    value.trim(),
  );
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] ?? '0');
  const zone = match[7] ?? 'Z';
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59)
    return undefined;
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const zoneHours = Number(zone.slice(1, 3));
    const zoneMinutes = Number(zone.slice(3, 5));
    if (zoneHours > 23 || zoneMinutes > 59) return undefined;
    offsetMinutes = (zoneHours * 60 + zoneMinutes) * (zone.startsWith('-') ? -1 : 1);
  }
  const timestamp = Date.UTC(year, month - 1, day, hour, minute, second) - offsetMinutes * 60_000;
  const date = new Date(timestamp);
  // Validate the calendar date independently of timezone rollover.
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  )
    return undefined;
  return date;
}

type RecordKind = 'channel' | 'programme';

function findRecordStart(value: string): { index: number; kind: RecordKind } | undefined {
  const channel = value.search(/<channel(?:\s|>)/i);
  const programme = value.search(/<programme(?:\s|>)/i);
  if (channel < 0 && programme < 0) return undefined;
  if (channel >= 0 && (programme < 0 || channel < programme))
    return { index: channel, kind: 'channel' };
  return { index: programme, kind: 'programme' };
}

function findTagEnd(value: string): number {
  let quote = '';
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? '';
    if ((character === '"' || character === "'") && (!quote || quote === character))
      quote = quote ? '' : character;
    else if (character === '>' && !quote) return index;
  }
  return -1;
}

function parseAttributes(openingTag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const expression = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (const match of openingTag.matchAll(expression)) {
    const key = match[1]?.toLowerCase();
    const value = match[2] ?? match[3];
    if (key && value !== undefined) attributes[key] = decodeXml(value);
  }
  return attributes;
}

function childTexts(record: string, tag: string): string[] {
  const values: string[] = [];
  const expression = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}\\s*>`, 'gi');
  for (const match of record.matchAll(expression)) {
    const content = match[1];
    if (content === undefined) continue;
    const value = clean(decodeXml(stripMarkup(content)));
    if (value) values.push(value);
  }
  return values;
}

function childAttribute(record: string, tag: string, attribute: string): string | undefined {
  const expression = new RegExp(
    `<${tag}(?:\\s[^>]*?)?\\s${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')[^>]*?\\/?>`,
    'i',
  );
  const match = expression.exec(record);
  return clean(decodeXml(match?.[1] ?? match?.[2] ?? ''));
}

function stripMarkup(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, '');
}

function decodeXml(value: string): string {
  return value.replace(
    /&(?:#(\d{1,7})|#x([a-f\d]{1,6})|(amp|apos|gt|lt|quot));/gi,
    (
      _whole,
      decimal: string | undefined,
      hexadecimal: string | undefined,
      named: string | undefined,
    ) => {
      if (decimal || hexadecimal) {
        const point = Number.parseInt(decimal ?? hexadecimal ?? '', decimal ? 10 : 16);
        return Number.isSafeInteger(point) && point > 0 && point <= 0x10ffff
          ? String.fromCodePoint(point)
          : '�';
      }
      return (
        ({ amp: '&', apos: "'", gt: '>', lt: '<', quot: '"' } as Record<string, string>)[
          named?.toLowerCase() ?? ''
        ] ?? ''
      );
    },
  );
}

function clean(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const result = [...value]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127);
    })
    .join('')
    .trim()
    .replace(/\s+/g, ' ');
  return result || undefined;
}

function warning(
  code: XmltvWarningCode,
  element: XmltvWarning['element'],
  message: string,
): XmltvWarning {
  return { code, element, message };
}

export type { EpgChannel, EpgProgramme } from '@orivue/core';
