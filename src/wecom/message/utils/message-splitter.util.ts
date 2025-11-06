/**
 * 消息拆分工具类
 * 用于将长消息按双换行符和特殊符号拆分成多个片段
 */
export class MessageSplitter {
  /**
   * 将消息文本按双换行符和"～"符号拆分成多个片段
   * 注意：只有双换行符（\n\n）才会触发拆分，单个换行符不拆分
   * @param text 原始消息文本
   * @returns 拆分后的消息片段数组（已过滤空行）
   */
  static split(text: string): string[] {
    if (!text || typeof text !== 'string') {
      return [];
    }

    // 首先按双换行符拆分（支持 \n\n 和 \r\n\r\n）
    const lineSegments = text.split(/(?:\r?\n){2,}/);

    // 对每一段再按"～"符号拆分
    const allSegments: string[] = [];
    for (const segment of lineSegments) {
      const trimmedSegment = segment.trim();
      if (!trimmedSegment) continue;

      // 按"～"拆分，保留"～"在前一个片段的末尾
      const tildeSegments = trimmedSegment.split(/(?<=～)/);
      allSegments.push(...tildeSegments);
    }

    // 过滤掉空片段和只包含空白字符的片段
    const nonEmptySegments = allSegments
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

    return nonEmptySegments;
  }

  /**
   * 将消息文本按换行符拆分成多个片段（保持向后兼容）
   * @param text 原始消息文本
   * @returns 拆分后的消息片段数组（已过滤空行）
   */
  static splitByNewlines(text: string): string[] {
    if (!text || typeof text !== 'string') {
      return [];
    }

    // 按换行符拆分（支持 \n 和 \r\n）
    const segments = text.split(/\r?\n/);

    // 过滤掉空行和只包含空白字符的行
    const nonEmptySegments = segments
      .map((segment) => segment.trim())
      .filter((segment) => segment.length > 0);

    return nonEmptySegments;
  }

  /**
   * 检查消息是否需要拆分
   * @param text 消息文本
   * @returns 是否包含双换行符或"～"符号
   */
  static needsSplit(text: string): boolean {
    if (!text || typeof text !== 'string') {
      return false;
    }
    // 检查是否包含双换行符或"～"符号
    return /(?:\r?\n){2,}|～/.test(text);
  }

  /**
   * 获取拆分后的片段数量
   * @param text 消息文本
   * @returns 拆分后的片段数量
   */
  static getSegmentCount(text: string): number {
    return this.splitByNewlines(text).length;
  }
}
