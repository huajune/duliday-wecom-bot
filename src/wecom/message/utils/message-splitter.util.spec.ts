import { MessageSplitter } from './message-splitter.util';

describe('MessageSplitter', () => {
  describe('splitByNewlines', () => {
    it('应该按换行符拆分消息', () => {
      const text = '第一行\n第二行\n第三行';
      const result = MessageSplitter.splitByNewlines(text);
      expect(result).toEqual(['第一行', '第二行', '第三行']);
    });

    it('应该处理 Windows 风格的换行符', () => {
      const text = '第一行\r\n第二行\r\n第三行';
      const result = MessageSplitter.splitByNewlines(text);
      expect(result).toEqual(['第一行', '第二行', '第三行']);
    });

    it('应该过滤掉空行', () => {
      const text = '第一行\n\n第二行\n   \n第三行';
      const result = MessageSplitter.splitByNewlines(text);
      expect(result).toEqual(['第一行', '第二行', '第三行']);
    });

    it('应该处理只有空格的行', () => {
      const text = '第一行\n   \n第二行';
      const result = MessageSplitter.splitByNewlines(text);
      expect(result).toEqual(['第一行', '第二行']);
    });

    it('应该去除每行前后的空格', () => {
      const text = '  第一行  \n  第二行  \n  第三行  ';
      const result = MessageSplitter.splitByNewlines(text);
      expect(result).toEqual(['第一行', '第二行', '第三行']);
    });

    it('对于空字符串应该返回空数组', () => {
      const result = MessageSplitter.splitByNewlines('');
      expect(result).toEqual([]);
    });

    it('对于只包含换行符的字符串应该返回空数组', () => {
      const result = MessageSplitter.splitByNewlines('\n\n\n');
      expect(result).toEqual([]);
    });

    it('对于不包含换行符的字符串应该返回包含该字符串的数组', () => {
      const text = '这是一条单行消息';
      const result = MessageSplitter.splitByNewlines(text);
      expect(result).toEqual(['这是一条单行消息']);
    });

    it('应该处理 null 和 undefined', () => {
      expect(MessageSplitter.splitByNewlines(null as any)).toEqual([]);
      expect(MessageSplitter.splitByNewlines(undefined as any)).toEqual([]);
    });
  });

  describe('needsSplit', () => {
    it('包含双换行符时应该返回 true', () => {
      expect(MessageSplitter.needsSplit('第一段\n\n第二段')).toBe(true);
      expect(MessageSplitter.needsSplit('第一段\r\n\r\n第二段')).toBe(true);
    });

    it('只包含单换行符时应该返回 false', () => {
      expect(MessageSplitter.needsSplit('第一行\n第二行')).toBe(false);
      expect(MessageSplitter.needsSplit('第一行\r\n第二行')).toBe(false);
    });

    it('不包含换行符时应该返回 false', () => {
      expect(MessageSplitter.needsSplit('这是一条单行消息')).toBe(false);
    });

    it('对于空字符串应该返回 false', () => {
      expect(MessageSplitter.needsSplit('')).toBe(false);
    });

    it('对于 null 和 undefined 应该返回 false', () => {
      expect(MessageSplitter.needsSplit(null as any)).toBe(false);
      expect(MessageSplitter.needsSplit(undefined as any)).toBe(false);
    });
  });

  describe('getSegmentCount', () => {
    it('应该返回正确的片段数量', () => {
      expect(MessageSplitter.getSegmentCount('第一行\n第二行\n第三行')).toBe(3);
    });

    it('应该过滤空行后返回正确的数量', () => {
      expect(MessageSplitter.getSegmentCount('第一行\n\n第二行\n第三行')).toBe(3);
    });

    it('对于单行消息应该返回 1', () => {
      expect(MessageSplitter.getSegmentCount('这是一条单行消息')).toBe(1);
    });

    it('对于空字符串应该返回 0', () => {
      expect(MessageSplitter.getSegmentCount('')).toBe(0);
    });
  });

  describe('实际应用场景测试', () => {
    it('应该正确拆分花卷Agent的多段回复（使用双换行符）', () => {
      const agentReply = `您好！很高兴为您服务。

我们目前有以下几个岗位：
1. 前端工程师 - React
2. 后端工程师 - Node.js
3. 产品经理

请问您对哪个岗位感兴趣？`;

      const segments = MessageSplitter.split(agentReply);

      expect(segments.length).toBe(3);
      expect(segments[0]).toBe('您好！很高兴为您服务。');
      expect(segments[1]).toBe(
        '我们目前有以下几个岗位：\n1. 前端工程师 - React\n2. 后端工程师 - Node.js\n3. 产品经理',
      );
      expect(segments[2]).toBe('请问您对哪个岗位感兴趣？');
    });

    it('单换行符不应该触发拆分', () => {
      const agentReply = `我们有以下岗位：
1. 前端工程师
2. 后端工程师`;

      const segments = MessageSplitter.split(agentReply);
      // 只有一个段落，不拆分
      expect(segments.length).toBe(1);
      expect(segments[0]).toBe('我们有以下岗位：\n1. 前端工程师\n2. 后端工程师');
    });
  });

  describe('split - 支持"～"符号拆分', () => {
    it('应该按"～"符号拆分消息', () => {
      const text = '我看了下～浦东这边肯德基确实在招';
      const result = MessageSplitter.split(text);
      expect(result).toEqual(['我看了下～', '浦东这边肯德基确实在招']);
    });

    it('应该按多个"～"符号拆分', () => {
      const text = '我看了下～浦东这边肯德基确实在招～要不要看看离您近的门店？';
      const result = MessageSplitter.split(text);
      expect(result).toEqual([
        '我看了下～',
        '浦东这边肯德基确实在招～',
        '要不要看看离您近的门店？',
      ]);
    });

    it('应该同时按双换行符和"～"符号拆分', () => {
      const text =
        '我看了下～浦东这边肯德基确实在招\n\n时薪26元，做六休一哈～\n\n要不要我帮您看下离您近的门店？';
      const result = MessageSplitter.split(text);
      expect(result).toEqual([
        '我看了下～',
        '浦东这边肯德基确实在招',
        '时薪26元，做六休一哈～',
        '要不要我帮您看下离您近的门店？',
      ]);
    });

    it('单换行符配合"～"符号时不按换行符拆分', () => {
      const text = '我看了下～浦东这边肯德基确实在招\n时薪26元，做六休一哈～';
      const result = MessageSplitter.split(text);
      // 单换行符不拆分，只按"～"拆分
      expect(result).toEqual(['我看了下～', '浦东这边肯德基确实在招\n时薪26元，做六休一哈～']);
    });

    it('应该处理末尾有"～"的情况', () => {
      const text = '不好意思哈～';
      const result = MessageSplitter.split(text);
      expect(result).toEqual(['不好意思哈～']);
    });

    it('应该处理没有"～"符号的普通消息', () => {
      const text = '这是一条普通消息';
      const result = MessageSplitter.split(text);
      expect(result).toEqual(['这是一条普通消息']);
    });

    it('应该过滤空片段', () => {
      const text = '我看了下～～浦东这边在招';
      const result = MessageSplitter.split(text);
      expect(result).toEqual(['我看了下～', '～', '浦东这边在招']);
    });

    it('实际场景：招聘经理回复消息', () => {
      const agentReply =
        '我看了下～大米先生浦东这边暂时没在招哈～不过附近必胜客和奥乐齐都还在招，要不要我帮您看看那边的？😊';
      const result = MessageSplitter.split(agentReply);
      expect(result).toEqual([
        '我看了下～',
        '大米先生浦东这边暂时没在招哈～',
        '不过附近必胜客和奥乐齐都还在招，要不要我帮您看看那边的？😊',
      ]);
    });

    it('实际场景：简单问候语拆分', () => {
      const agentReply = '好的～请问您现在是学生吗？';
      const result = MessageSplitter.split(agentReply);
      // 应该保持原始顺序："好的～"在前，"请问您现在是学生吗？"在后
      expect(result).toEqual(['好的～', '请问您现在是学生吗？']);
    });
  });

  describe('needsSplit - 更新支持"～"符号和双换行符', () => {
    it('包含"～"符号时应该返回 true', () => {
      expect(MessageSplitter.needsSplit('我看了下～浦东这边在招')).toBe(true);
    });

    it('同时包含双换行符和"～"符号时应该返回 true', () => {
      expect(MessageSplitter.needsSplit('第一段\n\n我看了下～第二段')).toBe(true);
    });

    it('只包含单换行符时应该返回 false', () => {
      expect(MessageSplitter.needsSplit('第一行\n第二行')).toBe(false);
    });

    it('只包含普通文本时应该返回 false', () => {
      expect(MessageSplitter.needsSplit('这是普通文本')).toBe(false);
    });

    it('包含双换行符时应该返回 true', () => {
      expect(MessageSplitter.needsSplit('第一段\n\n第二段')).toBe(true);
    });
  });
});
