import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BacklogItemRepository, type BacklogItem, type CreateBacklogItemInput } from './backlog-items.js';
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Create a mock Supabase client for testing BacklogItemRepository.
 *
 * Handles two patterns:
 * 1. Chains ending in .single() — create, getById, getBySourceFile, update, updateStatus
 *    → returns { data, error } synchronously from single()
 * 2. Chains ending in .order() / .eq() without single() — list, delete
 *    → returns a thenable { data, error } that can be awaited
 */
function createMockClient() {
  const mockSingleResult = {
    data: null as unknown,
    error: null as { message: string; code?: string } | null,
  };

  const mockQueryResult = {
    data: null as unknown,
    error: null as { message: string } | null,
  };

  // For delete chain — separate result since delete doesn't return data
  const mockDeleteResult = {
    error: null as { message: string } | null,
  };

  function makeThenableQuery() {
    const result: Record<string, unknown> = { ...chainMethods };
    Object.defineProperty(result, 'then', {
      value: (resolve: (val: unknown) => void) => {
        resolve(mockQueryResult);
        return Promise.resolve(mockQueryResult);
      },
    });
    return result;
  }

  function makeThenableDelete() {
    const result: Record<string, unknown> = {};
    Object.defineProperty(result, 'then', {
      value: (resolve: (val: unknown) => void) => {
        resolve(mockDeleteResult);
        return Promise.resolve(mockDeleteResult);
      },
    });
    return result;
  }

  const chainMethods: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn().mockImplementation(() => makeThenableQuery()),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
    eq: vi.fn().mockImplementation(() => makeThenableQuery()),
    contains: vi.fn().mockImplementation(() => makeThenableQuery()),
    order: vi.fn().mockImplementation(() => makeThenableQuery()),
    single: vi.fn().mockImplementation(() => mockSingleResult),
  };

  // Stable inner mocks for insert chain: insert().select().single()
  const insertChain = {
    insert: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
  };

  insertChain.single.mockImplementation(() => mockSingleResult);
  insertChain.select.mockImplementation(() => ({ ...chainMethods, single: insertChain.single }));
  chainMethods.insert.mockImplementation((...args: unknown[]) => {
    insertChain.insert(...args);
    return {
      ...chainMethods,
      select: insertChain.select,
    };
  });

  // Stable inner mocks for update chain: update().eq().select().single()
  const updateChain = {
    update: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    single: vi.fn(),
  };

  updateChain.single.mockImplementation(() => mockSingleResult);
  updateChain.select.mockImplementation(() => ({ ...chainMethods, single: updateChain.single }));
  updateChain.eq.mockImplementation(() => ({
    ...chainMethods,
    select: updateChain.select,
  }));
  chainMethods.update.mockImplementation((...args: unknown[]) => {
    updateChain.update(...args);
    return {
      ...chainMethods,
      eq: updateChain.eq,
    };
  });

  // Stable inner mocks for delete chain: delete().eq()
  const deleteChain = {
    eq: vi.fn().mockImplementation(() => makeThenableDelete()),
  };
  chainMethods.delete.mockImplementation(() => ({
    eq: deleteChain.eq,
  }));

  // Inner chain mocks returned by select() for getById/getBySourceFile and list queries
  const innerOrder = vi.fn().mockImplementation(() => {
    const orderResult: Record<string, unknown> = {
      ...chainMethods,
      order: vi.fn().mockImplementation(() => makeThenableQuery()),
    };
    Object.defineProperty(orderResult, 'then', {
      value: (resolve: (val: unknown) => void) => {
        resolve(mockQueryResult);
        return Promise.resolve(mockQueryResult);
      },
    });
    return orderResult;
  });

  const innerContains = vi.fn().mockImplementation(() => {
    const containsResult: Record<string, unknown> = {
      ...chainMethods,
      contains: vi.fn().mockImplementation(() => makeThenableQuery()),
      order: innerOrder,
    };
    Object.defineProperty(containsResult, 'then', {
      value: (resolve: (val: unknown) => void) => {
        resolve(mockQueryResult);
        return Promise.resolve(mockQueryResult);
      },
    });
    return containsResult;
  });

  const innerEq = vi.fn().mockImplementation(() => {
    const eqResult: Record<string, unknown> = {
      ...chainMethods,
      single: vi.fn().mockImplementation(() => mockSingleResult),
      order: innerOrder,
      contains: innerContains,
      eq: vi.fn().mockImplementation(() => {
        const nestedEqResult: Record<string, unknown> = {
          ...chainMethods,
          order: innerOrder,
          contains: innerContains,
        };
        Object.defineProperty(nestedEqResult, 'then', {
          value: (resolve: (val: unknown) => void) => {
            resolve(mockQueryResult);
            return Promise.resolve(mockQueryResult);
          },
        });
        return nestedEqResult;
      }),
    };
    Object.defineProperty(eqResult, 'then', {
      value: (resolve: (val: unknown) => void) => {
        resolve(mockQueryResult);
        return Promise.resolve(mockQueryResult);
      },
    });
    return eqResult;
  });

  // select() returns object with eq, contains, order for list queries
  chainMethods.select.mockImplementation(() => {
    const selectResult: Record<string, unknown> = {
      ...chainMethods,
      eq: innerEq,
      contains: innerContains,
      order: innerOrder,
    };
    Object.defineProperty(selectResult, 'then', {
      value: (resolve: (val: unknown) => void) => {
        resolve(mockQueryResult);
        return Promise.resolve(mockQueryResult);
      },
    });
    return selectResult;
  });

  const mockClient = {
    from: vi.fn().mockReturnValue(chainMethods),
  };

  return {
    client: mockClient as unknown as SupabaseClient,
    setSingleResult: (data: unknown, error: { message: string; code?: string } | null = null) => {
      mockSingleResult.data = data;
      mockSingleResult.error = error;
    },
    setQueryResult: (data: unknown, error: { message: string } | null = null) => {
      mockQueryResult.data = data;
      mockQueryResult.error = error;
    },
    setDeleteResult: (error: { message: string } | null = null) => {
      mockDeleteResult.error = error;
    },
    chainMethods,
    innerChainMethods: { eq: innerEq, contains: innerContains, order: innerOrder },
    insertChain,
    updateChain,
    deleteChain,
    mockClient,
  };
}

