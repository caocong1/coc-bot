const DEFAULT_FALLBACK_DESCRIPTION =
  '调查员会因一场看似寻常的邀请、委托或怪事被卷入事件，而更深的异常将在跑团中逐步浮现。';

const HARD_SPOILER_TERMS = [
  '真实身份',
  '真正身份',
  '幕后黑手',
  '幕后主使',
  '真相',
  '凶手',
  '怪物',
  '实体',
  '邪神',
  '古神',
  '神话生物',
  '仪式',
  '祭品',
  '变异',
  '侵蚀',
  '时间循环',
  '时间泡沫',
  '时间之神',
  '逆转时间',
  '锁死在同一天',
  '亚弗戈蒙',
  '终局',
  '结局',
  '最终',
  '原来',
  '其实',
] as const;

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function ensureSentenceEnding(text: string): string {
  if (!text) return text;
  return /[。！？!?]$/.test(text) ? text : `${text}。`;
}

function splitSentences(text: string): string[] {
  return normalizeWhitespace(text).match(/[^。！？!?]+[。！？!?]?/g)?.map((part) => part.trim()).filter(Boolean) ?? [];
}

function truncateToLength(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function findSpoilerIndex(sentence: string, terms: readonly string[]): number {
  let earliest = -1;
  for (const term of terms) {
    const idx = sentence.indexOf(term);
    if (idx >= 0 && (earliest < 0 || idx < earliest)) earliest = idx;
  }
  return earliest;
}

function stripSpoilerTail(sentence: string): string {
  const spoilerIndex = findSpoilerIndex(sentence, HARD_SPOILER_TERMS);
  if (spoilerIndex < 0) return sentence.trim();

  const candidate = sentence.slice(0, spoilerIndex);
  const boundary = Math.max(
    candidate.lastIndexOf('，'),
    candidate.lastIndexOf('、'),
    candidate.lastIndexOf('；'),
    candidate.lastIndexOf('：'),
    candidate.lastIndexOf(','),
    candidate.lastIndexOf(';'),
    candidate.lastIndexOf(':'),
  );
  const trimmed = normalizeWhitespace((boundary >= 0 ? candidate.slice(0, boundary) : candidate).replace(/[，、；：,;:]+$/g, ''));
  return trimmed;
}

export function isRiskyModuleDescription(text: string | null | undefined): boolean {
  if (!text) return false;
  const normalized = normalizeWhitespace(text);
  return HARD_SPOILER_TERMS.some((term) => normalized.includes(term));
}

export function summarizeModuleDescriptionForPlayers(
  text: string | null | undefined,
  fallback = DEFAULT_FALLBACK_DESCRIPTION,
): string {
  const normalized = normalizeWhitespace(text ?? '');
  if (!normalized) return fallback;

  const sentences = splitSentences(normalized);
  for (const sentence of sentences) {
    const spoilerSafe = stripSpoilerTail(sentence);
    if (spoilerSafe.length >= 10) {
      return truncateToLength(ensureSentenceEnding(spoilerSafe), 78);
    }
  }

  const firstSentence = sentences[0] ? ensureSentenceEnding(stripSpoilerTail(sentences[0])) : '';
  if (firstSentence.length >= 16) return truncateToLength(firstSentence, 78);

  return fallback;
}
