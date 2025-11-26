import { useState, useEffect } from 'react';
import {
  useAgentReplyConfig,
  useUpdateAgentReplyConfig,
  useResetAgentReplyConfig,
  useWorkerStatus,
  useSetWorkerConcurrency,
} from '@/hooks/useMonitoring';
import type { AgentReplyConfig } from '@/types/monitoring';


// 配置项元数据
type ConfigKey = keyof AgentReplyConfig;

interface ConfigMeta {
  key: ConfigKey;
  label: string;
  description: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  category: 'merge' | 'typing';
}

const configMeta: ConfigMeta[] = [
  // 消息聚合配置
  {
    key: 'initialMergeWindowMs',
    label: '消息聚合等待时间',
    description: '收到第一条消息后等待多久再处理（聚合连续消息）',
    unit: 'ms',
    min: 0,
    max: 30000,
    step: 100,
    category: 'merge',
  },
  {
    key: 'maxMergedMessages',
    label: '最大聚合消息数',
    description: '单次最多聚合多少条消息',
    unit: '条',
    min: 1,
    max: 10,
    step: 1,
    category: 'merge',
  },
  // 打字延迟配置
  {
    key: 'typingDelayPerCharMs',
    label: '打字延迟（每字符）',
    description: '模拟打字速度，每个字符的延迟时间',
    unit: 'ms',
    min: 0,
    max: 500,
    step: 10,
    category: 'typing',
  },
  {
    key: 'paragraphGapMs',
    label: '段落间隔延迟',
    description: '发送多段回复时，段落之间的停顿时间',
    unit: 'ms',
    min: 0,
    max: 10000,
    step: 100,
    category: 'typing',
  },
];

// 分类标题
const categoryTitles: Record<string, { title: string; description: string }> = {
  merge: {
    title: '消息聚合',
    description: '配置连续消息的合并策略，适合处理用户快速发送多条消息的场景',
  },
  typing: {
    title: '打字延迟',
    description: '模拟真人打字效果，让回复更自然',
  },
};

// 格式化配置显示值
function formatValue(key: ConfigKey, value: number): string {
  if (String(key).endsWith('Ms')) {
    if (value >= 1000) {
      return `${(value / 1000).toFixed(1)} 秒`;
    }
    return `${value} ms`;
  }
  return `${value}`;
}

