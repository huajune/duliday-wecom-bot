/**
 * AI 回复文本清洗工具
 * 将 Markdown 格式的列表、分点说明转换为更自然的口语化表达
 *
 * 目标：即使 AI 偶尔生成 Markdown 格式，业务层也能保证发出去的是人话
 */
export class ReplyNormalizer {
  static normalize(text: string): string {
    if (!text || typeof text !== 'string') return text;
    if (this.containsListMarkers(text)) return this.normalizeComplexStructure(text);
    return this.cleanWhitespace(text);
  }

  private static containsListMarkers(text: string): boolean {
    return /^\s*[-*•]\s+/m.test(text) || /^\s*\d+[\.\)]\s+/m.test(text);
  }

  private static normalizeComplexStructure(text: string): string {
    const paragraphs = text
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    const result: string[] = [];
    for (const paragraph of paragraphs) {
      if (this.containsListMarkers(paragraph)) {
        result.push(this.processListParagraph(paragraph));
      } else {
        const cleaned = paragraph.replace(/\n+/g, '').trim();
        if (cleaned) result.push(cleaned);
      }
    }
    return result.join('');
  }

  private static processListParagraph(paragraph: string): string {
    const lines = paragraph
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    const leadingLines: string[] = [];
    const listItems: string[] = [];
    const trailingLines: string[] = [];
    let inList = false;
    let afterList = false;

    for (const line of lines) {
      const isListItem = /^[-*•]\s+/.test(line) || /^\d+[\.\)]\s+/.test(line);
      if (isListItem) {
        inList = true;
        listItems.push(line.replace(/^[-*•]\s+/, '').replace(/^\d+[\.\)]\s+/, ''));
      } else if (inList && !isListItem) {
        afterList = true;
        trailingLines.push(line);
      } else if (!inList) {
        leadingLines.push(line);
      } else if (afterList) {
        trailingLines.push(line);
      }
    }

    const parts: string[] = [];
    if (leadingLines.length > 0) {
      let leadingText = leadingLines.join('');
      leadingText = leadingText.replace(/[，,]?\s*(比如|例如|如|包括)[:：]?\s*$/, '');
      leadingText = this.simplifyQuestionInText(leadingText);
      parts.push(leadingText);
    }
    if (listItems.length > 0) {
      const options = listItems.map((item) => this.extractOptionCore(item));
      parts.push('有' + options.join('、') + '可以选，');
    }
    if (trailingLines.length > 0) {
      let trailingText = trailingLines.join('');
      trailingText = trailingText.replace(/[，,]?\s*$/, '');
      if (trailingText && !trailingText.endsWith('～') && !trailingText.endsWith('哈')) {
        trailingText += '～';
      }
      parts.push(trailingText);
    }
    return parts.join('');
  }

  private static simplifyQuestionInText(text: string): string {
    let simplified = text;
    simplified = simplified.replace(/[，,]?\s*另外[^？?]*[？?]?/g, '');
    simplified = simplified.replace(/的工作([呀吗呢？?])/g, '$1');
    return simplified.trim();
  }

  private static extractOptionCore(option: string): string {
    let core = option.trim();
    core = core.replace(/[（(][^）)]*[）)]/g, '');
    core = core.replace(/(类型|类)$/g, '');
    if (core.includes('/')) core = core.split('/')[0];
    if (core.includes('、')) core = core.split('、')[0];
    if (core.includes('+')) core = core.split('+')[0];
    return core.trim();
  }

  private static cleanWhitespace(text: string): string {
    let cleaned = text.replace(/\n{3,}/g, '\n\n');
    cleaned = cleaned
      .split('\n')
      .map((l) => l.trim())
      .join('\n');
    return cleaned.trim();
  }

  static needsNormalization(text: string): boolean {
    if (!text) return false;
    if (/^\s*[-*•]\s+/m.test(text)) return true;
    if (/^\s*\d+[\.\)]\s+/m.test(text)) return true;
    const lines = text.split('\n').filter((l) => l.trim());
    if (lines.length > 2) {
      const avgLength = lines.reduce((sum, l) => sum + l.length, 0) / lines.length;
      if (avgLength < 30) return true;
    }
    return false;
  }
}
