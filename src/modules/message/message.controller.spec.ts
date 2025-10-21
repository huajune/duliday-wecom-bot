import { Test, TestingModule } from '@nestjs/testing';
import { MessageController } from './message.controller';
import { MessageService } from './message.service';

describe('MessageController', () => {
  let controller: MessageController;
  let service: MessageService;

  const mockMessageService = {
    handleMessage: jest.fn(),
    handleSentResult: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MessageController],
      providers: [
        {
          provide: MessageService,
          useValue: mockMessageService,
        },
      ],
    }).compile();

    controller = module.get<MessageController>(MessageController);
    service = module.get<MessageService>(MessageService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('receiveMessage', () => {
    it('should call messageService.handleMessage with correct body', async () => {
      const mockBody = {
        msgId: '123',
        content: 'test message',
        fromUser: 'user1',
      };
      const mockResult = { success: true };

      mockMessageService.handleMessage.mockResolvedValue(mockResult);

      const result = await controller.receiveMessage(mockBody);

      expect(service.handleMessage).toHaveBeenCalledWith(mockBody);
      expect(result).toEqual(mockResult);
    });

    it('should handle empty message body', async () => {
      const mockBody = {};
      const mockResult = { success: false };

      mockMessageService.handleMessage.mockResolvedValue(mockResult);

      const result = await controller.receiveMessage(mockBody);

      expect(service.handleMessage).toHaveBeenCalledWith(mockBody);
      expect(result).toEqual(mockResult);
    });

    it('should handle errors from messageService.handleMessage', async () => {
      const mockBody = { msgId: '123' };
      const error = new Error('Service error');

      mockMessageService.handleMessage.mockRejectedValue(error);

      await expect(controller.receiveMessage(mockBody)).rejects.toThrow('Service error');
    });
  });

  describe('receiveSentResult', () => {
    it('should call messageService.handleSentResult with correct body', async () => {
      const mockBody = {
        msgId: '123',
        status: 'success',
        timestamp: 1234567890,
      };
      const mockResult = { received: true };

      mockMessageService.handleSentResult.mockResolvedValue(mockResult);

      const result = await controller.receiveSentResult(mockBody);

      expect(service.handleSentResult).toHaveBeenCalledWith(mockBody);
      expect(result).toEqual(mockResult);
    });

    it('should handle failed status in sent result', async () => {
      const mockBody = {
        msgId: '123',
        status: 'failed',
        error: 'Send failed',
      };
      const mockResult = { received: true };

      mockMessageService.handleSentResult.mockResolvedValue(mockResult);

      const result = await controller.receiveSentResult(mockBody);

      expect(service.handleSentResult).toHaveBeenCalledWith(mockBody);
      expect(result).toEqual(mockResult);
    });

    it('should handle errors from messageService.handleSentResult', async () => {
      const mockBody = { msgId: '123' };
      const error = new Error('Service error');

      mockMessageService.handleSentResult.mockRejectedValue(error);

      await expect(controller.receiveSentResult(mockBody)).rejects.toThrow('Service error');
    });
  });
});