export default function Config() {
  // 本地编辑状态
  const [editingConfig, setEditingConfig] = useState<Partial<AgentReplyConfig>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [editingConcurrency, setEditingConcurrency] = useState<number | null>(null);

  // Agent 回复策略配置
  const { data: agentConfigData, isLoading: isLoadingConfig } = useAgentReplyConfig();
  const updateConfig = useUpdateAgentReplyConfig();
  const resetConfig = useResetAgentReplyConfig();

  // Worker 状态
  const { data: workerStatus, isLoading: isLoadingWorker } = useWorkerStatus();
  const setConcurrency = useSetWorkerConcurrency();

  // 当配置数据加载后，初始化编辑状态
  useEffect(() => {
    if (agentConfigData?.config) {
      setEditingConfig(agentConfigData.config);
      setHasChanges(false);
    }
  }, [agentConfigData]);

  // 更新配置
  const handleConfigChange = (key: ConfigKey, value: number) => {
    setEditingConfig((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  };

  // 保存配置
  const handleSaveConfig = () => {
    updateConfig.mutate(editingConfig, {
      onSuccess: () => {
        setHasChanges(false);
      },
    });
  };

  // 重置为默认值
  const handleResetConfig = () => {
    if (window.confirm('确定要重置消息处理配置为默认值吗？')) {
      resetConfig.mutate(undefined, {
        onSuccess: () => {
          setHasChanges(false);
        },
      });
    }
  };

  // 取消编辑
  const handleCancelEdit = () => {
    if (agentConfigData?.config) {
      setEditingConfig(agentConfigData.config);
      setHasChanges(false);
    }
  };

  // 渲染数值配置项卡片
  const renderNumberCard = (meta: ConfigMeta, currentValue: number, defaultValue: number) => {
    const isModified = currentValue !== defaultValue;
    return (
      <div
        key={meta.key}
        style={{
          padding: '20px',
          background: 'var(--bg-secondary)',
          borderRadius: '12px',
          border: isModified ? '1px solid var(--primary)' : '1px solid var(--border)',
          transition: 'all 0.2s ease',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '12px',
          }}
        >
          <div>
            <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '14px' }}>
              {meta.label}
            </span>
            {isModified && (
              <span
                style={{
                  marginLeft: '8px',
                  fontSize: '10px',
                  color: 'var(--primary)',
                  background: 'var(--primary-alpha)',
                  padding: '2px 8px',
                  borderRadius: '10px',
                }}
              >
                已修改
              </span>
            )}
          </div>
          <span style={{ fontSize: '18px', fontWeight: 700, color: 'var(--primary)' }}>
            {formatValue(meta.key, currentValue)}
          </span>
        </div>
        <p
          style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            marginBottom: '16px',
            lineHeight: 1.5,
          }}
        >
          {meta.description}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <input
            type="range"
            min={meta.min}
            max={meta.max}
            step={meta.step}
            value={currentValue}
            onChange={(e) => handleConfigChange(meta.key, Number(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--primary)', height: '6px' }}
          />
          <input
            type="number"
            min={meta.min}
            max={meta.max}
            step={meta.step}
            value={currentValue}
            onChange={(e) => handleConfigChange(meta.key, Number(e.target.value))}
            style={{
              width: '80px',
              padding: '6px 10px',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              textAlign: 'right',
              fontSize: '13px',
            }}
          />
        </div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginTop: '8px',
            fontSize: '11px',
            color: 'var(--text-muted)',
          }}
        >
          <span>
            {meta.min} - {meta.max} {meta.unit}
          </span>
          <span>默认: {formatValue(meta.key, defaultValue)}</span>
        </div>
      </div>
    );
  };

  return (
    <div id="page-config" className="page-section active">
      {/* 页面标题 */}
      <div style={{ marginBottom: '24px' }}>
        <h2 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '20px' }}>消息处理配置</h2>
        <p style={{ margin: '8px 0 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
          配置 AI 回复的消息聚合和打字延迟策略，修改后实时生效
        </p>
      </div>

      {/* 操作按钮 */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        {hasChanges && (
          <>
            <button
              className="btn btn-ghost"
              style={{ padding: '8px 16px', fontSize: '13px' }}
              onClick={handleCancelEdit}
            >
              取消
            </button>
            <button
              className="btn btn-primary"
              style={{ padding: '8px 16px', fontSize: '13px' }}
              onClick={handleSaveConfig}
              disabled={updateConfig.isPending}
            >
              {updateConfig.isPending ? '保存中...' : '保存更改'}
            </button>
          </>
        )}
        <button
          className="btn btn-ghost"
          style={{ padding: '8px 16px', fontSize: '13px', color: 'var(--warning)' }}
          onClick={handleResetConfig}
          disabled={resetConfig.isPending}
        >
          重置默认
        </button>
      </div>

      {isLoadingConfig ? (
        <div className="loading-text">加载配置中...</div>
      ) : (
        <>
          {/* 按分类渲染配置项 */}
          {(['merge', 'typing'] as const).map((category) => {
            const categoryItems = configMeta.filter((m) => m.category === category);
            if (categoryItems.length === 0) return null;
            const { title, description } = categoryTitles[category];

            return (
              <section key={category} style={{ marginBottom: '32px' }}>
                <div style={{ marginBottom: '16px' }}>
                  <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '16px' }}>
                    {title}
                  </h3>
                  <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                    {description}
                  </p>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
                    gap: '16px',
                  }}
                >
                  {categoryItems.map((meta) => {
                    const currentValue =
                      (editingConfig[meta.key] as number) ??
                      (agentConfigData?.defaults[meta.key] as number) ??
                      0;
                    const defaultValue = (agentConfigData?.defaults[meta.key] as number) ?? 0;
                    return renderNumberCard(meta, currentValue, defaultValue);
                  })}
                </div>
              </section>
            );
          })}

          {/* Worker 并发配置 */}
          <section style={{ marginBottom: '32px' }}>
            <div style={{ marginBottom: '16px' }}>
              <h3 style={{ margin: 0, color: 'var(--text-primary)', fontSize: '16px' }}>
                消息处理能力
              </h3>
              <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                配置消息队列的并行处理能力，影响系统吞吐量
              </p>
            </div>

            {isLoadingWorker ? (
              <div className="loading-text">加载 Worker 状态...</div>
            ) : workerStatus ? (
              <div
                style={{
                  padding: '20px',
                  background: 'var(--bg-secondary)',
                  borderRadius: '12px',
                  border: '1px solid var(--border)',
                }}
              >
                {/* Worker 状态指示 */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '16px',
                  }}
                >
                  <div>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '14px' }}>
                      Worker 并发数
                    </span>
                    {workerStatus.activeJobs > 0 && (
                      <span
                        style={{
                          marginLeft: '12px',
                          fontSize: '11px',
                          color: 'var(--success)',
                          background: 'rgba(34, 197, 94, 0.1)',
                          padding: '2px 8px',
                          borderRadius: '10px',
                        }}
                      >
                        {workerStatus.activeJobs} 个任务处理中
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '24px', fontWeight: 700, color: 'var(--primary)' }}>
                    {editingConcurrency ?? workerStatus.concurrency}
                  </span>
                </div>

                <p
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    marginBottom: '16px',
                    lineHeight: 1.5,
                  }}
                >
                  控制同时处理消息的 Worker 数量。增加并发数可提高吞吐量，但会增加 Agent API 压力。
                  修改后会等待当前任务完成再生效。
                </p>

                {/* 滑块控制 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <input
                    type="range"
                    min={workerStatus.minConcurrency}
                    max={workerStatus.maxConcurrency}
                    step={1}
                    value={editingConcurrency ?? workerStatus.concurrency}
                    onChange={(e) => setEditingConcurrency(Number(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--primary)', height: '6px' }}
                  />
                  <input
                    type="number"
                    min={workerStatus.minConcurrency}
                    max={workerStatus.maxConcurrency}
                    step={1}
                    value={editingConcurrency ?? workerStatus.concurrency}
                    onChange={(e) => setEditingConcurrency(Number(e.target.value))}
                    style={{
                      width: '60px',
                      padding: '6px 10px',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      background: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      textAlign: 'right',
                      fontSize: '13px',
                    }}
                  />
                </div>

                {/* 范围提示 & 操作按钮 */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: '12px',
                  }}
                >
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    范围: {workerStatus.minConcurrency} - {workerStatus.maxConcurrency}（默认: 4）
                  </span>

                  {editingConcurrency !== null && editingConcurrency !== workerStatus.concurrency && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 12px', fontSize: '12px' }}
                        onClick={() => setEditingConcurrency(null)}
                      >
                        取消
                      </button>
                      <button
                        className="btn btn-primary"
                        style={{ padding: '4px 12px', fontSize: '12px' }}
                        onClick={() => {
                          setConcurrency.mutate(editingConcurrency, {
                            onSuccess: () => setEditingConcurrency(null),
                          });
                        }}
                        disabled={setConcurrency.isPending}
                      >
                        {setConcurrency.isPending ? '应用中...' : '应用'}
                      </button>
                    </div>
                  )}
                </div>

                {/* 吞吐量估算 */}
                <div
                  style={{
                    marginTop: '16px',
                    padding: '12px',
                    background: 'var(--bg-primary)',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                >
                  <div style={{ color: 'var(--text-muted)', marginBottom: '4px' }}>
                    理论吞吐量估算（假设每条消息处理 10 秒）
                  </div>
                  <div style={{ color: 'var(--text-primary)' }}>
                    每分钟可处理约{' '}
                    <strong style={{ color: 'var(--primary)' }}>
                      {((editingConcurrency ?? workerStatus.concurrency) * 6).toFixed(0)}
                    </strong>{' '}
                    条消息
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                无法获取 Worker 状态
              </div>
            )}
          </section>

          {/* 提示信息 */}
          <div
            style={{
              padding: '16px 20px',
              background: 'rgba(59, 130, 246, 0.1)',
              borderRadius: '12px',
              border: '1px solid rgba(59, 130, 246, 0.2)',
              marginTop: '24px',
            }}
          >
            <div
              style={{
                fontSize: '13px',
                color: 'var(--text-primary)',
                fontWeight: 500,
                marginBottom: '4px',
              }}
            >
              告警配置已移至系统监控页面
            </div>
            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              业务指标告警的开关和参数设置请前往「系统监控」页面配置
            </div>
          </div>
        </>
      )}
    </div>
  );
}
