import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MonitoringPersistService, MonitoringHourlyData } from './monitoring-persist.service';
import { SupabaseService } from '@core/supabase';
import { MonitoringService } from './monitoring.service';

describe('MonitoringPersistService', () => {
  let service: MonitoringPersistService;
  let _supabaseService: SupabaseService;
  let _monitoringService: MonitoringService;

  const mockSupabaseService = {
    isAvailable: jest.fn().mockReturnValue(true),
    upsertMonitoringHourly: jest.fn(),
    deleteMonitoringHourlyBefore: jest.fn(),
    getMonitoringHourlyHistory: jest.fn(),
  };

  const mockMonitoringService = {
    getMetricsData: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue('true'),
  };

  const mockMetricsData = {
    detailRecords: [
      {
        messageId: 'msg1',
        chatId: 'chat1',
        receivedAt: Date.now(),
        status: 'success' as const,
        tokenUsage: 500,
      },
      {
        messageId: 'msg2',
        chatId: 'chat2',
        receivedAt: Date.now(),
        status: 'success' as const,
        tokenUsage: 300,
      },
    ],
    hourlyStats: [
      {
        hour: new Date().toISOString().replace(/:\d{2}:\d{2}\.\d{3}Z$/, ':00:00.000Z'),
        messageCount: 10,
        successCount: 9,
        failureCount: 1,
        successRate: 90,
        avgDuration: 5000,
        minDuration: 2000,
        maxDuration: 10000,
        p50Duration: 4500,
        p95Duration: 8000,
        p99Duration: 9500,
        avgAiDuration: 4000,
        avgSendDuration: 1000,
        activeUsers: 5,
        activeChats: 3,
      },
    ],
    globalCounters: {
      totalMessages: 100,
      totalSuccess: 95,
      totalFailure: 5,
      totalAiDuration: 50000,
      totalSendDuration: 10000,
      totalFallback: 2,
      totalFallbackSuccess: 1,
    },
    percentiles: { p50: 4500, p95: 8000, p99: 9500, p999: 10000 },
    slowestRecords: [],
  };

  beforeEach(async () => {
    // Reset mocks
    jest.clearAllMocks();
    mockSupabaseService.isAvailable.mockReturnValue(true);
    mockConfigService.get.mockReturnValue('true');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MonitoringPersistService,
        {
          provide: SupabaseService,
          useValue: mockSupabaseService,
        },
        {
          provide: MonitoringService,
          useValue: mockMonitoringService,
        },
        {
          provide: ConfigService,
          useValue: mockConfigService,
        },
      ],
    }).compile();

    service = module.get<MonitoringPersistService>(MonitoringPersistService);
    _supabaseService = module.get<SupabaseService>(SupabaseService);
    _monitoringService = module.get<MonitoringService>(MonitoringService);

    mockMonitoringService.getMetricsData.mockReturnValue(mockMetricsData);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should log enabled message when Supabase is available', async () => {
      await service.onModuleInit();
      // Service should be enabled
      expect(mockSupabaseService.isAvailable).toHaveBeenCalled();
    });
  });

  describe('syncHourlyData', () => {
    it('should sync hourly data to Supabase', async () => {
      mockSupabaseService.upsertMonitoringHourly.mockResolvedValue(undefined);

      await service.syncHourlyData();

      expect(mockMonitoringService.getMetricsData).toHaveBeenCalled();
      expect(mockSupabaseService.upsertMonitoringHourly).toHaveBeenCalledWith(
        expect.objectContaining({
          hour: expect.any(String),
          message_count: expect.any(Number),
          success_count: expect.any(Number),
          failure_count: expect.any(Number),
          avg_duration: expect.any(Number),
          p95_duration: expect.any(Number),
          active_users: expect.any(Number),
          active_chats: expect.any(Number),
          total_tokens: expect.any(Number),
        }),
      );
    });

    it('should handle Supabase errors gracefully', async () => {
      mockSupabaseService.upsertMonitoringHourly.mockRejectedValue(
        new Error('Supabase connection failed'),
      );

      // Should not throw
      await expect(service.syncHourlyData()).resolves.not.toThrow();
    });
  });

  describe('cleanupExpiredData', () => {
    it('should delete old records from Supabase', async () => {
      mockSupabaseService.deleteMonitoringHourlyBefore.mockResolvedValue(10);

      await service.cleanupExpiredData();

      expect(mockSupabaseService.deleteMonitoringHourlyBefore).toHaveBeenCalledWith(
        expect.any(Date),
      );
    });

    it('should handle deletion errors gracefully', async () => {
      mockSupabaseService.deleteMonitoringHourlyBefore.mockRejectedValue(
        new Error('Delete failed'),
      );

      // Should not throw
      await expect(service.cleanupExpiredData()).resolves.not.toThrow();
    });
  });

  describe('getHistoricalData', () => {
    it('should fetch historical data from Supabase', async () => {
      const mockHistory: MonitoringHourlyData[] = [
        {
          hour: new Date().toISOString(),
          message_count: 10,
          success_count: 9,
          failure_count: 1,
          avg_duration: 5000,
          p95_duration: 8000,
          active_users: 5,
          active_chats: 3,
          total_tokens: 800,
        },
      ];

      mockSupabaseService.getMonitoringHourlyHistory.mockResolvedValue(mockHistory);

      const result = await service.getHistoricalData(7);

      expect(result).toEqual(mockHistory);
      expect(mockSupabaseService.getMonitoringHourlyHistory).toHaveBeenCalledWith(7);
    });
  });

  describe('triggerSync', () => {
    it('should manually trigger sync and return data', async () => {
      mockSupabaseService.upsertMonitoringHourly.mockResolvedValue(undefined);

      const result = await service.triggerSync();

      expect(result).toMatchObject({
        hour: expect.any(String),
        message_count: expect.any(Number),
        success_count: expect.any(Number),
        failure_count: expect.any(Number),
      });
      expect(mockSupabaseService.upsertMonitoringHourly).toHaveBeenCalled();
    });
  });

  describe('when disabled', () => {
    beforeEach(async () => {
      mockSupabaseService.isAvailable.mockReturnValue(false);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          MonitoringPersistService,
          {
            provide: SupabaseService,
            useValue: mockSupabaseService,
          },
          {
            provide: MonitoringService,
            useValue: mockMonitoringService,
          },
          {
            provide: ConfigService,
            useValue: mockConfigService,
          },
        ],
      }).compile();

      service = module.get<MonitoringPersistService>(MonitoringPersistService);
    });

    it('should not sync when disabled', async () => {
      await service.syncHourlyData();

      expect(mockSupabaseService.upsertMonitoringHourly).not.toHaveBeenCalled();
    });

    it('should still cleanup when disabled (cleanup runs regardless of enabled state)', async () => {
      await service.cleanupExpiredData();

      // 清理任务始终运行，不受 enabled 状态影响
      expect(mockSupabaseService.deleteMonitoringHourlyBefore).toHaveBeenCalled();
    });

    it('should return empty array for getHistoricalData when disabled', async () => {
      const result = await service.getHistoricalData(7);

      expect(result).toEqual([]);
    });
  });
});
