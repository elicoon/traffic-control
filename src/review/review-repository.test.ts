import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { ReviewRepository, VisualReview } from './review-repository.js';
import { TaskRepository } from '../db/repositories/tasks.js';
import { ProjectRepository } from '../db/repositories/projects.js';
import { createSupabaseClient } from '../db/client.js';

describe('ReviewRepository', () => {
  let repo: ReviewRepository;
  let taskRepo: TaskRepository;
  let projectRepo: ProjectRepository;
  let testProjectId: string;
  let testTaskId: string;
  let testReviewIds: string[] = [];

  beforeAll(async () => {
    const client = createSupabaseClient();
    repo = new ReviewRepository(client);
    taskRepo = new TaskRepository(client);
    projectRepo = new ProjectRepository(client);

    // Create a test project
    const project = await projectRepo.create({
      name: 'Visual Review Test Project',
      description: 'Test project for visual reviews',
      priority: 1
    });
    testProjectId = project.id;

    // Create a test task
    const task = await taskRepo.create({
      project_id: testProjectId,
      title: 'Visual Review Test Task',
      description: 'A task that requires visual review',
      requires_visual_review: true
    });
    testTaskId = task.id;
  });

  afterAll(async () => {
    // Clean up test reviews
    for (const id of testReviewIds) {
      try {
        await repo.delete(id);
      } catch {
        // Ignore errors during cleanup
      }
    }
    // Clean up test task and project
    if (testTaskId) {
      await taskRepo.delete(testTaskId);
    }
    if (testProjectId) {
      await projectRepo.delete(testProjectId);
    }
  });

  describe('create', () => {
    it('should create a visual review with minimal fields', async () => {
      const review = await repo.create({
        taskId: testTaskId,
        status: 'pending'
      });

      testReviewIds.push(review.id);

      expect(review.id).toBeDefined();
      expect(review.taskId).toBe(testTaskId);
      expect(review.status).toBe('pending');
      expect(review.createdAt).toBeInstanceOf(Date);
      expect(review.reviewedAt).toBeUndefined();
    });

    it('should create a visual review with all fields', async () => {
      const review = await repo.create({
        taskId: testTaskId,
        sessionId: '123e4567-e89b-12d3-a456-426614174000',
        screenshotUrl: 'https://example.com/screenshot.png',
        screenshotPath: '/screenshots/test.png',
        status: 'pending',
        slackMessageTs: '1234567890.123456',
        slackThreadTs: '1234567890.000000'
      });

      testReviewIds.push(review.id);

      expect(review.id).toBeDefined();
      expect(review.taskId).toBe(testTaskId);
      expect(review.sessionId).toBe('123e4567-e89b-12d3-a456-426614174000');
      expect(review.screenshotUrl).toBe('https://example.com/screenshot.png');
      expect(review.screenshotPath).toBe('/screenshots/test.png');
      expect(review.slackMessageTs).toBe('1234567890.123456');
      expect(review.slackThreadTs).toBe('1234567890.000000');
    });
  });

  describe('getById', () => {
    it('should get a review by id', async () => {
      const created = await repo.create({
        taskId: testTaskId,
        status: 'pending'
      });
      testReviewIds.push(created.id);

      const retrieved = await repo.getById(created.id);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.taskId).toBe(testTaskId);
    });

    it('should return null for non-existent id', async () => {
      const result = await repo.getById('00000000-0000-0000-0000-000000000000');
      expect(result).toBeNull();
    });
  });

  describe('getByTaskId', () => {
    it('should get all reviews for a task', async () => {
      // Create multiple reviews for the same task
      const review1 = await repo.create({
        taskId: testTaskId,
        status: 'pending'
      });
      testReviewIds.push(review1.id);

      const review2 = await repo.create({
        taskId: testTaskId,
        status: 'pending'
      });
      testReviewIds.push(review2.id);

      const reviews = await repo.getByTaskId(testTaskId);
      expect(reviews.length).toBeGreaterThanOrEqual(2);
      expect(reviews.some(r => r.id === review1.id)).toBe(true);
      expect(reviews.some(r => r.id === review2.id)).toBe(true);
    });

    it('should return empty array for task with no reviews', async () => {
      // Create a new task with no reviews
      const task = await taskRepo.create({
        project_id: testProjectId,
        title: 'Task with no reviews'
      });

      const reviews = await repo.getByTaskId(task.id);
      expect(reviews).toEqual([]);

      // Cleanup
      await taskRepo.delete(task.id);
    });
  });

  describe('getBySlackMessageTs', () => {
    it('should get a review by Slack message timestamp', async () => {
      const uniqueTs = `${Date.now()}.${Math.random().toString().slice(2, 8)}`;
      const created = await repo.create({
        taskId: testTaskId,
        status: 'pending',
        slackMessageTs: uniqueTs
      });
      testReviewIds.push(created.id);

      const retrieved = await repo.getBySlackMessageTs(uniqueTs);
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.slackMessageTs).toBe(uniqueTs);
    });

    it('should return null for non-existent message timestamp', async () => {
      const result = await repo.getBySlackMessageTs('nonexistent.ts');
      expect(result).toBeNull();
    });
  });

  describe('updateStatus', () => {
    it('should update status to approved', async () => {
      const created = await repo.create({
        taskId: testTaskId,
        status: 'pending'
      });
      testReviewIds.push(created.id);

      const updated = await repo.updateStatus(created.id, 'approved');
      expect(updated.status).toBe('approved');
      expect(updated.reviewedAt).toBeInstanceOf(Date);
    });

    it('should update status to rejected with feedback', async () => {
      const created = await repo.create({
        taskId: testTaskId,
        status: 'pending'
      });
      testReviewIds.push(created.id);

      const updated = await repo.updateStatus(created.id, 'rejected', 'Needs more styling');
      expect(updated.status).toBe('rejected');
      expect(updated.feedback).toBe('Needs more styling');
      expect(updated.reviewedAt).toBeInstanceOf(Date);
    });
  });

  describe('getPending', () => {
    it('should get all pending reviews', async () => {
      // Create a pending review
      const pending = await repo.create({
        taskId: testTaskId,
        status: 'pending'
      });
      testReviewIds.push(pending.id);

      // Create and approve another review
      const approved = await repo.create({
        taskId: testTaskId,
        status: 'pending'
      });
      testReviewIds.push(approved.id);
      await repo.updateStatus(approved.id, 'approved');

      const pendingReviews = await repo.getPending();

      expect(pendingReviews.some(r => r.id === pending.id)).toBe(true);
      expect(pendingReviews.some(r => r.id === approved.id)).toBe(false);
      expect(pendingReviews.every(r => r.status === 'pending')).toBe(true);
    });
  });

  describe('delete', () => {
    it('should delete a review', async () => {
      const created = await repo.create({
        taskId: testTaskId,
        status: 'pending'
      });

      await repo.delete(created.id);
      const retrieved = await repo.getById(created.id);
      expect(retrieved).toBeNull();
    });
  });
});
