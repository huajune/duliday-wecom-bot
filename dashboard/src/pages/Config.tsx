import { useState, useEffect } from 'react';
import {
  useAgentReplyConfig,
  useUpdateAgentReplyConfig,
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
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  category: 'merge' | 'typing';
  type?: 'number' | 'boolean';
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
    type: 'number',
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
    type: 'number',
  },
  // 打字延迟配置
  {
    key: 'typingSpeedCharsPerSec',
    label: '打字速度',
    description: '模拟真人打字速度（字符/秒）',
    unit: '字符/秒',
    min: 1,
    max: 50,
    step: 1,
    category: 'typing',
    type: 'number',
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
    type: 'number',
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
function formatValue(key: ConfigKey, value: number | boolean): string {
  if (typeof value === 'boolean') {
    return value ? '已启用' : '已禁用';
  }
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
  const handleConfigChange = (key: ConfigKey, value: number | boolean) => {
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
          padding: '16px',
          background: 'var(--bg-secondary)',
          borderRadius: '10px',
          border: isModified ? '1px solid var(--primary)' : '1px solid var(--border)',
          transition: 'all 0.2s ease',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '4px',
          }}
        >
          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13px' }}>
            {meta.label}
          </span>
          <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--primary)' }}>
            {formatValue(meta.key, currentValue)}
          </span>
        </div>
        <p
          style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            margin: '0 0 12px 0',
            lineHeight: 1.4,
          }}
        >
          {meta.description}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <input
            type="range"
            min={meta.min}
            max={meta.max}
            step={meta.step}
            value={currentValue}
            onChange={(e) => handleConfigChange(meta.key, Number(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--primary)', height: '4px' }}
          />
          <input
            type="number"
            min={meta.min}
            max={meta.max}
            step={meta.step}
            value={currentValue}
            onChange={(e) => handleConfigChange(meta.key, Number(e.target.value))}
            style={{
              width: '70px',
              padding: '4px 8px',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              textAlign: 'right',
              fontSize: '12px',
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

  // 渲染布尔值配置项卡片
  const renderBooleanCard = (meta: ConfigMeta, currentValue: boolean, defaultValue: boolean) => {
    const isModified = currentValue !== defaultValue;
    return (
      <div
        key={meta.key}
        style={{
          padding: '16px',
          background: 'var(--bg-secondary)',
          borderRadius: '10px',
          border: isModified ? '1px solid var(--primary)' : '1px solid var(--border)',
          transition: 'all 0.2s ease',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '4px',
          }}
        >
          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13px' }}>
            {meta.label}
          </span>
          <div className="toggle-switch">
            <input
              type="checkbox"
              checked={currentValue}
              onChange={(e) => handleConfigChange(meta.key, e.target.checked)}
            />
          </div>
        </div>
        <p
          style={{
            fontSize: '12px',
            color: 'var(--text-muted)',
            margin: 0,
            lineHeight: 1.4,
          }}
        >
          {meta.description}
        </p>
      </div>
    );
  };

  return (
    <div id="page-config" className="page-section active">
      {/* 顶部控制栏 */}
      <div
        className="control-panel"
        style={{
          marginBottom: '20px',
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: '15px',
            fontWeight: 600,
            color: 'var(--text-primary)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}
        >
          <span style={{ fontSize: '16px' }}>⚙️</span>
          消息处理配置
        </h3>

        {/* 操作按钮 */}
        {hasChanges && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              className="btn btn-ghost"
              style={{ padding: '6px 14px', fontSize: '13px' }}
              onClick={handleCancelEdit}
            >
              取消
            </button>
            <button
              className="btn btn-primary"
              style={{ padding: '6px 14px', fontSize: '13px' }}
              onClick={handleSaveConfig}
              disabled={updateConfig.isPending}
            >
              {updateConfig.isPending ? '保存中...' : '保存更改'}
            </button>
          </div>
        )}
      </div>

      {isLoadingConfig ? (
        <div className="loading-text">加载配置中...</div>
      ) : (
        <>
          {/* 所有配置项平铺 */}
          {(['merge', 'typing'] as const).map((category) => {
            const categoryItems = configMeta.filter((m) => m.category === category);
            if (categoryItems.length === 0) return null;
            const { title } = categoryTitles[category];

            return (
              <section key={category} style={{ marginBottom: '20px' }}>
                <div
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: 'var(--text-muted)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    marginBottom: '12px',
                    paddingLeft: '4px',
                  }}
                >
                  {title}
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                    gap: '12px',
                  }}
                >
                  {categoryItems.map((meta) => {
                    const currentValue =
                      (editingConfig[meta.key] as any) ??
                      (agentConfigData?.defaults[meta.key] as any);
                    const defaultValue = agentConfigData?.defaults[meta.key] as any;

                    if (meta.type === 'boolean') {
                      return renderBooleanCard(meta, Boolean(currentValue), Boolean(defaultValue));
                    }
                    return renderNumberCard(meta, Number(currentValue || 0), Number(defaultValue || 0));
                  })}
                </div>
              </section>
            );
          })}

          {/* Worker 并发配置 */}
          <section style={{ marginBottom: '20px' }}>
            <div
              style={{
                fontSize: '12px',
                fontWeight: 600,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                marginBottom: '12px',
                paddingLeft: '4px',
              }}
            >
              处理能力
            </div>

            {isLoadingWorker ? (
              <div className="loading-text">加载 Worker 状态...</div>
            ) : workerStatus ? (
              <div
                style={{
                  padding: '16px',
                  background: 'var(--bg-secondary)',
                  borderRadius: '10px',
                  border: '1px solid var(--border)',
                }}
              >
                {/* Worker 状态指示 */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '4px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '13px' }}>
                      Worker 并发数
                    </span>
                    {workerStatus.activeJobs > 0 && (
                      <span
                        style={{
                          fontSize: '11px',
                          color: 'var(--success)',
                        }}
                      >
                        ({workerStatus.activeJobs} 任务中)
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--primary)' }}>
                    {editingConcurrency ?? workerStatus.concurrency}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: '12px',
                    color: 'var(--text-muted)',
                    margin: '0 0 12px 0',
                    lineHeight: 1.4,
                  }}
                >
                  控制同时处理消息的 Worker 数量。增加并发数可提高吞吐量，但会增加 Agent API 压力。修改后会等待当前任务完成再生效。
                </p>
                <div
                  style={{
                    fontSize: '11px',
                    color: 'var(--text-muted)',
                    padding: '8px 10px',
                    background: 'var(--bg-primary)',
                    borderRadius: '6px',
                    marginBottom: '12px',
                    lineHeight: 1.5,
                    fontFamily: 'ui-monospace, monospace',
                  }}
                >
                  <div>理论吞吐量 = 并发数 × (时间 / 平均首响时间)</div>
                  <div style={{ marginTop: '4px', color: 'var(--text-secondary)' }}>
                    例: {editingConcurrency ?? workerStatus.concurrency} 并发 × (60s / 10s首响) ≈{' '}
                    <strong style={{ color: 'var(--primary)' }}>
                      {((editingConcurrency ?? workerStatus.concurrency) * 6).toLocaleString()}
                    </strong>{' '}
                    条/分钟 ≈{' '}
                    <strong style={{ color: 'var(--primary)' }}>
                      {((editingConcurrency ?? workerStatus.concurrency) * 360).toLocaleString()}
                    </strong>{' '}
                    条/小时
                  </div>
                </div>

                {/* 滑块控制 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input
                    type="range"
                    min={workerStatus.minConcurrency}
                    max={workerStatus.maxConcurrency}
                    step={1}
                    value={editingConcurrency ?? workerStatus.concurrency}
                    onChange={(e) => setEditingConcurrency(Number(e.target.value))}
                    style={{ flex: 1, accentColor: 'var(--primary)', height: '4px' }}
                  />
                  <input
                    type="number"
                    min={workerStatus.minConcurrency}
                    max={workerStatus.maxConcurrency}
                    step={1}
                    value={editingConcurrency ?? workerStatus.concurrency}
                    onChange={(e) => setEditingConcurrency(Number(e.target.value))}
                    style={{
                      width: '50px',
                      padding: '4px 8px',
                      border: '1px solid var(--border)',
                      borderRadius: '6px',
                      background: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      textAlign: 'right',
                      fontSize: '12px',
                    }}
                  />
                </div>

                {/* 范围提示 & 操作按钮 */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginTop: '8px',
                  }}
                >
                  <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                    {workerStatus.minConcurrency} - {workerStatus.maxConcurrency}（默认: 4）
                  </span>

                  {editingConcurrency !== null && editingConcurrency !== workerStatus.concurrency && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        className="btn btn-ghost"
                        style={{ padding: '4px 10px', fontSize: '11px' }}
                        onClick={() => setEditingConcurrency(null)}
                      >
                        取消
                      </button>
                      <button
                        className="btn btn-primary"
                        style={{ padding: '4px 10px', fontSize: '11px' }}
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
              </div>
            ) : (
              <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
                无法获取 Worker 状态
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
