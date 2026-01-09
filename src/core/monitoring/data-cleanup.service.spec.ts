import { Test, TestingModule } from '@nestjs/testing';
import { DataCleanupService } from './data-cleanup.service';
import { SupabaseService } from '@core/supabase';
import {
  ChatMessageRepository,
  UserHostingRepository,
  MonitoringRepository,
} from '@core/supabase/repositories';

describe('DataCleanupService', () => {
  let service: DataCleanupService;
  let supabaseService: jest.Mocked<SupabaseService>;
  let chatMessageRepository: jest.Mocked<ChatMessageRepository>;
  let _userHostingRepository: jest.Mocked<UserHostingRepository>;
  let monitoringRepository: jest.Mocked<MonitoringRepository>;

  const mockSupabaseService = {
    isAvailable: jest.fn(),
  };

  const mockChatMessageRepository = {
    cleanupChatMessages: jest.fn(),
  };

  const mockUserHostingRepository = {
    cleanupUserActivity: jest.fn(),
  };

  const mockMonitoringRepository = {
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
        {
          provide: ChatMessageRepository,
          useValue: mockChatMessageRepository,
        },
        {
          provide: UserHostingRepository,
          useValue: mockUserHostingRepository,
        },
        {
          provide: MonitoringRepository,
          useValue: mockMonitoringRepository,
        },
      ],
    }).compile();

    service = module.get<DataCleanupService>(DataCleanupService);
    supabaseService = module.get(SupabaseService);
    chatMessageRepository = module.get(ChatMessageRepository);
    _userHostingRepository = module.get(UserHostingRepository);
    monitoringRepository = module.get(MonitoringRepository);

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
      mockChatMessageRepository.cleanupChatMessages.mockResolvedValue(10);
      mockMonitoringRepository.deleteMonitoringHourlyBefore.mockResolvedValue(5);

      await service.cleanupExpiredData();

      expect(chatMessageRepository.cleanupChatMessages).toHaveBeenCalledWith(60);
      expect(monitoringRepository.deleteMonitoringHourlyBefore).toHaveBeenCalled();
    });

    it('should skip cleanup when Supabase is not available', async () => {
      mockSupabaseService.isAvailable.mockReturnValue(false);

      await service.cleanupExpiredData();

      expect(chatMessageRepository.cleanupChatMessages).not.toHaveBeenCalled();
      expect(monitoringRepository.deleteMonitoringHourlyBefore).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully during chat message cleanup', async () => {
      mockSupabaseService.isAvailable.mockReturnValue(true);
      mockChatMessageRepository.cleanupChatMessages.mockRejectedValue(new Error('Database error'));
      mockMonitoringRepository.deleteMonitoringHourlyBefore.mockResolvedValue(0);

      // Should not throw
      await expect(service.cleanupExpiredData()).resolves.not.toThrow();
    });

    it('should handle errors gracefully during monitoring data cleanup', async () => {
      mockSupabaseService.isAvailable.mockReturnValue(true);
      mockChatMessageRepository.cleanupChatMessages.mockResolvedValue(0);
      mockMonitoringRepository.deleteMonitoringHourlyBefore.mockRejectedValue(
        new Error('Table not found'),
      );

      // Should not throw
      await expect(service.cleanupExpiredData()).resolves.not.toThrow();
    });
  });

  describe('triggerCleanup', () => {
    it('should return cleanup counts when Supabase is available', async () => {
      mockSupabaseService.isAvailable.mockReturnValue(true);
      mockChatMessageRepository.cleanupChatMessages.mockResolvedValue(15);
      mockUserHostingRepository.cleanupUserActivity.mockResolvedValue(3);
      mockMonitoringRepository.deleteMonitoringHourlyBefore.mockResolvedValue(8);

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
      expect(chatMessageRepository.cleanupChatMessages).not.toHaveBeenCalled();
    });

    it('should handle partial failures gracefully', async () => {
      mockSupabaseService.isAvailable.mockReturnValue(true);
      mockChatMessageRepository.cleanupChatMessages.mockRejectedValue(new Error('Error'));
      mockUserHostingRepository.cleanupUserActivity.mockResolvedValue(2);
      mockMonitoringRepository.deleteMonitoringHourlyBefore.mockResolvedValue(5);

      const result = await service.triggerCleanup();

      expect(result).toEqual({
        chatMessages: 0,
        userActivity: 2,
        monitoringData: 5,
      });
    });
  });
});
