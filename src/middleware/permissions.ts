import { Request, Response, NextFunction } from 'express';

// Permission checking middleware
function checkPermission(requiredRole: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const user = req.user;

    if (!user) {
      res.status(401).json({
        error: 'Unauthorized'
      });
      return;
    }

    // Super admin and client (company owner) have all permissions
    if (user.userType === 'super_admin' || user.userType === 'client') {
      return next();
    }

    // Manager role hierarchy
    const roleHierarchy: Record<string, number> = {
      manager: 3,
      supervisor: 2,
      staff: 1
    };

    const userRoleLevel = roleHierarchy[user.role] || 0;
    const requiredRoleLevel = roleHierarchy[requiredRole] || 0;

    if (userRoleLevel >= requiredRoleLevel) {
      return next();
    }

    res.status(403).json({
      error: 'Insufficient permissions',
      required: requiredRole,
      current: user.role
    });
  };
}

// Check if user is manager
function isManager(req: Request, res: Response, next: NextFunction): void {
  return checkPermission('manager')(req, res, next);
}

// Check if user is supervisor or above
function isSupervisor(req: Request, res: Response, next: NextFunction): void {
  return checkPermission('supervisor')(req, res, next);
}

// Check store access
function checkStoreAccess(req: Request, res: Response, next: NextFunction): void {
  const user = req.user;
  const storeId = req.params.store_id || req.body.store_id || req.query.store_id;

  if (!storeId) {
    res.status(400).json({
      error: 'Store ID is required'
    });
    return;
  }

  // Super admin can access all stores
  if (user && user.userType === 'super_admin') {
    return next();
  }

  // Check if user's store matches
  if (!user || user.store_id !== storeId) {
    res.status(403).json({
      error: 'Access denied to this store'
    });
    return;
  }

  next();
}

export {
  checkPermission,
  isManager,
  isSupervisor,
  checkStoreAccess
};