function makeBacklogItem(overrides: Partial<BacklogItem> = {}): BacklogItem {
  return {
    id: 'item-001',
    project_id: 'proj-001',
    title: 'Test backlog item',
    description: 'A test item',
    type: 'feature',
    priority: 'medium',
    impact_score: null,
    complexity_estimate: null,
    estimated_sessions_opus: 0,
    estimated_sessions_sonnet: 0,
    status: 'proposed',
    reasoning: null,
    acceptance_criteria: null,
    tags: [],
    related_items: [],
    proposal_ids: [],
    task_ids: [],
    source: 'user',
    source_file: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    reviewed_at: null,
    implemented_at: null,
    ...overrides,
  };
}

describe('BacklogItemRepository', () => {
  let mock: ReturnType<typeof createMockClient>;
  let repo: BacklogItemRepository;

  beforeEach(() => {
    mock = createMockClient();
    repo = new BacklogItemRepository(mock.client);
  });

  describe('create', () => {
    it('should create a backlog item with defaults', async () => {
      const input: CreateBacklogItemInput = {
        title: 'New feature',
        description: 'Feature description',
        type: 'feature',
      };
      const expected = makeBacklogItem({ title: 'New feature', description: 'Feature description' });
      mock.setSingleResult(expected);

      const result = await repo.create(input);

      expect(result).toEqual(expected);
      expect(mock.client.from).toHaveBeenCalledWith('tc_backlog_items');
      expect(mock.insertChain.insert).toHaveBeenCalledWith({
        project_id: null,
        title: 'New feature',
        description: 'Feature description',
        type: 'feature',
        priority: 'medium',
        impact_score: null,
        complexity_estimate: null,
        estimated_sessions_opus: 0,
        estimated_sessions_sonnet: 0,
        reasoning: null,
        acceptance_criteria: null,
        tags: [],
        related_items: [],
        source: 'user',
        source_file: null,
      });
    });

    it('should create a backlog item with all optional fields', async () => {
      const input: CreateBacklogItemInput = {
        project_id: 'proj-001',
        title: 'Full feature',
        description: 'Detailed description',
        type: 'enhancement',
        priority: 'high',
        impact_score: 'high',
        complexity_estimate: 'large',
        estimated_sessions_opus: 3,
        estimated_sessions_sonnet: 5,
        reasoning: 'High value',
        acceptance_criteria: 'Tests pass',
        tags: ['backend', 'api'],
        related_items: ['item-002'],
        source: 'agent',
        source_file: '/path/to/file.md',
      };
      const expected = makeBacklogItem({
        project_id: 'proj-001',
        title: 'Full feature',
        type: 'enhancement',
        priority: 'high',
      });
      mock.setSingleResult(expected);

      const result = await repo.create(input);

      expect(result).toEqual(expected);
      expect(mock.insertChain.insert).toHaveBeenCalledWith({
        project_id: 'proj-001',
        title: 'Full feature',
        description: 'Detailed description',
        type: 'enhancement',
        priority: 'high',
        impact_score: 'high',
        complexity_estimate: 'large',
        estimated_sessions_opus: 3,
        estimated_sessions_sonnet: 5,
        reasoning: 'High value',
        acceptance_criteria: 'Tests pass',
        tags: ['backend', 'api'],
        related_items: ['item-002'],
        source: 'agent',
        source_file: '/path/to/file.md',
      });
    });

    it('should throw on insert error', async () => {
      mock.setSingleResult(null, { message: 'Duplicate key violation' });

      await expect(
        repo.create({ title: 'Test', description: 'Test', type: 'feature' })
      ).rejects.toThrow('Failed to create backlog item: Duplicate key violation');
    });
  });

  describe('getById', () => {
    it('should return a backlog item when found', async () => {
      const item = makeBacklogItem();
      mock.setSingleResult(item);

      const result = await repo.getById('item-001');

      expect(result).toEqual(item);
      expect(mock.client.from).toHaveBeenCalledWith('tc_backlog_items');
      expect(mock.innerChainMethods.eq).toHaveBeenCalledWith('id', 'item-001');
    });

    it('should return null when item not found (PGRST116)', async () => {
      mock.setSingleResult(null, { message: 'Row not found', code: 'PGRST116' });

      const result = await repo.getById('nonexistent');

      expect(result).toBeNull();
    });

    it('should throw on other errors', async () => {
      mock.setSingleResult(null, { message: 'Connection refused' });

      await expect(repo.getById('item-001')).rejects.toThrow(
        'Failed to get backlog item: Connection refused'
      );
    });
  });

  describe('list', () => {
    it('should list all items without filter', async () => {
      const items = [makeBacklogItem(), makeBacklogItem({ id: 'item-002', title: 'Second' })];
      mock.setQueryResult(items);

      const result = await repo.list();

      expect(result).toEqual(items);
      expect(result).toHaveLength(2);
      expect(mock.client.from).toHaveBeenCalledWith('tc_backlog_items');
    });

    it('should filter by project_id', async () => {
      const items = [makeBacklogItem()];
      mock.setQueryResult(items);

      const result = await repo.list({ project_id: 'proj-001' });

      expect(result).toEqual(items);
      expect(mock.innerChainMethods.eq).toHaveBeenCalledWith('project_id', 'proj-001');
    });

    it('should filter by status', async () => {
      const items = [makeBacklogItem({ status: 'accepted' })];
      mock.setQueryResult(items);

      const result = await repo.list({ status: 'accepted' });

      expect(result).toEqual(items);
    });

    it('should filter by priority', async () => {
      const items = [makeBacklogItem({ priority: 'high' })];
      mock.setQueryResult(items);

      const result = await repo.list({ priority: 'high' });

      expect(result).toEqual(items);
    });

    it('should filter by type', async () => {
      const items = [makeBacklogItem({ type: 'enhancement' })];
      mock.setQueryResult(items);

      const result = await repo.list({ type: 'enhancement' });

      expect(result).toEqual(items);
    });

    it('should filter by tags using contains', async () => {
      const items = [makeBacklogItem({ tags: ['backend'] })];
      mock.setQueryResult(items);

      const result = await repo.list({ tags: ['backend'] });

      expect(result).toEqual(items);
    });

    it('should call contains for each tag when multiple tags provided', async () => {
      const items = [makeBacklogItem({ tags: ['backend', 'api'] })];
      mock.setQueryResult(items);

      const result = await repo.list({ tags: ['backend', 'api'] });

      expect(result).toEqual(items);
    });

    it('should apply multiple filters simultaneously', async () => {
      const items = [makeBacklogItem({ project_id: 'proj-001', status: 'accepted', priority: 'high' })];
      mock.setQueryResult(items);

      const result = await repo.list({ project_id: 'proj-001', status: 'accepted', priority: 'high' });

      expect(result).toEqual(items);
    });

    it('should return empty array on success with no data', async () => {
      mock.setQueryResult([]);

      const result = await repo.list();

      expect(result).toEqual([]);
    });

    it('should throw on query error', async () => {
      mock.setQueryResult(null, { message: 'Query timeout' });

      await expect(repo.list()).rejects.toThrow(
        'Failed to list backlog items: Query timeout'
      );
    });
  });

  describe('update', () => {
    it('should update and return the item', async () => {
      const updated = makeBacklogItem({ title: 'Updated title', priority: 'high' });
      mock.setSingleResult(updated);

      const result = await repo.update('item-001', { title: 'Updated title', priority: 'high' });

      expect(result).toEqual(updated);
      expect(mock.client.from).toHaveBeenCalledWith('tc_backlog_items');
      expect(mock.updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Updated title',
          priority: 'high',
          updated_at: expect.any(String),
        })
      );
      expect(mock.updateChain.eq).toHaveBeenCalledWith('id', 'item-001');
    });

    it('should throw on update error', async () => {
      mock.setSingleResult(null, { message: 'Update failed' });

      await expect(
        repo.update('item-001', { title: 'New' })
      ).rejects.toThrow('Failed to update backlog item: Update failed');
    });
  });

  describe('updateStatus', () => {
    it('should update status for a regular status', async () => {
      const updated = makeBacklogItem({ status: 'accepted' });
      mock.setSingleResult(updated);

      const result = await repo.updateStatus('item-001', 'accepted');

      expect(result).toEqual(updated);
      expect(mock.updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'accepted',
          updated_at: expect.any(String),
        })
      );
    });

    it('should set reviewed_at when status is in_review', async () => {
      const updated = makeBacklogItem({ status: 'in_review', reviewed_at: '2024-01-01T12:00:00Z' });
      mock.setSingleResult(updated);

      const result = await repo.updateStatus('item-001', 'in_review');

      expect(result).toEqual(updated);
      expect(mock.updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'in_review',
          reviewed_at: expect.any(String),
          updated_at: expect.any(String),
        })
      );
    });

    it('should set implemented_at when status is implemented', async () => {
      const updated = makeBacklogItem({ status: 'implemented', implemented_at: '2024-01-01T12:00:00Z' });
      mock.setSingleResult(updated);

      const result = await repo.updateStatus('item-001', 'implemented');

      expect(result).toEqual(updated);
      expect(mock.updateChain.update).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'implemented',
          implemented_at: expect.any(String),
          updated_at: expect.any(String),
        })
      );
    });

    it('should NOT set reviewed_at for non-review statuses', async () => {
      const updated = makeBacklogItem({ status: 'accepted' });
      mock.setSingleResult(updated);

      await repo.updateStatus('item-001', 'accepted');

      const updatePayload = mock.updateChain.update.mock.calls[0][0];
      expect(updatePayload).not.toHaveProperty('reviewed_at');
    });

    it('should NOT set implemented_at for non-implemented statuses', async () => {
      const updated = makeBacklogItem({ status: 'in_review' });
      mock.setSingleResult(updated);

      await repo.updateStatus('item-001', 'in_review');

      const updatePayload = mock.updateChain.update.mock.calls[0][0];
      expect(updatePayload).not.toHaveProperty('implemented_at');
    });

    it('should throw on update status error', async () => {
      mock.setSingleResult(null, { message: 'Status update failed' });

      await expect(
        repo.updateStatus('item-001', 'accepted')
      ).rejects.toThrow('Failed to update backlog item status: Status update failed');
    });
  });

  describe('delete', () => {
    it('should delete without error', async () => {
      mock.setDeleteResult(null);

      await expect(repo.delete('item-001')).resolves.toBeUndefined();
      expect(mock.client.from).toHaveBeenCalledWith('tc_backlog_items');
      expect(mock.deleteChain.eq).toHaveBeenCalledWith('id', 'item-001');
    });

    it('should throw on delete error', async () => {
      mock.setDeleteResult({ message: 'Foreign key constraint' });

      await expect(repo.delete('item-001')).rejects.toThrow(
        'Failed to delete backlog item: Foreign key constraint'
      );
    });
  });

  describe('linkProposal', () => {
    it('should append proposal id to existing proposal_ids', async () => {
      const existingItem = makeBacklogItem({ proposal_ids: ['prop-001'] });
      // First call: getById returns the existing item (single result)
      mock.setSingleResult(existingItem);

      // The update call will also use setSingleResult
      const updatedItem = makeBacklogItem({ proposal_ids: ['prop-001', 'prop-002'] });

      // We need getById to succeed, then update to succeed
      // Both use the same mockSingleResult, so we chain via spy
      const getByIdSpy = vi.spyOn(repo, 'getById').mockResolvedValue(existingItem);
      const updateSpy = vi.spyOn(repo, 'update').mockResolvedValue(updatedItem);

      const result = await repo.linkProposal('item-001', 'prop-002');

      expect(result).toEqual(updatedItem);
      expect(getByIdSpy).toHaveBeenCalledWith('item-001');
      expect(updateSpy).toHaveBeenCalledWith('item-001', { proposal_ids: ['prop-001', 'prop-002'] });
    });

    it('should append to empty proposal_ids array', async () => {
      const existingItem = makeBacklogItem({ proposal_ids: [] });
      const updatedItem = makeBacklogItem({ proposal_ids: ['prop-001'] });

      vi.spyOn(repo, 'getById').mockResolvedValue(existingItem);
      vi.spyOn(repo, 'update').mockResolvedValue(updatedItem);

      const result = await repo.linkProposal('item-001', 'prop-001');

      expect(result).toEqual(updatedItem);
    });

    it('should throw when item not found', async () => {
      vi.spyOn(repo, 'getById').mockResolvedValue(null);

      await expect(
        repo.linkProposal('nonexistent', 'prop-001')
      ).rejects.toThrow('Backlog item not found: nonexistent');
    });
  });

  describe('linkTask', () => {
    it('should append task id to existing task_ids', async () => {
      const existingItem = makeBacklogItem({ task_ids: ['task-001'] });
      const updatedItem = makeBacklogItem({ task_ids: ['task-001', 'task-002'] });

      const getByIdSpy = vi.spyOn(repo, 'getById').mockResolvedValue(existingItem);
      const updateSpy = vi.spyOn(repo, 'update').mockResolvedValue(updatedItem);

      const result = await repo.linkTask('item-001', 'task-002');

      expect(result).toEqual(updatedItem);
      expect(getByIdSpy).toHaveBeenCalledWith('item-001');
      expect(updateSpy).toHaveBeenCalledWith('item-001', { task_ids: ['task-001', 'task-002'] });
    });

    it('should append to empty task_ids array', async () => {
      const existingItem = makeBacklogItem({ task_ids: [] });
      const updatedItem = makeBacklogItem({ task_ids: ['task-001'] });

      vi.spyOn(repo, 'getById').mockResolvedValue(existingItem);
      vi.spyOn(repo, 'update').mockResolvedValue(updatedItem);

      const result = await repo.linkTask('item-001', 'task-001');

      expect(result).toEqual(updatedItem);
    });

    it('should throw when item not found', async () => {
      vi.spyOn(repo, 'getById').mockResolvedValue(null);

      await expect(
        repo.linkTask('nonexistent', 'task-001')
      ).rejects.toThrow('Backlog item not found: nonexistent');
    });
  });

  describe('getBySourceFile', () => {
    it('should return item when found', async () => {
      const item = makeBacklogItem({ source_file: '/path/to/file.md' });
      mock.setSingleResult(item);

      const result = await repo.getBySourceFile('/path/to/file.md');

      expect(result).toEqual(item);
      expect(mock.client.from).toHaveBeenCalledWith('tc_backlog_items');
      expect(mock.innerChainMethods.eq).toHaveBeenCalledWith('source_file', '/path/to/file.md');
    });

    it('should return null when not found (PGRST116)', async () => {
      mock.setSingleResult(null, { message: 'Row not found', code: 'PGRST116' });

      const result = await repo.getBySourceFile('/nonexistent.md');

      expect(result).toBeNull();
    });

    it('should throw on other errors', async () => {
      mock.setSingleResult(null, { message: 'Database error' });

      await expect(
        repo.getBySourceFile('/path/to/file.md')
      ).rejects.toThrow('Failed to get backlog item by source file: Database error');
    });
  });

  describe('convenience query methods', () => {
    it('getByStatus should delegate to list with status filter', async () => {
      const listSpy = vi.spyOn(repo, 'list').mockResolvedValue([makeBacklogItem({ status: 'accepted' })]);

      const result = await repo.getByStatus('accepted');

      expect(listSpy).toHaveBeenCalledWith({ status: 'accepted' });
      expect(result).toHaveLength(1);
    });

    it('getByPriority should delegate to list with priority filter', async () => {
      const listSpy = vi.spyOn(repo, 'list').mockResolvedValue([makeBacklogItem({ priority: 'high' })]);

      const result = await repo.getByPriority('high');

      expect(listSpy).toHaveBeenCalledWith({ priority: 'high' });
      expect(result).toHaveLength(1);
    });

    it('getByType should delegate to list with type filter', async () => {
      const listSpy = vi.spyOn(repo, 'list').mockResolvedValue([makeBacklogItem({ type: 'security' })]);

      const result = await repo.getByType('security');

      expect(listSpy).toHaveBeenCalledWith({ type: 'security' });
      expect(result).toHaveLength(1);
    });

    it('getByProject should delegate to list with project_id filter', async () => {
      const listSpy = vi.spyOn(repo, 'list').mockResolvedValue([makeBacklogItem()]);

      const result = await repo.getByProject('proj-001');

      expect(listSpy).toHaveBeenCalledWith({ project_id: 'proj-001' });
      expect(result).toHaveLength(1);
    });

    it('getByTag should delegate to list with tags filter', async () => {
      const listSpy = vi.spyOn(repo, 'list').mockResolvedValue([makeBacklogItem({ tags: ['backend'] })]);

      const result = await repo.getByTag('backend');

      expect(listSpy).toHaveBeenCalledWith({ tags: ['backend'] });
      expect(result).toHaveLength(1);
    });
  });
});
