import { useState } from 'react';
import { formatDateTime } from '@/utils/format';
import styles from './index.module.scss';

interface HealthData {
  status?: 'healthy' | 'degraded' | 'unhealthy';
  message?: string;
  models?: {
    allConfiguredModelsAvailable: boolean;
    availableCount: number;
    configuredCount: number;
  };
  tools?: {
    allAvailable: boolean;
    availableCount: number;
    configuredCount: number;
  };
  brandConfig?: {
    available: boolean;
    synced: boolean;
    lastUpdated?: string;
  };
}

interface ModelsData {
  availableModels: string[];
  defaultModel: string;
  lastRefreshTime?: string;
}

interface ToolsData {
  configuredTools: string[];
  count: number;
  lastRefreshTime?: string;
}

interface BrandData {
  available: boolean;
  synced: boolean;
  hasBrandData: boolean;
  hasReplyPrompts: boolean;
  lastUpdated?: string;
}

interface HealthGridProps {
  health?: HealthData;
  modelsData?: ModelsData;
  toolsData?: ToolsData;
  brandData?: BrandData;
}

export default function HealthGrid({ health, modelsData, toolsData, brandData }: HealthGridProps) {
  const [hoveredCard, setHoveredCard] = useState<'model' | 'tool' | 'brand' | null>(null);

  const getHealthState = (isHealthy: boolean | undefined): string => {
    if (isHealthy === undefined) return 'loading';
    return isHealthy ? 'healthy' : 'warning';
  };

  return (
    <div className={`health-grid ${styles.healthGrid}`}>
      {/* 整体状态 */}
      <article className={`health-item ${styles.healthItem}`} data-state={getHealthState(health?.status === 'healthy')}>
        <div className={styles.healthIcon}>🛰️</div>
        <div className={styles.healthInfo}>
          <div className={styles.healthTitle}>整体状态</div>
          <div className={styles.healthStatus}>
            {health?.status === 'healthy'
              ? '运行正常'
              : health?.status === 'degraded'
                ? '服务降级'
                : health?.status === 'unhealthy'
                  ? '服务异常'
                  : '-'}
          </div>
          <div className={styles.healthDesc}>{health?.message || '检查中...'}</div>
        </div>
      </article>

      {/* AI 模型 */}
      <article
        className={`health-item ${styles.healthItem} ${styles.hoverable}`}
        data-state={getHealthState(health?.models?.allConfiguredModelsAvailable)}
        onMouseEnter={() => setHoveredCard('model')}
        onMouseLeave={() => setHoveredCard(null)}
      >
        <div className={styles.healthIcon}>🤖</div>
        <div className={styles.healthInfo}>
          <div className={styles.healthTitle}>AI 模型</div>
          <div className={styles.healthStatus}>
            {health?.models?.allConfiguredModelsAvailable ? '服务可用' : health?.models ? '需关注' : '-'}
          </div>
          <div className={styles.healthDesc}>
            {health?.models ? `${health.models.availableCount}/${health.models.configuredCount} 模型可用` : '检查中...'}
          </div>
        </div>
        {hoveredCard === 'model' && modelsData && (
          <div className={styles.healthTooltip}>
            <div className={styles.tooltipTitle}>可用模型列表</div>
            <div className={styles.tooltipContent}>
              {modelsData.availableModels?.length > 0 ? (
                <ul className={styles.tooltipList}>
                  {modelsData.availableModels.map((model) => (
                    <li key={model} className={model === modelsData.defaultModel ? styles.defaultItem : ''}>
                      {model}
                      {model === modelsData.defaultModel && <span className={styles.defaultBadge}>默认</span>}
                    </li>
                  ))}
                </ul>
              ) : (
                <div className={styles.tooltipEmpty}>暂无可用模型</div>
              )}
            </div>
            <div className={styles.tooltipFooter}>
              更新于 {modelsData.lastRefreshTime ? formatDateTime(modelsData.lastRefreshTime) : '-'}
            </div>
          </div>
        )}
      </article>

      {/* 工具服务 */}
      <article
        className={`health-item ${styles.healthItem} ${styles.hoverable}`}
        data-state={getHealthState(health?.tools?.allAvailable)}
        onMouseEnter={() => setHoveredCard('tool')}
        onMouseLeave={() => setHoveredCard(null)}
      >
        <div className={styles.healthIcon}>🧰</div>
        <div className={styles.healthInfo}>
          <div className={styles.healthTitle}>工具服务</div>
          <div className={styles.healthStatus}>
            {health?.tools?.allAvailable ? '响应正常' : health?.tools ? '响应缓慢' : '-'}
          </div>
          <div className={styles.healthDesc}>
            {health?.tools ? `${health.tools.availableCount}/${health.tools.configuredCount} 工具可用` : '检查中...'}
          </div>
        </div>
        {hoveredCard === 'tool' && toolsData && (
          <div className={styles.healthTooltip}>
            <div className={styles.tooltipTitle}>配置工具列表</div>
            <div className={styles.tooltipContent}>
              {toolsData.configuredTools?.length > 0 ? (
                <ul className={styles.tooltipList}>
                  {toolsData.configuredTools.map((tool) => (
                    <li key={tool}>{tool}</li>
                  ))}
                </ul>
              ) : (
                <div className={styles.tooltipEmpty}>暂无配置工具</div>
              )}
            </div>
            <div className={styles.tooltipFooter}>
              共 {toolsData.count} 个工具 | 更新于 {toolsData.lastRefreshTime ? formatDateTime(toolsData.lastRefreshTime) : '-'}
            </div>
          </div>
        )}
      </article>

      {/* 品牌数据 */}
      <article
        className={`health-item ${styles.healthItem} ${styles.hoverable}`}
        data-state={getHealthState(health?.brandConfig?.available && health?.brandConfig?.synced)}
        onMouseEnter={() => setHoveredCard('brand')}
        onMouseLeave={() => setHoveredCard(null)}
      >
        <div className={styles.healthIcon}>🏷️</div>
        <div className={styles.healthInfo}>
          <div className={styles.healthTitle}>品牌数据</div>
          <div className={styles.healthStatus}>
            {health?.brandConfig?.available && health?.brandConfig?.synced
              ? '数据同步'
              : health?.brandConfig?.available
                ? '需同步'
                : '-'}
          </div>
          <div className={styles.healthDesc}>
            {health?.brandConfig?.available && health?.brandConfig?.synced
              ? `更新于 ${health.brandConfig.lastUpdated ? formatDateTime(health.brandConfig.lastUpdated) : '未知'}`
              : health?.brandConfig?.available
                ? '品牌数据待同步'
                : '检查中...'}
          </div>
        </div>
        {hoveredCard === 'brand' && brandData && (
          <div className={styles.healthTooltip}>
            <div className={styles.tooltipTitle}>品牌配置状态</div>
            <div className={styles.tooltipContent}>
              <div className={styles.tooltipStatusGrid}>
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>配置可用</span>
                  <span className={`${styles.statusValue} ${brandData.available ? styles.success : styles.error}`}>
                    {brandData.available ? '是' : '否'}
                  </span>
                </div>
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>数据已同步</span>
                  <span className={`${styles.statusValue} ${brandData.synced ? styles.success : styles.warning}`}>
                    {brandData.synced ? '是' : '否'}
                  </span>
                </div>
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>品牌数据</span>
                  <span className={`${styles.statusValue} ${brandData.hasBrandData ? styles.success : styles.warning}`}>
                    {brandData.hasBrandData ? '已加载' : '未加载'}
                  </span>
                </div>
                <div className={styles.statusRow}>
                  <span className={styles.statusLabel}>回复模板</span>
                  <span className={`${styles.statusValue} ${brandData.hasReplyPrompts ? styles.success : styles.warning}`}>
                    {brandData.hasReplyPrompts ? '已加载' : '未加载'}
                  </span>
                </div>
              </div>
            </div>
            <div className={styles.tooltipFooter}>
              更新于 {brandData.lastUpdated ? formatDateTime(brandData.lastUpdated) : '-'}
            </div>
          </div>
        )}
      </article>
    </div>
  );
}
