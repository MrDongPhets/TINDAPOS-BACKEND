import { Request, Response } from 'express';
import { getDb } from '../../config/database';

async function getUserStats(req: Request, res: Response): Promise<void> {
  try {
    const supabase = getDb();

    // Get total users count
    const { count: totalUsers, error: usersError } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .eq('is_active', true);

    if (usersError) {
      console.error('Failed to fetch user stats:', usersError.message);
      res.status(500).json({
        error: 'Failed to fetch user statistics',
        code: 'DB_ERROR'
      });
      return;
    }

    // Get users by role distribution
    const { data: usersByRole, error: roleError } = await supabase
      .from('users')
      .select('role')
      .eq('is_active', true);

    const roleDistribution: Record<string, number> = {
      manager: 0,
      supervisor: 0,
      staff: 0
    };

    if (!roleError && usersByRole) {
      usersByRole.forEach((user: { role: string }) => {
        if (Object.prototype.hasOwnProperty.call(roleDistribution, user.role)) {
          roleDistribution[user.role]++;
        }
      });
    }

    // Get recent user registrations (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const { count: recentUsers } = await supabase
      .from('users')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', thirtyDaysAgo.toISOString())
      .eq('is_active', true);

    res.json({
      totalUsers: totalUsers || 0,
      roleDistribution,
      recentUsers: recentUsers || 0,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const err = error as Error;
    console.error('Get user stats error:', err.message);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
}

async function getSubscriptionStats(req: Request, res: Response): Promise<void> {
  try {
    const supabase = getDb();

    // Get all active subscriptions
    const { data: subscriptions, error: subsError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('status', 'active');

    if (subsError) {
      console.error('Failed to fetch subscription stats:', subsError.message);
      res.status(500).json({
        error: 'Failed to fetch subscription statistics',
        code: 'DB_ERROR'
      });
      return;
    }

    // Calculate total revenue
    let totalRevenue = 0;
    const planDistribution: Record<string, number> = {
      trial: 0,
      basic: 0,
      pro: 0,
      custom: 0
    };

    if (subscriptions) {
      subscriptions.forEach((sub: { price_amount?: string | number; plan_name?: string }) => {
        totalRevenue += parseFloat(String(sub.price_amount || 0));

        const planName = sub.plan_name?.toLowerCase() || 'trial';
        if (Object.prototype.hasOwnProperty.call(planDistribution, planName)) {
          planDistribution[planName]++;
        } else {
          planDistribution.custom++;
        }
      });
    }

    res.json({
      totalRevenue,
      totalSubscriptions: subscriptions?.length || 0,
      planDistribution,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const err = error as Error;
    console.error('Get subscription stats error:', err.message);
    res.status(500).json({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR'
    });
  }
}

export { getUserStats, getSubscriptionStats };
