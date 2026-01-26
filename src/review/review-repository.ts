import { SupabaseClient } from '@supabase/supabase-js';

export interface VisualReview {
  id: string;
  taskId: string;
  sessionId?: string;
  screenshotUrl?: string;
  screenshotPath?: string;
  status: 'pending' | 'approved' | 'rejected';
  feedback?: string;
  slackMessageTs?: string;
  slackThreadTs?: string;
  createdAt: Date;
  reviewedAt?: Date;
}

export interface CreateReviewInput {
  taskId: string;
  sessionId?: string;
  screenshotUrl?: string;
  screenshotPath?: string;
  status: VisualReview['status'];
  slackMessageTs?: string;
  slackThreadTs?: string;
}

/**
 * Database row type matching the tc_visual_reviews table schema
 */
interface VisualReviewRow {
  id: string;
  task_id: string;
  session_id: string | null;
  screenshot_url: string | null;
  screenshot_path: string | null;
  status: string;
  feedback: string | null;
  slack_message_ts: string | null;
  slack_thread_ts: string | null;
  created_at: string;
  reviewed_at: string | null;
}

/**
 * Repository for managing visual reviews in the database.
 */
export class ReviewRepository {
  constructor(private client: SupabaseClient) {}

  /**
   * Creates a new visual review record.
   */
  async create(input: CreateReviewInput): Promise<VisualReview> {
    const { data, error } = await this.client
      .from('tc_visual_reviews')
      .insert({
        task_id: input.taskId,
        session_id: input.sessionId ?? null,
        screenshot_url: input.screenshotUrl ?? null,
        screenshot_path: input.screenshotPath ?? null,
        status: input.status,
        slack_message_ts: input.slackMessageTs ?? null,
        slack_thread_ts: input.slackThreadTs ?? null
      })
      .select()
      .single();

    if (error) throw new Error(`Failed to create visual review: ${error.message}`);
    return this.mapRowToReview(data as VisualReviewRow);
  }

  /**
   * Gets a visual review by its ID.
   */
  async getById(id: string): Promise<VisualReview | null> {
    const { data, error } = await this.client
      .from('tc_visual_reviews')
      .select()
      .eq('id', id)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get visual review: ${error.message}`);
    }
    if (!data) return null;
    return this.mapRowToReview(data as VisualReviewRow);
  }

  /**
   * Gets all visual reviews for a specific task.
   */
  async getByTaskId(taskId: string): Promise<VisualReview[]> {
    const { data, error } = await this.client
      .from('tc_visual_reviews')
      .select()
      .eq('task_id', taskId)
      .order('created_at', { ascending: false });

    if (error) throw new Error(`Failed to get reviews by task: ${error.message}`);
    return (data as VisualReviewRow[]).map(row => this.mapRowToReview(row));
  }

  /**
   * Gets a visual review by its Slack message timestamp.
   * Used to correlate Slack reactions with reviews.
   */
  async getBySlackMessageTs(messageTs: string): Promise<VisualReview | null> {
    const { data, error } = await this.client
      .from('tc_visual_reviews')
      .select()
      .eq('slack_message_ts', messageTs)
      .single();

    if (error && error.code !== 'PGRST116') {
      throw new Error(`Failed to get review by Slack message: ${error.message}`);
    }
    if (!data) return null;
    return this.mapRowToReview(data as VisualReviewRow);
  }

  /**
   * Updates the status of a visual review.
   * Sets the reviewed_at timestamp when status changes from pending.
   */
  async updateStatus(
    id: string,
    status: VisualReview['status'],
    feedback?: string
  ): Promise<VisualReview> {
    const updates: Record<string, unknown> = {
      status,
      reviewed_at: new Date().toISOString()
    };

    if (feedback !== undefined) {
      updates.feedback = feedback;
    }

    const { data, error } = await this.client
      .from('tc_visual_reviews')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`Failed to update visual review status: ${error.message}`);
    return this.mapRowToReview(data as VisualReviewRow);
  }

  /**
   * Gets all pending visual reviews.
   */
  async getPending(): Promise<VisualReview[]> {
    const { data, error } = await this.client
      .from('tc_visual_reviews')
      .select()
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) throw new Error(`Failed to get pending reviews: ${error.message}`);
    return (data as VisualReviewRow[]).map(row => this.mapRowToReview(row));
  }

  /**
   * Deletes a visual review.
   */
  async delete(id: string): Promise<void> {
    const { error } = await this.client
      .from('tc_visual_reviews')
      .delete()
      .eq('id', id);

    if (error) throw new Error(`Failed to delete visual review: ${error.message}`);
  }

  /**
   * Maps a database row to a VisualReview object.
   */
  private mapRowToReview(row: VisualReviewRow): VisualReview {
    return {
      id: row.id,
      taskId: row.task_id,
      sessionId: row.session_id ?? undefined,
      screenshotUrl: row.screenshot_url ?? undefined,
      screenshotPath: row.screenshot_path ?? undefined,
      status: row.status as VisualReview['status'],
      feedback: row.feedback ?? undefined,
      slackMessageTs: row.slack_message_ts ?? undefined,
      slackThreadTs: row.slack_thread_ts ?? undefined,
      createdAt: new Date(row.created_at),
      reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : undefined
    };
  }
}
