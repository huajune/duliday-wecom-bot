import { Test, TestingModule } from '@nestjs/testing';
import { DataCleanupService } from './data-cleanup.service';
import { SupabaseService } from '@core/supabase';

describe('DataCleanupService', () => {
  let service: DataCleanupService;
  let supabaseService: jest.Mocked<SupabaseService>;

  const mockSupabaseService = {
    isAvailable: jest.fn(),
    cleanupChatMessages: jest.fn(),
    cleanupUserActivity: jest.fn(),
    deleteMonitoringHourlyBefore: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataCleanupService,
        {
          provide: SupabaseService,
          useValue: mockSupabaseService,
        },
      ],
    }).compile();

    service = module.get<DataCleanupService>(DataCleanupService);
    supabaseService = module.get(SupabaseService);

    // Reset mocks
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('onModuleInit', () => {
    it('should log enabled when Supabase is available', async () => {
      mockSupabaseService.isAvailable.mockReturnValue(true);
      await service.onModuleInit();
      expect(supabaseService.isAvailable).toHaveBeenCalled();
    });

    it('should log disabled when Supabase is not available', async () => {
      mockSupabaseService.isAvailable.mockReturnValue(false);
      await service.onModuleInit();
      expect(supabaseService.isAvailable).toHaveBeenCalled();
    });
  });

  describe('cleanupExpiredData', () => {
    it('should cleanup chat messages and monitoring data when Supabase is available', async () => {
      mockSupabaseService.isAvailable.mockReturnValue(true);
      mockSupabaseService.cleanupChatMessages.mockResolvedValue(10);
      mockSupabaseService.deleteMonitoringHourlyBefore.mockResolvedValue(5);

      await service.cleanupExpiredData();

      expect(supabaseService.cleanupChatMessages).toHaveBeenCalledWith(60);
      expect(supabaseService.deleteMonitoringHourlyBefore).toHaveBeenCalled();
    });

    it('should skip cleanup when Supabase is not available', async () => {
      mockSupabaseService.isAvailable.mockReturnValue(false);

      await service.cleanupExpiredData();

      expect(supabaseService.cleanupChatMessages).not.toHaveBeenCalled();
      expect(supabaseService.deleteMonitoringHourlyBefore).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully during chat message cleanup', async () => {
      mockSupabaseService.isAvailable.mockReturnValue(true);
      mockSupabaseService.cleanupChatMessages.mockRejectedValue(new Error('Database error'));
      mockSupabaseService.deleteMonitoringHourlyBefore.mockResolvedValue(0);

      // Should not throw
      await expect(service.cleanupExpiredData()).resolves.not.toThrow();
    });

    it('should handle errors gracefully during monitoring data cleanup', async () => {
      mockSupabaseService.isAvailable.mockReturnValue(true);
      mockSupabaseService.cleanupChatMessages.mockResolvedValue(0);
      mockSupabaseService.deleteMonitoringHourlyBefore.mockRejectedValue(
        new Error('Table not found'),
      );

      // Should not throw
      await expect(service.cleanupExpiredData()).resolves.not.toThrow();
    });
  });

  describe('triggerCleanup', () => {
    it('should return cleanup counts when Supabase is available', async () => {
      mockSupabaseService.isAvailable.mockReturnValue(true);
      mockSupabaseService.cleanupChatMessages.mockResolvedValue(15);
      mockSupabaseService.cleanupUserActivity.mockResolvedValue(3);
      mockSupabaseService.deleteMonitoringHourlyBefore.mockResolvedValue(8);

      const result = await service.triggerCleanup();

      expect(result).toEqual({
        chatMessages: 15,
        userActivity: 3,
        monitoringData: 8,
      });
    });

    it('should return zeros when Supabase is not available', async () => {
      mockSupabaseService.isAvailable.mockReturnValue(false);

      const result = await service.triggerCleanup();

      expect(result).toEqual({
        chatMessages: 0,
        userActivity: 0,
        monitoringData: 0,
      });
      expect(supabaseService.cleanupChatMessages).not.toHaveBeenCalled();
    });

    it('should handle partial failures gracefully', async () => {
      mockSupabaseService.isAvailable.mockReturnValue(true);
      mockSupabaseService.cleanupChatMessages.mockRejectedValue(new Error('Error'));
      mockSupabaseService.cleanupUserActivity.mockResolvedValue(2);
      mockSupabaseService.deleteMonitoringHourlyBefore.mockResolvedValue(5);

      const result = await service.triggerCleanup();

      expect(result).toEqual({
        chatMessages: 0,
        userActivity: 2,
        monitoringData: 5,
      });
    });
  });
});
