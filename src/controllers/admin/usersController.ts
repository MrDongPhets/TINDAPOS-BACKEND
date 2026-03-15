import { Request, Response } from 'express';
import { getDb } from '../../config/database';

async function getUsers(req: Request, res: Response): Promise<void> {
  try {
    const supabase = getDb();

    const { data: users, error } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Failed to fetch users:', error.message);
      res.status(500).json({
        error: 'Failed to fetch users',
        code: 'DB_ERROR'
      });
      return;
    }

    res.json({
      users: users || [],
      count: users?.length || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const err = error as Error;
    console.error('Get users error:', err.message);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
}

export { getUsers };
