import { strToU8, zipSync } from "fflate";

import type {
  DailyLog,
  Entry,
  Person,
  Thread,
} from "@/lib/contracts";

type VaultExport = {
  entries: Entry[];
  threads: Thread[];
  people: Person[];
  logs: DailyLog[];
};

function safeName(value: string) {
  const cleaned = value
    .replace(/[<>:"/\\|?*[\]#^\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120)
    .replace(/[. ]+$/g, "");
  return /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(cleaned)
    ? `_${cleaned}`
    : cleaned;
}

function yamlString(value: string) {
  return JSON.stringify(value);
}

function uniqueThreadFiles(threads: Thread[]) {
  const used = new Set<string>();
  const files = new Map<string, string>();

  for (const thread of threads.filter((item) => !item.deletedAt)) {
    const base = safeName(thread.title) || thread.slug;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate.toLocaleLowerCase("en-US"))) {
      candidate = `${base} (${suffix})`;
      suffix += 1;
    }
    used.add(candidate.toLocaleLowerCase("en-US"));
    files.set(thread.slug, candidate);
  }

  return files;
}

function uniquePersonFiles(people: Person[]) {
  const used = new Set<string>();
  const files = new Map<string, string>();

  for (const person of people) {
    const base = safeName(person.name) || person.slug;
    let candidate = base;
    let suffix = 2;
    while (used.has(candidate.toLocaleLowerCase("en-US"))) {
      candidate = `${base} (${suffix})`;
      suffix += 1;
    }
    used.add(candidate.toLocaleLowerCase("en-US"));
    files.set(person.slug, candidate);
  }

  return files;
}

function passageMarkdown(
  chapter: string,
  entries: Entry[],
  threadFiles: Map<string, string>,
) {
  const lines = [
    "---",
    `chapter: ${yamlString(chapter)}`,
    "---",
    "",
    `# ${chapter}`,
    "",
  ];

  for (const entry of entries) {
    lines.push(
      `## ${entry.kind[0].toUpperCase()}${entry.kind.slice(1)}${
        entry.verse ? ` — ${entry.verse}` : ""
      }`,
      "",
      entry.body,
      "",
    );
    const linkedThreads = entry.threads.filter((slug) =>
      threadFiles.has(slug),
    );
    if (linkedThreads.length > 0) {
      lines.push(
        `Threads: ${linkedThreads
          .map((slug) => `[[02 Threads/${threadFiles.get(slug)}]]`)
          .join(" · ")}`,
        "",
      );
    }
    if (entry.answeredAt) {
      lines.push(`Answered: ${entry.answeredAt}`, "");
    }
    if (entry.inkUrl) {
      lines.push(`Ink: ${entry.inkUrl}`, "");
    }
    lines.push(`<!-- entry:${entry.id} updated:${entry.updatedAt} -->`, "");
  }

  return lines.join("\n");
}

export function buildVaultArchive(data: VaultExport) {
  const files: Record<string, Uint8Array> = {};
  const threadFiles = uniqueThreadFiles(data.threads);
  const personFiles = uniquePersonFiles(data.people);
  const entriesByChapter = new Map<string, Entry[]>();

  for (const entry of data.entries.filter((item) => !item.deletedAt)) {
    const group = entriesByChapter.get(entry.chapter) ?? [];
    group.push(entry);
    entriesByChapter.set(entry.chapter, group);
  }

  for (const [chapter, entries] of entriesByChapter) {
    files[`Bible Brain/01 Passages/${safeName(chapter)}.md`] = strToU8(
      passageMarkdown(chapter, entries, threadFiles),
    );
  }

  for (const thread of data.threads.filter((item) => !item.deletedAt)) {
    const linked = data.entries.filter(
      (entry) => !entry.deletedAt && entry.threads.includes(thread.slug),
    );
    const body = [
      "---",
      `slug: ${yamlString(thread.slug)}`,
      "---",
      "",
      `# ${thread.title}`,
      "",
      "## In one line",
      "",
      thread.definition,
      "",
      "## What I’m seeing",
      "",
      thread.seeing,
      "",
      "## Passages",
      "",
      ...(linked.length
        ? linked.map(
            (entry) =>
              `- [[01 Passages/${safeName(entry.chapter)}]]${
                entry.verse ? ` — ${entry.verse}` : ""
              }`,
          )
        : ["- None yet"]),
      "",
    ].join("\n");
    files[
      `Bible Brain/02 Threads/${threadFiles.get(thread.slug) ?? thread.slug}.md`
    ] = strToU8(body);
  }

  for (const person of data.people) {
    files[`Bible Brain/03 People/${personFiles.get(person.slug)}.md`] = strToU8(
      [
        `# ${person.name}`,
        "",
        person.body,
        "",
        "## Chapters",
        "",
        ...person.chapters.map(
          (chapter) => `- [[01 Passages/${safeName(chapter)}]]`,
        ),
        "",
        "## Threads",
        "",
        ...person.threads
          .filter((slug) => threadFiles.has(slug))
          .map((slug) => `- [[02 Threads/${threadFiles.get(slug)}]]`),
        "",
      ].join("\n"),
    );
  }

  for (const log of data.logs) {
    files[`Bible Brain/05 Log/${safeName(log.date)}.md`] = strToU8(
      [
        "---",
        `date: ${log.date}`,
        `chapter: ${log.chapter ? yamlString(log.chapter) : "null"}`,
        "---",
        "",
        `# ${log.date}`,
        "",
        `- [${log.steps.read ? "x" : " "}] Read`,
        `- [${log.steps.observe ? "x" : " "}] Observe`,
        `- [${log.steps.link ? "x" : " "}] Link`,
        `- [${log.steps.ask ? "x" : " "}] Ask`,
        `- [${log.steps.pray ? "x" : " "}] Pray`,
        "",
        "## One sentence",
        "",
        log.sentence,
        "",
        "## What I’m carrying",
        "",
        log.carrying,
        "",
        "## Prayer",
        "",
        log.prayer,
        "",
      ].join("\n"),
    );
  }

  files["Bible Brain/README.md"] = strToU8(
    [
      "# Bible Brain export",
      "",
      "This archive contains your writing and links in plain Markdown.",
      "Bible translation text is not duplicated in the export.",
      "",
      `Exported: ${new Date().toISOString()}`,
      "",
    ].join("\n"),
  );

  return zipSync(files, { level: 6 });
}
