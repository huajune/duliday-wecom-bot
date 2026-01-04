import { FlaskConical } from 'lucide-react';
import ChatTester from './components/ChatTester';
import styles from './styles/index.module.scss';

export default function AgentTest() {
  return (
    <div className={styles.page}>
      {/* 页面标题 */}
      <div className={styles.pageHeader}>
        <h1>
          <FlaskConical size={22} className={styles.headerIcon} />
          Agent 对话测试
        </h1>
        <p className={styles.subtitle}>
          输入历史聊天记录和当前消息，测试 Agent 的响应质量
        </p>
      </div>

      {/* 对话测试器 */}
      <ChatTester />
    </div>
  );
}
