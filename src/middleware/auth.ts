import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { AuthenticatedUser } from '../types/express.d';
import { getDb } from '../config/database';

function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({
      error: 'Access token required',
      code: 'NO_TOKEN'
    });
    return;
  }

  jwt.verify(token, process.env.JWT_SECRET as string, (err, user) => {
    if (err) {
      let errorCode = 'INVALID_TOKEN';
      let errorMessage = 'Invalid or expired token';

      if (err.name === 'TokenExpiredError') {
        errorCode = 'TOKEN_EXPIRED';
        errorMessage = 'Token has expired';
      } else if (err.name === 'JsonWebTokenError') {
        errorCode = 'TOKEN_MALFORMED';
        errorMessage = 'Token is malformed';
      }

      res.status(403).json({
        error: errorMessage,
        code: errorCode
      });
      return;
    }

    req.user = user as AuthenticatedUser;
    next();
  });
}

function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.userType !== 'super_admin') {
    res.status(403).json({
      error: 'Super admin access required',
      code: 'SUPER_ADMIN_REQUIRED'
    });
    return;
  }
  next();
}

function requireClient(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || req.user.userType !== 'client') {
    res.status(403).json({
      error: 'Client access required',
      code: 'CLIENT_REQUIRED'
    });
    return;
  }
  next();
}

function requireClientOrStaff(req: Request, res: Response, next: NextFunction): void {
  if (!req.user || (req.user.userType !== 'client' && req.user.userType !== 'staff')) {
    res.status(403).json({
      error: 'Client or staff access required',
      code: 'CLIENT_OR_STAFF_REQUIRED'
    });
    return;
  }
  next();
}

async function requireActiveSubscription(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      next();
      return;
    }

    const supabase = getDb();
    const { data: company } = await supabase
      .from('companies')
      .select('subscription_status, trial_end_date, subscription_end_date')
      .eq('id', companyId)
      .single();

    if (!company) {
      next();
      return;
    }

    const status = company.subscription_status || 'trial';
    const now = new Date();

    // Active paid subscription
    if (status === 'active') {
      const subEnd = company.subscription_end_date ? new Date(company.subscription_end_date) : null;
      if (!subEnd || subEnd > now) {
        next();
        return;
      }
      // Subscription ended — mark expired
      await supabase.from('companies').update({ subscription_status: 'expired' }).eq('id', companyId);
      res.status(403).json({ error: 'Subscription expired', code: 'SUBSCRIPTION_EXPIRED' });
      return;
    }

    // Trial period
    if (status === 'trial') {
      const trialEnd = company.trial_end_date ? new Date(company.trial_end_date) : null;
      if (trialEnd && trialEnd > now) {
        next();
        return;
      }
      // Trial ended
      await supabase.from('companies').update({ subscription_status: 'expired' }).eq('id', companyId);
      res.status(403).json({ error: 'Trial period has ended. Please subscribe to continue.', code: 'SUBSCRIPTION_EXPIRED' });
      return;
    }

    // Expired or suspended
    if (status === 'expired' || status === 'suspended') {
      res.status(403).json({ error: 'Subscription expired. Please contact support to reactivate.', code: 'SUBSCRIPTION_EXPIRED' });
      return;
    }

    next();
  } catch (error) {
    // On middleware error, don't block the request
    next();
  }
}

async function requireAdvancedReports(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      res.status(401).json({ error: 'Unauthorized', code: 'NO_COMPANY' });
      return;
    }

    const supabase = getDb();
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('plan_name, features')
      .eq('company_id', companyId)
      .single();

    const isTrial = !sub || sub.plan_name === 'trial';
    const hasReports = isTrial || sub.features?.reports === true;

    if (!hasReports) {
      res.status(403).json({
        error: 'Upgrade to Laking Negosyo to access this report',
        code: 'PLAN_RESTRICTED'
      });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}

async function requireBiometricEnabled(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const companyId = req.user?.company_id;
    if (!companyId) {
      res.status(401).json({ error: 'Unauthorized', code: 'NO_COMPANY' });
      return;
    }

    const supabase = getDb();
    const { data } = await supabase
      .from('companies')
      .select('settings')
      .eq('id', companyId)
      .single();

    if (!data?.settings?.biometric_enabled) {
      res.status(403).json({
        error: 'Biometric clock-in is not enabled for your company. Ask your manager to enable it in Settings.',
        code: 'BIOMETRIC_DISABLED'
      });
      return;
    }

    next();
  } catch (error) {
    next(error);
  }
}

export {
  authenticateToken,
  requireSuperAdmin,
  requireClient,
  requireClientOrStaff,
  requireActiveSubscription,
  requireAdvancedReports,
  requireBiometricEnabled
};
